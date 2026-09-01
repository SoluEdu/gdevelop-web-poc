// ── Service Worker — OPFS Game File Server ────────────────────────────────────
// Intercepts GET /games/<id>/** and serves files directly from OPFS.
// This makes all game assets appear same-origin, solving CORS.

const GAMES_SCOPE = '/games/';

// ── Content-Type map ──────────────────────────────────────────────────────────

const MIME_TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  wasm: 'application/wasm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
};

function getContentType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

// ── Install / Activate ────────────────────────────────────────────────────────

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept requests under /games/
  if (!url.pathname.startsWith(GAMES_SCOPE)) return;

  event.respondWith(handleGameRequest(url.pathname));
});

async function handleGameRequest(pathname) {
  try {
    // Decode percent-encoded chars: %20 → space, %28 → (, etc.
    // OPFS stores real filenames; the URL encodes them.
    pathname = decodeURIComponent(pathname);

    // pathname = /games/<id>/path/to/file.ext
    const withoutScope = pathname.slice(GAMES_SCOPE.length); // '<id>/path/to/file.ext'
    const slashIndex = withoutScope.indexOf('/');

    let gameId, filePath;

    if (slashIndex === -1) {
      // /games/<id>  → redirect to /games/<id>/
      gameId = withoutScope;
      filePath = 'index.html';
    } else {
      gameId = withoutScope.slice(0, slashIndex);
      filePath = withoutScope.slice(slashIndex + 1) || 'index.html';
    }

    if (!gameId) {
      return new Response('Game ID missing', { status: 400 });
    }

    // Navigate OPFS tree
    const root = await navigator.storage.getDirectory();
    const gamesDir = await root.getDirectoryHandle('games');
    const gameDir = await gamesDir.getDirectoryHandle(gameId);

    const pathParts = filePath.split('/').filter(Boolean);
    if (pathParts.length === 0) {
      pathParts.push('index.html');
    }

    let currentDir = gameDir;

    // Walk subdirectories
    for (let i = 0; i < pathParts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(pathParts[i]);
    }

    const filename = pathParts[pathParts.length - 1];
    const fileHandle = await currentDir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    const contentType = getContentType(filename);

    return new Response(file, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        // Allow SharedArrayBuffer for games that use it
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`OPFS: ${msg}`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
