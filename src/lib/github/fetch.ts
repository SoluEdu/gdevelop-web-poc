// ── GitHub Release ZIP fetch via Node handler ────────────────────────────────
// Flow: POST /api/github/import {url} + Authorization: Bearer <PAT>
// Node does: parse → GET /repos/{owner}/{repo}/releases/tags/{tag} → find asset → GET .../assets/{id} redirect:follow → stream ZIP

import { MAX_SIZE_BYTES, validateZipFilename, validateZipSize } from '../zip/zip';

export interface ParsedReleaseUrl {
  owner: string;
  repo: string;
  tag: string;
  filename: string;
  url: string;
}

export function parseGithubReleaseUrl(raw: string): ParsedReleaseUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('URL tidak valid');
  }
  if (u.host !== 'github.com' && u.host !== 'www.github.com') {
    throw new Error('URL harus dari github.com');
  }
  const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/);
  if (!m) {
    throw new Error('Format URL harus: https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip');
  }
  const [, owner, repo, tag, filename] = m;
  try {
    validateZipFilename(filename);
  } catch (e) {
    throw new Error((e as Error).message + ' — file release harus .zip');
  }
  return { owner, repo, tag, filename, url: u.toString() };
}

export function isGithubReleaseUrl(raw: string): boolean {
  try {
    parseGithubReleaseUrl(raw);
    return true;
  } catch {
    return false;
  }
}

export async function fetchGithubZip(
  rawUrl: string,
  token: string | undefined,
  onProgress?: (loaded: number, total: number | null) => void,
  signal?: AbortSignal
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const parsed = parseGithubReleaseUrl(rawUrl);
  const t = token?.trim() || undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/octet-stream',
  };
  if (t) headers['Authorization'] = `Bearer ${t}`;

  let res: Response;
  try {
    res = await fetch('/api/github/import', {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: parsed.url }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Download dibatalkan');
    throw new Error(`Gagal hubungi handler: ${(e as Error).message} — cek koneksi`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('401 Unauthorized — token tidak valid / expired');
    if (res.status === 404) throw new Error(`404 — ${body.slice(0, 300) || 'release/asset tidak ditemukan'}`);
    if (res.status === 403) throw new Error(`403 Forbidden / rate limit — ${body.slice(0, 200) || res.statusText}`);
    if (res.status === 400) throw new Error(`400 — ${body.slice(0, 300) || 'URL tidak valid'}`);
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    throw new Error('GitHub mengembalikan HTML, bukan ZIP — cek token atau asset');
  }
  const cd = res.headers.get('content-disposition') || '';
  // prefer filename from header if available, else parsed
  let filename = parsed.filename;
  const m = cd.match(/filename="?([^"]+)"?/);
  if (m) filename = m[1];

  const contentLength = res.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : null;
  if (total !== null && !Number.isNaN(total)) {
    validateZipSize(total);
  }

  if (res.body && typeof ReadableStream !== 'undefined') {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        if (loaded > MAX_SIZE_BYTES) throw new Error(`File melebihi batas 500 MB (${loaded} bytes)`);
        onProgress?.(loaded, total);
      }
      if (signal?.aborted) throw new Error('Download dibatalkan');
    }
    const buffer = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) {
      buffer.set(c, offset);
      offset += c.byteLength;
    }
    validateZipSize(buffer.byteLength);
    return { buffer: buffer.buffer as ArrayBuffer, filename };
  }

  const buf = await res.arrayBuffer();
  validateZipSize(buf.byteLength);
  onProgress?.(buf.byteLength, total);
  return { buffer: buf, filename };
}
