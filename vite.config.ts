import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

function githubProxy() {
  return {
    name: 'github-proxy',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/__gh/')) return next();
        try {
          const u = new URL(req.url, `http://${req.headers.host}`);
          // GET /__gh/asset?url=https://api.github.com/repos/.../assets/123
          if (u.pathname === '/__gh/asset') {
            const target = u.searchParams.get('url');
            if (!target) {
              res.statusCode = 400;
              res.end('missing url param');
              return;
            }
            const token = (req.headers['x-github-token'] as string) || undefined;
            const headers: Record<string, string> = {
              Accept: 'application/octet-stream',
              'User-Agent': 'opfs-poc',
            };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            // also forward GitHub API version header
            const ghRes = await fetch(target, { headers, redirect: 'follow' } as any);
            res.statusCode = ghRes.status;
            const ct = ghRes.headers.get('content-type');
            if (ct) res.setHeader('content-type', ct);
            const cl = ghRes.headers.get('content-length');
            if (cl) res.setHeader('content-length', cl);
            const cd = ghRes.headers.get('content-disposition');
            if (cd) res.setHeader('content-disposition', cd);
            // Allow same-origin fetch (no CORS needed) but also add ACAO for safety
            res.setHeader('access-control-allow-origin', '*');
            if (!ghRes.ok) {
              const txt = await ghRes.text().catch(() => '');
              res.end(txt || `GitHub ${ghRes.status}`);
              return;
            }
            const buf = await (ghRes as any).arrayBuffer();
            res.end(Buffer.from(buf));
            return;
          }
          res.statusCode = 404;
          res.end('not found');
        } catch (e: any) {
          res.statusCode = 500;
          res.end(String(e?.message || e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    svelte({
      preprocess: vitePreprocess(),
    }),
    githubProxy(),
  ],
});
