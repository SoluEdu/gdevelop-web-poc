# Private GitHub Release Import — Svelte

## Goal

Build frontend-only Svelte app running in Docker.

User can import/download private GitHub Release asset by providing:

- GitHub Release URL
- GitHub Access Token / PAT

No application backend.

Example:

```text
Release URL:
https://github.com/SoluEdu/matematika-k6b2b2/releases/download/v1.0.1/html5.zip

Access Token:
<user-input>
```

---

## Architecture

```text
┌───────────────┐
│    Browser    │
│    Svelte     │
│               │
│ Release URL   │
│ Access Token  │
└───────┬───────┘
        │
        │ HTTPS + Authorization
        ▼
┌─────────────────────┐
│     GitHub API      │
│                     │
│ Private Repository  │
│ Release Asset       │
└──────────┬──────────┘
           │
           │ ZIP
           ▼
┌─────────────────────┐
│      Browser        │
│                     │
│ Download ZIP        │
│ Extract client-side  │
│ Store → OPFS         │
└─────────────────────┘
```

Docker only serves static Svelte files.

```text
Docker
  ↓
Svelte static files
  ↓
Browser
  ↓
GitHub API
```

Docker does NOT hold GitHub credentials.

---

# Authentication

OAuth is NOT required for current requirement.

User provides own GitHub token whenever importing/downloading.

```text
User
  ↓
Paste Release URL
  ↓
Paste GitHub Token
  ↓
Svelte
  ↓
GitHub API
```

Token should exist only in memory.

Recommended lifecycle:

```text
Input token
    ↓
Store in component/state memory
    ↓
Send HTTPS request to GitHub
    ↓
Download asset
    ↓
Clear token
```

Do not persist token.

Never store token in:

```text
localStorage
IndexedDB
sessionStorage
URL
query parameter
.env exposed to frontend
VITE_* environment variable
Docker ENV
```

Never log token.

---

# Release URL Parsing

Expected URL format:

```text
https://github.com/{owner}/{repo}/releases/download/{tag}/{asset}
```

Example:

```text
https://github.com/SoluEdu/matematika-k6b2b2/releases/download/v1.0.1/html5.zip
```

Parse into:

```text
owner = SoluEdu
repo  = matematika-k6b2b2
tag   = v1.0.1
asset = html5.zip
```

URL parser must validate:

- hostname is `github.com`
- pathname matches expected release format
- owner exists
- repository exists
- tag exists
- asset exists

Do not blindly fetch arbitrary URLs supplied by user.

---

# GitHub API Flow

Recommended flow:

```text
Release URL
    ↓
Parse owner/repo/tag/asset
    ↓
GET release by tag
    ↓
Find matching asset
    ↓
Get asset ID
    ↓
Download asset
    ↓
Blob / stream
```

Release metadata endpoint:

```http
GET /repos/{owner}/{repo}/releases/tags/{tag}
```

Use authorization header:

```http
Authorization: Bearer <TOKEN>
Accept: application/vnd.github+json
```

Find requested asset from:

```json
{
  "assets": [
    {
      "id": 123456,
      "name": "html5.zip",
      "browser_download_url": "..."
    }
  ]
}
```

Then download release asset using GitHub's release asset API.

For binary download, use:

```http
Accept: application/octet-stream
```

---

# Token Permissions

Use minimum permission required.

For GitHub fine-grained token, private repository release access requires repository access with:

```text
Contents: Read
```

Token should have access only to required repositories where possible.

Do not request broad permissions unnecessarily.

---

# Svelte Implementation

Suggested structure:

```text
src/
├── lib/
│   ├── github/
│   │   ├── parser.ts
│   │   ├── release.ts
│   │   └── download.ts
│   │
│   ├── archive/
│   │   └── extract.ts
│   │
│   └── storage/
│       └── opfs.ts
│
├── routes/
│   └── ...
│
└── app.html
```

Responsibilities:

### `parser.ts`

Parse and validate GitHub Release URL.

### `release.ts`

Call GitHub API.

Responsibilities:

```text
getReleaseByTag()
findAsset()
```

### `download.ts`

Download release asset.

Responsibilities:

```text
downloadAsset()
```

### `extract.ts`

Extract ZIP entirely client-side.

### `opfs.ts`

Store extracted files in OPFS.

---

# Download

Do not unnecessarily convert large ZIP files into base64.

Prefer:

```text
HTTP Response
    ↓
ReadableStream / Blob
    ↓
ZIP processor
    ↓
Extract files
```

For small files:

```ts
const blob = await response.blob()
```

For large files, prefer streaming-compatible ZIP extraction where library support allows it.

Avoid:

```ts
const base64 = ...
```

Base64 increases memory usage.

---

# ZIP Extraction

ZIP extraction happens entirely in browser.

```text
html5.zip
    ↓
ZIP parser
    ↓
index.html
assets/
css/
js/
...
```

