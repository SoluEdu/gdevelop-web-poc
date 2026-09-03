import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

function devGithubHandler() {
  return {
    name: 'dev-github-handler',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (req.method === 'POST' && url.pathname === '/api/github/import') {
          let raw = '';
          for await (const chunk of req) raw += chunk;
          let body: any;
          try { body = raw ? JSON.parse(raw) : {}; } catch { res.statusCode = 400; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:'Invalid JSON'})); return; }
          const rawUrl = body.url;
          if (!rawUrl) { res.statusCode = 400; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:'url wajib diisi'})); return; }
          let parsed: any;
          try {
            const u = new URL(rawUrl.trim());
            if (u.host !== 'github.com' && u.host !== 'www.github.com') throw new Error('URL harus dari github.com');
            const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/);
            if (!m) throw new Error('Format URL harus: https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip');
            const [, owner, repo, tag, filename] = m;
            if (!filename.toLowerCase().endsWith('.zip')) throw new Error('file release harus .zip');
            parsed = { owner, repo, tag, filename, url: u.toString() };
          } catch (e:any) { res.statusCode = 400; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:e.message})); return; }
          const auth = req.headers['authorization'] || '';
          const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
          const apiHeaders: any = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'opfs-poc' };
          if (token) apiHeaders['Authorization'] = `Bearer ${token}`;
          const releaseUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/tags/${encodeURIComponent(parsed.tag)}`;
          try {
            const releaseRes = await fetch(releaseUrl, { headers: apiHeaders });
            if (!releaseRes.ok) {
              const body = await releaseRes.text().catch(()=> '');
              res.statusCode = releaseRes.status;
              res.setHeader('Content-Type','application/json');
              res.end(JSON.stringify({error: body.slice(0,500) || releaseRes.statusText}));
              return;
            }
            const releaseJson: any = await releaseRes.json();
            const asset = releaseJson.assets?.find((a:any)=> a.name===parsed.filename);
            if (!asset) { res.statusCode = 404; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:`File "${parsed.filename}" tidak ditemukan`})); return; }
            const assetUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/assets/${asset.id}`;
            const dlHeaders: any = { Accept: 'application/octet-stream', 'User-Agent':'opfs-poc' };
            if (token) dlHeaders['Authorization'] = `Bearer ${token}`;
            const ghRes: any = await fetch(assetUrl, { headers: dlHeaders, redirect: 'follow' });
            if (!ghRes.ok) { const t= await ghRes.text().catch(()=> ''); res.statusCode=ghRes.status; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:t.slice(0,500)})); return; }
            res.statusCode = 200;
            res.setHeader('Content-Type', ghRes.headers.get('content-type') || 'application/octet-stream');
            const cl = ghRes.headers.get('content-length'); if (cl) res.setHeader('Content-Length', cl);
            const cd = ghRes.headers.get('content-disposition'); if (cd) res.setHeader('Content-Disposition', cd);
            res.setHeader('Cache-Control','private, no-store');
            res.setHeader('X-Content-Type-Options','nosniff');
            if (ghRes.body) {
              const reader = ghRes.body.getReader();
              while(true){ const {done,value}= await reader.read(); if(done) break; if(value) res.write(Buffer.from(value)); }
              res.end();
            } else {
              const buf = Buffer.from(await ghRes.arrayBuffer());
              res.end(buf);
            }
          } catch (e:any) { res.statusCode=500; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:e.message})); }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), devGithubHandler()],
});
