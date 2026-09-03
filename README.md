# 🎮 Browser Storage POC — Vue + Node

> **Upload ZIP / Import GitHub Release → Extract → Play** langsung di browser.<br/>
> Game GDevelop HTML5 tanpa hosting, 100% client-side via **OPFS + IndexedDB + Service Worker**.

<p>
  <img src="https://img.shields.io/badge/Vue-3-4fc08d?style=flat-square&logo=vue.js&logoColor=white" alt="Vue 3" />
  <img src="https://img.shields.io/badge/Vite-5-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Node-22-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square" alt="TS" />
  <img src="https://img.shields.io/badge/OPFS-native-16a34a?style=flat-square" alt="OPFS" />
  <img src="https://img.shields.io/badge/Service_Worker-enabled-ff6b35?style=flat-square" alt="SW" />
</p>

---

## 🗺️ Arsitektur

```mermaid
flowchart LR
    subgraph Browser
        A[👤 User] --> B[Vue App]
        B --> C[OPFS<br/>Binary Storage]
        B --> D[(IndexedDB<br/>Metadata)]
        B --> E[Service Worker<br/>/games/:id/**]
        E --> F[🖼️ iframe Game]
        C <--> E
    end
    subgraph Server["Node server.mjs"]
        G[POST /api/github/import]
    end
    subgraph GitHub["GitHub API"]
        H[api.github.com]
        I[release-assets.githubusercontent.com]
    end
    B -- "Bearer PAT (memory only)" --> G
    G --> H --> I
    I -- "ZIP stream" --> G -- "ZIP stream" --> B
    B -- "saveBuffer + extract<br/>(fflate)" --> C

    style C fill:#16a34a,color:#fff
    style D fill:#2563eb,color:#fff
    style E fill:#ff6b35,color:#fff
    style G fill:#339933,color:#fff
```

---

## 🔄 Alur Lengkap

```mermaid
flowchart TD
    Start([📦 ZIP GDevelop]) --> Choice{Import via?}

    Choice -->|Upload| U1[Drag & Drop / File Picker]
    U1 --> U2[Validasi .zip ≤500MB]
    U2 --> Save

    Choice -->|GitHub Release| G1[Paste URL<br/>github.com/.../releases/download/...]
    G1 --> G2[+ PAT ghp_...]
    G2 --> G3["Vue POST /api/github/import<br/>{url, token}"]
    G3 --> G4["Node: GET /repos/:owner/:repo/tags/:tag<br/>→ asset.id"]
    G4 --> G5["Node: GET /assets/:id<br/>redirect:follow + stream"]
    G5 --> G6[Vue terima ZIP stream]

    G6 --> Save
    Save[💾 Simpan ke OPFS/uploads<br/>+ IndexedDB metadata]
    Save --> Extract["📂 Extract via fflate<br/>stripCommonPrefix → games/<id>/"]
    Extract --> Play[▶️ Play]
    Play --> SW{SW ready?}
    SW -->|yes| Iframe[🖼️ iframe /games/:id/index.html]
    Iframe --> Inject[💉 SW inject console hook<br/>postMessage → In-app Console]
    Inject --> Done([🎉 Game Jalan!])
    SW -->|no| Wait[⏳ Tunggu SW activate]

    style Save fill:#16a34a,color:#fff
    style Extract fill:#646cff,color:#fff
    style Play fill:#f59e0b,color:#000
    style Done fill:#16a34a,color:#fff
```

---

## 🔐 Sequence — GitHub Private Release

```mermaid
sequenceDiagram
    participant U as 👤 Vue
    participant N as 🟢 Node server.mjs
    participant GH as 🐙 api.github.com
    participant RA as 📦 release-assets

    U->>N: POST /api/github/import {url, token}
    Note over U,N: PAT tidak disimpan<br/>hanya di ref() + header transit
    N->>GH: GET /repos/:owner/:repo/git/refs/tags/:tag<br/>Authorization: Bearer PAT
    GH-->>N: tag object / commit SHA
    N->>GH: GET /repos/:owner/:repo/releases/tags/:tag<br/>Authorization: Bearer PAT
    GH-->>N: {assets: [{id, name, size}]}
    N->>GH: GET /repos/:owner/:repo/releases/assets/:id<br/>Accept: octet-stream, redirect:follow
    GH->>RA: 302 → release-assets.githubusercontent.com
    RA-->>N: ZIP binary stream
    N-->>U: ZIP stream (no-store)
    U->>U: OPFS saveBuffer + fflate extract
```

---

## 🎯 Kenapa Ada

GDevelop butuh web server untuk `index.html/js/wasm/audio`. PoC ini ganti server dengan storage browser:

```mermaid
mindmap
  root((Browser Storage))
    OPFS
      Binary besar
      File game
      uploads + games/id
    IndexedDB
      Metadata
      id name size
      extracted sourceUrl
    Service Worker
      Serve /games/id/**
      Same-origin no CORS
      Inject console hook
```

---

## ✨ Fitur

