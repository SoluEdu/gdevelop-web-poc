# OPFS + IndexedDB PoC — GDevelop HTML5 Runner tanpa Backend

Proof of Concept untuk menjalankan **GDevelop Web Export (HTML5)** langsung di browser tanpa butuh backend/server. Upload file `.zip` hasil export GDevelop, simpan & extract ke browser storage, lalu jalankan gamenya via `<iframe>` — semua 100% client-side.

> Tujuan repo ini: membuktikan **game GDevelop export HTML5 bisa di-run tanpa backend** dengan memanfaatkan **OPFS (Origin Private File System) + IndexedDB + Service Worker**.

## Kenapa PoC ini?

GDevelop export HTML5 biasanya butuh web server untuk serve file `index.html`, JS, asset, dll. PoC ini menggantikan server dengan:

- **OPFS** — simpan binary (zip + hasil extract game) langsung di filesystem private browser (kapasitas besar, tidak masuk `localStorage`).
- **IndexedDB** — simpan metadata file (id, nama, size, `extracted`, `entryCount`).
- **Service Worker (`/games/` scope)** — intercept request `GET /games/<id>/**` dan serve file langsung dari OPFS, jadi game terasa same-origin tanpa CORS.
- **fflate** — extract `.zip` di browser.

Hasil: `ZIP upload → extract ke `games/<id>/` di OPFS → play di `GameRunner.svelte` (iframe `/games/<id>/index.html`)`.

## Fitur

- Upload `.zip` (validasi ekstensi + max 500 MB)
- Extract otomatis ke OPFS dengan `stripCommonPrefix` — dukung export GDevelop yang dibungkus 1 folder (`mygame/index.html` → `index.html`)
- List file, hapus (hapus dari OPFS + IndexedDB), dan play
- Storage info (`navigator.storage.estimate()` — usage/quota)
- Game runner modal dengan iframe, fullscreen, open in new tab, Esc to close
- Service Worker serve file dari OPFS dengan MIME type yang benar + header COOP/COEP

## Stack

Svelte 4 + TypeScript + Vite 5, `fflate` untuk unzip, native OPFS & IndexedDB (tanpa lib wrapper).

## Cara Jalan

### Prasyarat

- Node 18+
- Browser Chromium modern (Chrome/Edge) untuk OPFS terbaik. Firefox/Safari: OPFS ada tapi perilaku bisa berbeda.
- **Harus HTTPS atau `localhost`** — OPFS & Service Worker butuh secure context.

### Dev

```bash
npm install
npm run dev
# buka https://localhost:5173 (Vite butuh HTTPS untuk SW/OPFS)
```

> Repo ini sudah punya `cert.pem`/`key.pem` lokal untuk HTTPS dev (di-ignore git). Jika belum ada cert, generate self-signed atau jalankan `vite --host` di localhost — Chrome memperbolehkan SW di `http://localhost`.

### Build & Preview

```bash
npm run build
npm run preview
```

### Cek Type

```bash
npm run check
```

## Cara Pakai (Flow GDevelop)

1. Export game dari GDevelop: **File → Export → Web (HTML5) → ZIP**.
2. Buka PoC, upload `.zip` via panel **FileUpload**.
3. File tersimpan di `OPFS/uploads/<id>.zip`, lalu di-extract ke `OPFS/games/<id>/`.
4. Klik **Play/Run** di list — `GameRunner` akan ensure Service Worker `/games/` aktif lalu load `/games/<id>/index.html` di iframe.
5. Game jalan tanpa request ke server sama sekali (cek Network tab → served by SW dari OPFS).

## Struktur Proyek

```
public/sw.js              # Service Worker — serve /games/<id>/** dari OPFS
src/App.svelte            # layout: StorageInfo + FileUpload | FileList + TestPanel
src/components/
  FileUpload.svelte       # validasi + save + extract
  FileList.svelte         # list dari IndexedDB + delete + play
  GameRunner.svelte       # modal iframe, ensure SW ready, fullscreen
  StorageInfo.svelte      # usage/quota bar
  TestPanel.svelte        # panel uji OPFS/IDB
src/lib/
  storage/opfs.ts         # getRoot, save/get/delete, extractGameToOPFS, stripCommonPrefix
  db/indexeddb.ts         # openDatabase, add/get/delete (store: files, keyPath: id)
  zip/zip.ts              # validateZip, extractZip (fflate), formatBytes
  utils/uuid.ts
```

### Storage Layout

- OPFS: `uploads/<uuid>.zip` (arsip asli) dan `games/<uuid>/**` (hasil extract)
- IndexedDB `file-storage-poc` v2, store `files`: `{ id, name, size, type, createdAt, opfsPath, extracted, entryCount }`

## Catatan GDevelop

- Export yang berisi 1 folder root (`game/index.html`, `game/code.js`) otomatis di-normalize ke root — `stripCommonPrefix` di `src/lib/storage/opfs.ts:98`.
- Entry HTML harus `index.html` di root game. Jika export pakai nama lain, rename jadi `index.html` sebelum zip.
- Asset besar (audio `*.mp3/*.ogg`, `*.wasm`) di-serve dengan MIME yang benar oleh `public/sw.js:9`. Tambah mapping jika game pakai ekstensi lain.

## Keterbatasan

- OPFS & SW butuh **secure context** (HTTPS). Tidak jalan di `http://` biasa atau `file://`.
- Kapasitas tergantung `navigator.storage.estimate()` — browser bisa evict OPFS jika quota penuh.
- Belum ada persist lintas device (full client-side). Untuk share, butuh upload ulang atau sync backend (sengaja tidak ada di PoC ini — sesuai tujuan "tanpa backend").
- Max upload 500 MB (`MAX_SIZE_BYTES` di `src/lib/zip/zip.ts:15`) — sesuaikan jika game lebih besar.
- iOS Safari: OPFS tersedia mulai versi baru, uji terpisah.

## Lisensi

PoC — pakai bebas untuk eksperimen. GDevelop game export tetap milik pembuat gamenya.