Validate archive entries before writing them.

Prevent path traversal such as:

```text
../../file
```

or:

```text
..\..\file
```

Normalize paths before writing to OPFS.

---

# OPFS

Recommended storage:

```text
OPFS
└── releases/
    └── SoluEdu/
        └── matematika-k6b2b2/
            └── v1.0.1/
                ├── index.html
                ├── assets/
                ├── css/
                └── js/
```

Store metadata separately if useful:

```text
IndexedDB
└── release metadata
    ├── owner
    ├── repo
    ├── tag
    ├── importedAt
    └── files
```

Use:

- **OPFS** → actual file contents
- **IndexedDB** → metadata/index/state

Do not store GitHub token in either.

---

# Docker

Docker only hosts built Svelte application.

Example:

```dockerfile
FROM node:22 AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html
```

Do NOT do:

```dockerfile
ENV GITHUB_PAT=...
```

Do NOT do:

```env
VITE_GITHUB_PAT=...
```

Frontend environment variables are not secrets.

---

# Security

Critical rules:

1. Token never persisted.
2. Token never logged.
3. Token never sent to application backend.
4. Token only sent to GitHub.
5. Use HTTPS.
6. Validate GitHub URL.
7. Validate repository/release/asset.
8. Validate ZIP paths.
9. Use minimum token permissions.
10. Clear token after operation.
11. Handle API errors safely.
12. Never expose token in UI error messages.
13. Avoid putting token into global persistent state.
14. Avoid third-party analytics capturing form/input values.

Important:

```text
Frontend can access token.
Therefore frontend must be trusted by user.
```

A malicious modified frontend could steal token.

Use HTTPS and trusted deployment.

---

# Error Handling

Handle at minimum:

```text
401 Unauthorized
403 Forbidden
404 Not Found
429 Too Many Requests
5xx GitHub errors
Network failure
Invalid GitHub URL
Release not found
Asset not found
Invalid ZIP
ZIP extraction failure
OPFS quota/storage failure
```

User-facing errors should never contain token.

Example:

```text
Invalid GitHub token.

```

Not:

```text
GitHub request failed with token github_pat_...
```

---

# Rate Limiting

GitHub API has rate limits.

Avoid repeated requests.

Recommended:

```text
User submits URL
    ↓
Parse once
    ↓
Fetch release metadata once
    ↓
Find asset
    ↓
Download asset once
```

Do not call API repeatedly on every UI render.

Cache release metadata in memory when useful.

Do not cache authenticated API responses in persistent storage unless security implications are understood.

---

# User Flow

```text
┌─────────────────────────┐
│ Import GitHub Release   │
├─────────────────────────┤
│                         │
│ Release URL             │
│ [____________________]  │
│                         │
│ GitHub Token            │
│ [____________________]  │
│                         │
│ [ Import ]              │
└────────────┬────────────┘
             ↓
      Validate URL
             ↓
      Validate token
             ↓
      Fetch release
             ↓
      Find html5.zip
             ↓
      Download
             ↓
      Extract
             ↓
      Validate paths
             ↓
      Write OPFS
             ↓
      Import complete
```

---

# Production Checklist

## Authentication

- [ ] User supplies own token
- [ ] Token kept in memory
- [ ] No localStorage
- [ ] No IndexedDB
- [ ] No sessionStorage
- [ ] No URL token
- [ ] No Docker token
- [ ] No frontend environment token
- [ ] Token cleared after use
- [ ] Minimum GitHub permissions

## GitHub

- [ ] Validate GitHub URL
- [ ] Parse owner/repo/tag/asset
- [ ] Fetch release metadata
- [ ] Find exact asset
- [ ] Download binary asset
- [ ] Handle rate limits
- [ ] Handle token expiration/revocation

## ZIP

- [ ] Client-side extraction
- [ ] Path traversal protection
- [ ] Large ZIP handling
- [ ] Memory usage control
- [ ] Invalid ZIP handling

## Storage

- [ ] OPFS for files
- [ ] IndexedDB for metadata
- [ ] Storage quota handling
- [ ] No token persistence

## Deployment

- [ ] Svelte build
- [ ] Docker static hosting
- [ ] HTTPS
- [ ] CSP
- [ ] Security headers
- [ ] No GitHub credentials in Docker

---

# Final Recommendation

Architecture is valid for current use case:

```text
Svelte
+
Docker static hosting
+
User-provided GitHub token
+
GitHub REST API
+
Client-side ZIP extraction
+
OPFS
+
IndexedDB metadata
```

No backend needed.

No OAuth needed.

Main security boundary:

```text
User owns token
        ↓
User explicitly gives token to Svelte
        ↓
Svelte uses token only for GitHub request
        ↓
Token never persisted
```

Best suited for:

```text
Internal tool
Developer tool
Personal tool
Controlled users
```

For public SaaS with unknown users, reassess authentication architecture before production.