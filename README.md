# 🎮 GDevelop HTML5 Runner — Tanpa Backend

> **Upload ZIP → Extract → Play.** Jalankan export GDevelop Web (HTML5) langsung di browser. 100% client-side. Tanpa server, tanpa upload ke cloud.

<p>
  <img src="https://img.shields.io/badge/Svelte-4-ff3e00?style=flat-square&logo=svelte&logoColor=white" alt="Svelte 4" />
  <img src="https://img.shields.io/badge/Vite-5-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite 5" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/OPFS-native-16a34a?style=flat-square" alt="OPFS" />
  <img src="https://img.shields.io/badge/license-PoC-lightgrey?style=flat-square" alt="license" />
</p>

```
ZIP GDevelop ──► OPFS + IndexedDB ──► Service Worker /games/<id>/ ──► <iframe> ──► Play
   (upload / GitHub release)        (extract via fflate)              (same-origin, no CORS)
```

Repo ini membuktikan **game GDevelop export HTML5 tidak butuh web server**. Biasanya butuh hosting untuk `index.html`, `*.js`, audio, `*.wasm`, dll. PoC ini menggantikan server dengan storage browser modern.

---

## ✨ Kenapa Ini Ada?

| Masalah | Solusi PoC |
|---|---|
| GDevelop butuh web server untuk serve file statis | **OPFS** simpan binary (zip + hasil extract) di filesystem private browser — kapasitas besar, bukan `localStorage` |
| Butuh metadata/listing yang cepat | **IndexedDB** simpan `{ id, name, size, extracted, entryCount, sourceUrl }` — binary tetap di OPFS |
| Game butuh same-origin tanpa CORS | **Service Worker** `public/sw.js` intercept `GET /games/<id>/**` dan serve langsung dari OPFS |
| ZIP harus di-extract di browser | **fflate** `unzipSync` — `stripCommonPrefix` otomatis normalisasi `mygame/index.html` → `index.html` |

Hasil: **Network tab → (ServiceWorker) — nol request ke server.**

---

## 🚀 Fitur

- 📁 **Upload ZIP** — validasi `.zip` + max 500 MB, progress, `FileUpload.svelte`
- ☁️ **Import dari GitHub Release** — paste `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip` + token opsional untuk repo privat (`GithubImport.svelte`) — resolve via `api.github.com` + proxy dev `/__gh/asset` agar bebas CORS
- 📦 **Extract ke OPFS** `games/<id>/` — handle folder root tunggal, progress per-file, update `extracted` di IndexedDB
- 📋 **File List** — sorting, badge `ZIP only` / `✓ Extracted`, Read (peek isi ZIP), Play, Delete (hapus `uploads/<id>.zip` + `games/<id>/` + IndexedDB)
- 💾 **Storage Info** — `navigator.storage.estimate()` usage/quota bar
- 🎮 **Game Runner** — modal iframe `/games/<id>/index.html`, pastikan SW `/games/` aktif, fullscreen, open in new tab, Esc to close, `allow="autoplay; fullscreen"` + `sandbox`
- 🔒 **Secure by default** — token GitHub tidak pernah disimpan (memory request saja), tidak masuk OPFS/IndexedDB/localStorage

---

## 🎯 Dua Cara Import

### 1. Upload Lokal
`FileUpload` → pilih `.zip` → Save to Browser → Extract → Play

### 2. Import dari GitHub Release (tanpa download manual)
```
https://github.com/SoluEdu/ipas-k3b6/releases/download/v1.0.0/html5.zip
```
1. Copy URL release (pastikan file `.zip`)
2. Paste di card **Import dari GitHub Release**
3. Kosongkan token untuk repo publik, isi `ghp_...` / `github_pat_...` untuk privat (PAT `contents:read`)
4. Klik **📥 Import dari GitHub** — progress streaming, validasi 500 MB, simpan ke OPFS, lalu Extract → Play seperti upload

> **CORS?** `github.com` tidak kirim `ACAO`. PoC pakai `api.github.com/releases/tags/:tag` → cari `asset.id` → download `api.github.com/.../assets/:id` via **Vite dev proxy** `GET /__gh/asset?url=...` (Node `fetch` + `Authorization: Bearer <token>` server-side, follow redirect ke `release-assets.githubusercontent.com`). Di `localhost` tanpa CORS, di produksi fallback ke `corsproxy.io`.

---

## 🧩 Stack

