// ── GitHub Release ZIP fetch ───────────────────────────────────────────────
// Handles: https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip
// Optional PAT for private repos (passed per-request, never persisted).

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
  // /owner/repo/releases/download/tag/file.zip
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

/**
 * Fetch a ZIP from a GitHub release URL via GitHub API to avoid CORS.
 * Direct fetch to github.com is blocked (no ACAO). We use:
 *  1. GET https://api.github.com/repos/:owner/:repo/releases/tags/:tag  → find asset id
 *  2. GET https://api.github.com/repos/:owner/:repo/releases/assets/:id  (Accept: octet-stream) → redirect to CDN
 * Both api.github.com and the CDN (objects.githubusercontent.com) send CORS headers.
 */
export async function fetchGithubZip(
  rawUrl: string,
  token: string | undefined,
  onProgress?: (loaded: number, total: number | null) => void,
  signal?: AbortSignal
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const parsed = parseGithubReleaseUrl(rawUrl);
  const t = token?.trim() || undefined;

  const apiHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (t) apiHeaders['Authorization'] = `Bearer ${t}`;

  // 1) Resolve release → asset id
  const releaseUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/tags/${encodeURIComponent(parsed.tag)}`;
  let releaseRes: Response;
  try {
    releaseRes = await fetch(releaseUrl, { headers: apiHeaders, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Download dibatalkan');
    throw new Error(`Gagal hubungi GitHub API: ${(e as Error).message} — cek koneksi`);
  }
  if (!releaseRes.ok) {
    const body = await releaseRes.text().catch(() => '');
    if (releaseRes.status === 401) throw new Error('401 Unauthorized — token tidak valid / expired');
    if (releaseRes.status === 404) {
      const hint = t ? '' : ' (repo privat atau tag salah — butuh token?)';
      throw new Error(`404 — release "${parsed.tag}" tidak ditemukan di ${parsed.owner}/${parsed.repo}${hint}`);
    }
    if (releaseRes.status === 403) throw new Error(`403 Forbidden / rate limit — ${body.slice(0, 200) || releaseRes.statusText}`);
    throw new Error(`GitHub API ${releaseRes.status}: ${body.slice(0, 300) || releaseRes.statusText}`);
  }

  let releaseJson: { assets: Array<{ id: number; name: string; size: number }> };
  try {
    releaseJson = (await releaseRes.json()) as typeof releaseJson;
  } catch {
    throw new Error('Gagal parse response GitHub API');
  }
  const asset = releaseJson.assets?.find((a) => a.name === parsed.filename);
  if (!asset) {
    const available = (releaseJson.assets || []).map((a) => a.name).join(', ') || '(tidak ada asset)';
    throw new Error(`File "${parsed.filename}" tidak ditemukan di release ${parsed.tag}. Asset tersedia: ${available}`);
  }

  // Optional size pre-check from API metadata
  if (asset.size) {
    try {
      validateZipSize(asset.size);
    } catch (e) {
      throw e;
    }
  }

  // 2) Download asset binary — via dev proxy to avoid CORS
  // Direct api.github.com/assets → 302 → release-assets.githubusercontent.com is NOT CORS-enabled,
  // so browser blocks it. In dev we proxy through Vite middleware /__gh/asset.
  // In production fallback to corsproxy.io.
  const assetUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/assets/${asset.id}`;

  function isLocalDev(): boolean {
    try {
      const h = window.location.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '::1';
    } catch {
      return false;
    }
  }

  async function fetchViaProxy(url: string): Promise<Response> {
    // Vite dev middleware: GET /__gh/asset?url=...
    const proxyUrl = `/__gh/asset?url=${encodeURIComponent(url)}`;
    const headers: Record<string, string> = {};
    if (t) headers['x-github-token'] = t;
    return fetch(proxyUrl, { headers, signal, redirect: 'follow' } as RequestInit);
  }

  let res: Response | null = null;
  let lastErr: unknown = null;

  if (isLocalDev()) {
    try {
      res = await fetchViaProxy(assetUrl);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 401) throw new Error('401 Unauthorized — token tidak valid untuk download asset');
        if (res.status === 404) throw new Error('404 — asset tidak ditemukan (mungkin butuh token untuk repo privat)');
        if (res.status === 403) throw new Error(`403 Forbidden — ${body.slice(0, 200) || res.statusText}`);
        throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastErr = e;
      res = null;
    }
  }

  if (!res) {
    // Try direct (will work for JSON; for binary it will CORS-fail at CDN, then fallback to public proxy)
    const dlHeaders: Record<string, string> = { Accept: 'application/octet-stream' };
    if (t) dlHeaders['Authorization'] = `Bearer ${t}`;
    try {
      const direct = await fetch(assetUrl, { headers: dlHeaders, redirect: 'follow', signal });
      if (!direct.ok) {
        const body = await direct.text().catch(() => '');
        if (direct.status === 401) throw new Error('401 Unauthorized — token tidak valid untuk download asset');
        if (direct.status === 404) throw new Error('404 — asset tidak ditemukan (mungkin butuh token untuk repo privat)');
        if (direct.status === 403) throw new Error(`403 Forbidden — ${body.slice(0, 200) || direct.statusText}`);
        throw new Error(`${direct.status} ${direct.statusText} — ${body.slice(0, 300)}`);
      }
      res = direct;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      // Detect CORS/network failure → try public CORS proxy
      const msg = (e as Error).message || '';
      const isCorsFailure = msg.includes('Failed to fetch') || msg.includes('CORS') || msg.includes('ERR_FAILED');
      // If direct threw our own 401/404/403 (not network), rethrow
      if (!isCorsFailure && msg.startsWith('40')) throw e;
      // Fallback to corsproxy.io (public, forwards headers)
      try {
        const corsUrl = `https://corsproxy.io/?${encodeURIComponent(assetUrl)}`;
        const corsHeaders: Record<string, string> = { Accept: 'application/octet-stream' };
        if (t) corsHeaders['Authorization'] = `Bearer ${t}`;
        const corsRes = await fetch(corsUrl, { headers: corsHeaders, signal, redirect: 'follow' } as RequestInit);
        if (!corsRes.ok) {
          const body = await corsRes.text().catch(() => '');
          throw new Error(`Proxy ${corsRes.status}: ${body.slice(0, 300) || corsRes.statusText}`);
        }
        res = corsRes;
      } catch (pe) {
        if ((pe as Error).name === 'AbortError') throw pe;
        // Prefer original error if proxy also fails
        throw lastErr || e;
      }
    }
  }
  // At this point res is guaranteed
  if (!res) throw (lastErr as Error) || new Error('Gagal download asset');

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    throw new Error('GitHub mengembalikan HTML, bukan ZIP — cek token atau asset');
  }

  const contentLength = res.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : asset.size || null;
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
    return { buffer: buffer.buffer as ArrayBuffer, filename: parsed.filename };
  }

  const buf = await res.arrayBuffer();
  validateZipSize(buf.byteLength);
  onProgress?.(buf.byteLength, total);
  return { buffer: buf, filename: parsed.filename };
}