| Fitur | Deskripsi |
|-------|-----------|
| 📤 **Upload ZIP** | `.zip` ≤500 MB → OPFS + IndexedDB |
| 🔒 **Import GitHub Privat** | Paste URL + `ghp_...` (memory-only). Node handle `GET /repos/.../tags/{tag} → asset.id → GET /assets/{id}` dengan stream — tanpa CORS fail |
| 📂 **Extract & Play** | `fflate` + `stripCommonPrefix` + progress + `GameRunner` iframe + SW `/games/` + fullscreen + open new tab |
| 🖥️ **In-app Console** | Accordion overlay (default) atau docked, toggle `Bottom/Right`, filter/copy/clear, tangkap `console.*` + `error`/`unhandledrejection` via SW inject + `postMessage` |
| 💾 **Storage Info & Tests** | `navigator.storage.estimate()` + Test OPFS/IndexedDB + Clear All |

---

## 🧱 Stack

```mermaid
flowchart LR
    Vue["Vue 3 + TS + Vite 5"] --> fflate[fflate unzip]
    Vue --> OPFS[Native OPFS/IndexedDB]
    Vue --> SW[public/sw.js]
    Node["Node 22<br/>server.mjs"] --> GH[GitHub API proxy]
    SW --> Iframe[Game iframe]

    style Vue fill:#4fc08d,color:#fff
    style Node fill:#339933,color:#fff
```

**Vue 3 + TypeScript + Vite 5** · **Node 22** (`server.mjs`) · `fflate` · Native OPFS/IndexedDB · `public/sw.js`

---

## 🚀 Quick Start

```bash
npm install
npm run dev      # http://localhost:5173 (Vite handle /api/github/import)
npm run build    # Vite → dist/
npm run start    # node server.mjs serve dist + /health + /api/github/import (port 80)
```

**Docker** (single container `node:22-alpine`, tanpa nginx / tanpa `ENV` token):

```bash
docker build -t poc .
docker run -p 80:80 poc  # /health OK
# compose: 127.0.0.1:18530:80 → gdevelop-network
```

---

## 🎮 Cara Pakai GDevelop

```mermaid
flowchart LR
    A[1️⃣ Export GDevelop<br/>Web HTML5 → ZIP] --> B[2️⃣ Import<br/>Upload / GitHub]
    B --> C[3️⃣ Extract]
    C --> D[4️⃣ ▶ Play]
    D --> E[5️⃣ Cek Network<br/>from ServiceWorker ✅]
    E --> F[6️⃣ Error?<br/>◧ Console]

    style A fill:#e0f2fe,color:#000
    style D fill:#fef3c7,color:#000
    style F fill:#fee2e2,color:#000
```

1. Export GDevelop → Web (HTML5) → ZIP (pastikan `index.html` di root; jika `game/index.html` otomatis di-strip)
2. Import via Upload atau GitHub Release → **Extract** → **▶ Play** → cek Network `(from ServiceWorker)`
3. Play error? Buka `◧ Console` di header runner — toggle `Overlay/Docked` & `Bottom/Side`

---

## 📁 Struktur

```mermaid
flowchart TD
    SWJS["public/sw.js<br/>serve /games/id/** + inject hook"]
    App["src/App.vue<br/>StorageInfo + Upload + GithubImport<br/>FileList + TestPanel"]
    GI["src/components/GithubImport.vue<br/>parse URL → POST /api/github/import"]
    GR["src/components/GameRunner.vue<br/>SW ready → iframe + console"]
    Fetch["src/lib/github/fetch.ts<br/>parse + POST bridge"]
    OPFS2["src/lib/storage/opfs.ts<br/>saveBuffer / extract / delete"]
    IDB["src/lib/db/indexeddb.ts<br/>file-storage-poc v2"]
    Server["server.mjs<br/>static dist + POST /api/github/import"]

    App --> GI & GR
    GI --> Fetch --> Server
    GR --> SWJS
    App --> OPFS2 & IDB
```

| File | Peran |
|------|-------|
| `public/sw.js` | Serve `/games/<id>/**` dari OPFS + inject console hook (html) |
| `src/App.vue` | StorageInfo + FileUpload + GithubImport \| FileList + TestPanel |
| `src/components/GithubImport.vue` | Parse URL → POST `/api/github/import` (Bearer) |
| `src/components/GameRunner.vue` | SW ready → iframe + console accordion |
| `src/lib/github/fetch.ts` | Parse + POST bridge |
| `src/lib/storage/opfs.ts` | saveBuffer/extractGameToOPFS/deleteGame |
| `src/lib/db/indexeddb.ts` | file-storage-poc v2 |
| `server.mjs` | Static dist + POST `/api/github/import` (private, no-store, stream) |

> 🔒 **Secure:** PAT hanya di `ref()` Vue & header `Authorization` transit ke Node → GitHub, tidak masuk `localStorage/IndexedDB/OPFS/URL`.

---

PoC — bebas eksperimen. ✨