**Svelte 4 + TypeScript + Vite 5** · `fflate@0.8` · Native OPFS & IndexedDB (tanpa wrapper) · Service Worker

---

## ⚡ Quick Start

### Prasyarat
- Node 18+
- Browser Chromium (Chrome/Edge) untuk OPFS paling stabil. Firefox/Safari bisa tapi perlu uji.
- **HTTPS atau `localhost`** — OPFS & SW butuh secure context.

### Dev (dengan proxy GitHub)
```bash
npm install
npm run dev
# buka http://localhost:5173  (Vite proxy /__gh aktif, tidak butuh cert)
# atau https://localhost:5173 jika butuh SW di host lain (repo sudah ada cert.pem/key.pem, di-ignore git)
```

### Build & Preview
```bash
npm run build
npm run preview   # dist/ — untuk prod, GitHub import akan lewat corsproxy.io (atau deploy Worker sendiri)
npm run check     # svelte-check
```

> Tip: butuh self-signed cert? `npx mkcert localhost` atau pakai `vite --host` di `localhost` — Chrome izinkan SW di `http://localhost`.

---

## 🎨 Cara Pakai — Flow GDevelop

1. **Export** dari GDevelop: `File → Export → Web (HTML5) → ZIP`
2. **Import** via Upload atau GitHub Release
3. **Extract** di list (jika belum auto)
4. **Play** — `GameRunner` pastikan SW `/games/` aktif lalu load `/games/<id>/index.html` di iframe. Cek DevTools → Network → `(from ServiceWorker)`

### Catatan GDevelop
- Jika ZIP berisi 1 folder root (`game/index.html`) → otomatis di-strip (`src/lib/storage/opfs.ts:98` `stripCommonPrefix`)
- Entry harus `index.html` di root. Jika nama lain, rename dulu sebelum zip.
- MIME di `public/sw.js:9`: `html/js/css/json/wasm/png/jpg/mp3/ogg/wav/mp4/webm/woff2` dll — tambah mapping jika game pakai ekstensi lain.

---

## 🏗️ Arsitektur & Storage

```
public/sw.js                → fetch /games/<id>/** dari OPFS, header COOP/COEP
src/App.svelte              → StorageInfo + FileUpload + GithubImport | FileList + TestPanel
src/components/
  FileUpload.svelte         → validateZip → saveFile → IndexedDB
  GithubImport.svelte       → parse URL → fetchGithubZip (api + proxy) → saveBuffer → IndexedDB
  FileList.svelte           → getAllFiles, extractGameToOPFS, deleteGame, read modal
  GameRunner.svelte         → ensure SW /games/, iframe, fullscreen
  StorageInfo/TestPanel
src/lib/
  storage/opfs.ts           → getRoot, saveBuffer/saveFile, extractGameToOPFS, deleteGame
  db/indexeddb.ts           → file-storage-poc v2, store files { id, name, size, type, createdAt, opfsPath, extracted, entryCount, sourceUrl, sourceType }
  github/fetch.ts           → parseGithubReleaseUrl, fetchGithubZip (api + /__gh proxy + corsproxy fallback)
  zip/zip.ts                → validateZipFilename/Size, extractZip, formatBytes
  utils/uuid.ts
```

**Layout:**
- OPFS: `uploads/<uuid>.zip` + `games/<uuid>/**`
- IndexedDB: `file-storage-poc` (`v2`)

---

## ⚠️ Keterbatasan

- Butuh **secure context** (HTTPS/`localhost`). `file://` tidak bisa.
- Kapasitas dari `navigator.storage.estimate()` — browser bisa evict jika penuh.
- Full client-side, tidak sync lintas device (sengaja — tanpa backend). Untuk share → upload ulang atau pakai GitHub Release.
- Max 500 MB (`MAX_SIZE_BYTES` di `src/lib/zip/zip.ts`) — ubah jika perlu.
- iOS Safari: OPFS baru tersedia di versi recent.
- Produksi statis tanpa proxy: GitHub import lewat `corsproxy.io` (publik). Untuk privat/produksi serius, deploy Worker/edge proxy sendiri yang forward `Authorization`.

---

## 🗺️ Roadmap

- [x] Upload + extract + play
- [x] GitHub Release import + proxy CORS
- [ ] Auto-extract toggle setelah import
- [ ] Search/filter list + storage cleanup
- [ ] PWA installable + offline cache

PR welcome!

---

## 📄 Lisensi

PoC — bebas untuk eksperimen. Export game GDevelop tetap milik pembuatnya.
