import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PORT = parseInt(process.env.PORT || '80', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.zip': 'application/zip',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}

// ── GitHub helpers ───────────────────────────────────────────────────────────
function parseGithubReleaseUrl(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { throw Object.assign(new Error('URL tidak valid'), { status: 400 }); }
  if (u.host !== 'github.com' && u.host !== 'www.github.com') throw Object.assign(new Error('URL harus dari github.com'), { status: 400 });
  const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/);
  if (!m) throw Object.assign(new Error('Format URL harus: https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip'), { status: 400 });
  const [, owner, repo, tag, filename] = m;
  if (!filename.toLowerCase().endsWith('.zip')) throw Object.assign(new Error('file release harus .zip'), { status: 400 });
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw Object.assign(new Error('owner/repo tidak valid'), { status: 400 });
  return { owner, repo, tag, filename, url: u.toString() };
}

async function handleGithubImport(req, res) {
  // read body
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let parsedBody;
  try { parsedBody = raw ? JSON.parse(raw) : {}; } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
  const rawUrl = parsedBody.url;
  if (!rawUrl || typeof rawUrl !== 'string') return sendJson(res, 400, { error: 'url wajib diisi' });

  let parsed;
  try { parsed = parseGithubReleaseUrl(rawUrl); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;

  const apiHeaders = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'opfs-poc',
  };
  if (token) apiHeaders['Authorization'] = `Bearer ${token}`;

  // 1) release metadata
  const releaseUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/tags/${encodeURIComponent(parsed.tag)}`;
  let releaseRes;
  try { releaseRes = await fetch(releaseUrl, { headers: apiHeaders }); } catch (e) { return sendJson(res, 502, { error: `Gagal hubungi GitHub API: ${e.message}` }); }
  if (!releaseRes.ok) {
    const body = await releaseRes.text().catch(() => '');
    if (releaseRes.status === 401) return sendJson(res, 401, { error: '401 Unauthorized — token tidak valid / expired' });
    if (releaseRes.status === 404) return sendJson(res, 404, { error: `404 — release "${parsed.tag}" tidak ditemukan di ${parsed.owner}/${parsed.repo}` });
    if (releaseRes.status === 403) return sendJson(res, 403, { error: `403 Forbidden / rate limit — ${body.slice(0, 200)}` });
    return sendJson(res, releaseRes.status, { error: body.slice(0, 500) || releaseRes.statusText });
  }
  let releaseJson;
  try { releaseJson = await releaseRes.json(); } catch { return sendJson(res, 502, { error: 'Gagal parse response GitHub API' }); }
  const asset = releaseJson.assets?.find((a) => a.name === parsed.filename);
  if (!asset) {
    const available = (releaseJson.assets || []).map((a) => a.name).join(', ') || '(tidak ada asset)';
    return sendJson(res, 404, { error: `File "${parsed.filename}" tidak ditemukan di release ${parsed.tag}. Asset tersedia: ${available}` });
  }

  // 2) download asset binary via GitHub API (server follows redirect)
  const assetUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/assets/${asset.id}`;
  const dlHeaders = {
    Accept: 'application/octet-stream',
    'User-Agent': 'opfs-poc',
  };
  if (token) dlHeaders['Authorization'] = `Bearer ${token}`;

  let ghRes;
  try { ghRes = await fetch(assetUrl, { headers: dlHeaders, redirect: 'follow' }); } catch (e) { return sendJson(res, 502, { error: `Gagal download asset: ${e.message}` }); }
  if (!ghRes.ok) {
    const body = await ghRes.text().catch(() => '');
    if (ghRes.status === 401) return sendJson(res, 401, { error: '401 Unauthorized — token tidak valid untuk download asset' });
    if (ghRes.status === 404) return sendJson(res, 404, { error: '404 — asset tidak ditemukan' });
    return sendJson(res, ghRes.status, { error: body.slice(0, 500) || ghRes.statusText });
  }

  // stream to client — forward only safe headers
  const ct = ghRes.headers.get('content-type') || 'application/octet-stream';
  const cl = ghRes.headers.get('content-length');
  const cd = ghRes.headers.get('content-disposition') || `attachment; filename="${parsed.filename}"`;
  res.writeHead(200, {
    'Content-Type': ct,
    ...(cl ? { 'Content-Length': cl } : {}),
    'Content-Disposition': cd,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (ghRes.body) {
    const reader = ghRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
      res.end();
    } catch (e) {
      // client aborted
      try { res.end(); } catch {}
    }
  } else {
    const buf = Buffer.from(await ghRes.arrayBuffer());
    res.end(buf);
  }
}

// ── static file ──────────────────────────────────────────────────────────────
function serveStatic(req, res) {
  let urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (urlPath === '/health') {
    return send(res, 200, 'OK\n', { 'Content-Type': 'text/plain' });
  }
  if (urlPath.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'not found' });
  }
  // normalize
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  let filePath = path.join(DIST, urlPath);
  // prevent path traversal
  if (!filePath.startsWith(DIST)) return send(res, 403, 'Forbidden');
  // if path is directory, serve index.html
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {}
  // try file, fallback to index.html (SPA)
  if (!fs.existsSync(filePath)) {
    const fallback = path.join(DIST, 'index.html');
    if (fs.existsSync(fallback)) filePath = fallback;
    else return send(res, 404, 'Not Found');
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': mime };
  if (ext === '.html') headers['Cache-Control'] = 'no-cache';
  else if (['.js', '.css', '.woff', '.woff2'].includes(ext)) headers['Cache-Control'] = 'public, max-age=2592000, immutable';
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, headers);
  stream.pipe(res);
  stream.on('error', () => send(res, 500, 'Internal Server Error'));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && new URL(req.url, `http://${req.headers.host}`).pathname === '/api/github/import') {
      await handleGithubImport(req, res);
      return;
    }
    if (req.method === 'GET') {
      serveStatic(req, res);
      return;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    // never expose token/signed URL
    console.error('[server] error', e?.message);
    try { sendJson(res, 500, { error: 'Internal server error' }); } catch {}
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on :${PORT}, dist=${DIST}`);
});
