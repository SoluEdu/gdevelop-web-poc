# AI Agent Implementation Brief — Private GitHub Release Import

## Objective

Fix private GitHub Release ZIP download in frontend-only Svelte app.

Current problem:

```text
Browser
  ↓
api.github.com
  ↓ 302
release-assets.githubusercontent.com
  ↓
CORS failure
```

Browser cannot reliably read private release ZIP response after GitHub redirects to release CDN.

## Decision

Implement **stateless same-origin GitHub download bridge**.

Do NOT use:

- OAuth
- application-owned PAT
- third-party CORS proxy
- persistent token storage
- arbitrary URL proxy

User still provides own GitHub PAT/token for each import.

Architecture:

```text
┌──────────────────────┐
│      Svelte UI       │
│                      │
│ Release URL          │
│ GitHub Token         │
└──────────┬───────────┘
           │
           │ metadata
           ▼
┌──────────────────────┐
│    GitHub API        │
│    api.github.com    │
└──────────────────────┘


Binary download:

┌──────────────────────┐
│      Svelte UI       │
└──────────┬───────────┘
           │
           │ token
           ▼
┌──────────────────────┐
│ Same-origin Bridge   │
│ /__gh/...            │
└──────────┬───────────┘
           │
           │ Authorization
           ▼
┌──────────────────────┐
│    GitHub API        │
└──────────┬───────────┘
           │
           │ 302
           ▼
┌──────────────────────────────┐
│ release-assets.githubusercontent.com │
└──────────┬───────────────────┘
           │
           │ ZIP stream
           ▼
┌──────────────────────┐
│ Same-origin Bridge   │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Browser              │
│ ZIP → Extract → OPFS │
└──────────────────────┘
```

---

# Existing Requirement

User enters:

```text
Release URL:
https://github.com/SoluEdu/matematika-k6b2b2/releases/download/v1.0.1/html5.zip

GitHub Token:
<user supplied token>
```

Expected parsing:

```text
owner = SoluEdu
repo  = matematika-k6b2b2
tag   = v1.0.1
asset = html5.zip
```

Token is user-owned and supplied per import.

---

# Authentication Rules

Token must remain memory-only.

Allowed:

```text
Svelte component state
function-local variable
request header
```

Forbidden:

```text
localStorage
sessionStorage
IndexedDB
OPFS
URL
query parameter
.env
VITE_*
Docker ENV
cookies
persistent application storage
```

Never:

```ts
console.log(token)
```

Never include token in error messages.

Never send token to:

- analytics
- logging services
- third-party proxy
- application storage
- arbitrary external URL

Token may transit through trusted same-origin bridge.

Bridge must immediately forward token to GitHub and never persist it.

---

# GitHub Metadata

Keep release metadata request direct from browser if CORS works.

Use:

```http
GET /repos/{owner}/{repo}/releases/tags/{tag}
```

Headers:

```http
Authorization: Bearer <TOKEN>
Accept: application/vnd.github+json
```

Response contains release assets.

Find asset by exact filename:

```text
asset.name === parsedAssetName
```

Obtain:

```text
asset.id
```

Do not use user-supplied arbitrary download URL as proxy target.

---

# Binary Download Bridge

Create same-origin endpoint.

Preferred shape:

```text
GET /__gh/repos/{owner}/{repo}/releases/assets/{assetId}
```

Example:

```text
GET /__gh/repos/SoluEdu/matematika-k6b2b2/releases/assets/123456
```

Browser sends:

```http
Authorization: Bearer <USER_TOKEN>
```

Bridge constructs GitHub API URL internally:

```text
https://api.github.com/repos/{owner}/{repo}/releases/assets/{assetId}
```

Bridge must NOT accept:

```text
/__gh/asset?url=https://...
```

Do not create generic URL forwarding.

Reason:

```text
Generic URL proxy
→ SSRF risk
→ unnecessary attack surface
```

---

# Bridge Validation

Validate:

```text
method === GET
owner format valid
repo format valid
assetId numeric
```

Construct upstream URL only from validated route parameters.

Upstream host must be hardcoded:

```text
api.github.com
```

Do not allow client to choose:

```text
hostname
protocol
port
upstream URL
redirect target
```

GitHub redirect target may be followed server-side because bridge controls fetch.

---

# Server Fetch

Bridge performs:

```text
fetch(githubAssetUrl, {
  method: 'GET',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/octet-stream'
  },
  redirect: 'follow'
})
```

Important:

**Stream response to browser.**

Do not:

```ts
const buffer = await response.arrayBuffer()
```

for large ZIP files.

Prefer:

```text
GitHub CDN
   ↓
ReadableStream
   ↓
Bridge
   ↓
Browser
```

Avoid buffering entire ZIP in server memory.

---

# Response Headers

Forward only safe/relevant headers.

Potentially forward:

```text
Content-Type
Content-Length
Content-Disposition
```

Do not blindly copy every upstream header.

Add appropriate same-origin CORS headers only if needed.

Because browser talks to same-origin bridge, CORS should normally be unnecessary.

Do NOT expose internal upstream headers.

---

# Important Redirect Rule

Browser must NOT receive GitHub CDN redirect.

Bad:

```text
Browser
 ↓
Bridge
 ↓
302
 ↓
release-assets.githubusercontent.com
 ↓
CORS failure
```

Correct:

```text
Browser
 ↓
Bridge
 ↓
GitHub API
 ↓
302
 ↓
GitHub CDN
 ↓
Bridge follows redirect
 ↓
ZIP stream
 ↓
Browser
```

Use server-side:

```text
redirect: 'follow'
```

---

# Svelte Download Flow

Current frontend logic should become:

```text
1. Parse Release URL.
2. Validate URL.
3. Fetch release metadata from GitHub.
4. Find exact asset.
5. Get asset ID.
6. Request same-origin bridge.
7. Send user token in Authorization header.
8. Receive ZIP response.
9. Pass response to ZIP extractor.
10. Validate ZIP entry paths.
11. Extract files.
12. Write files to OPFS.
13. Store metadata in IndexedDB if required.
14. Clear token from memory.
```

No third-party proxy.

Delete:

```text
corsproxy.io
```

Delete any generic URL proxy logic.

---

# Token Header

Prefer standard header:

```http
Authorization: Bearer <TOKEN>
```

Avoid custom:

```http
x-github-token
```

unless existing architecture has strong reason.

Reason:

Standard authorization semantics.

If custom header is retained, document why.

---

# OPFS

Continue existing OPFS architecture.

Expected:

```text
ZIP
 ↓
client-side extraction
 ↓
OPFS
```

Do not send extracted files to server.

Do not send ZIP contents to server except transient streaming through bridge from GitHub to browser.

---

# ZIP Security

Validate every ZIP entry before writing.

Reject:

```text
../../file
../../../file
..\..\file
absolute paths
```

Normalize paths.

Ensure extracted path stays inside intended OPFS release directory.

Example:

```text
releases/
  SoluEdu/
    matematika-k6b2b2/
      v1.0.1/
```

---

# Docker

Replace static-only nginx serving if necessary.

Preferred simple deployment:

```text
Node 22
 ├── serve Svelte dist
 ├── /health
 └── /__gh/*
```

Docker:

```dockerfile
FROM node:22-alpine
```

Do NOT inject GitHub token:

```dockerfile
ENV GITHUB_PAT=...
```

Do NOT inject token through:

```text
VITE_GITHUB_PAT
VITE_GITHUB_TOKEN
```

Docker contains no GitHub credentials.

---

# Development Parity

Development and production should use same conceptual API:

```text
/__gh/*
```

Do not have:

```text
DEV → proxy
PROD → direct CDN
```

because this causes environment-specific behavior.

Preferred:

```text
DEV:
Svelte → Vite proxy → GitHub

PROD:
Svelte → production bridge → GitHub
```

Both expose same frontend contract:

```text
/__gh/*
```

---

# Nginx

If production infrastructure already has external nginx/reverse proxy, ensure:

```text
/__gh/*
```

reaches Node bridge.

Do NOT configure nginx as simple `proxy_pass` to GitHub API and assume this solves redirect CORS.

Bad:

```text
Browser
 ↓
nginx
 ↓
GitHub API
 ↓
302 CDN
 ↓
Browser
```

Need server-side redirect following.

---

# Error Handling

Handle:

```text
400 invalid release URL
401 invalid/expired token
403 insufficient permissions
404 release/asset not found
429 rate limit
5xx GitHub error
network failure
invalid ZIP
ZIP extraction failure
OPFS quota exceeded
```

Never expose:

```text
Authorization header
token
upstream signed URL
```

in user-facing error.

Do not log signed GitHub CDN URLs containing credentials/query signatures.

---

# SSRF Protection

Bridge is NOT generic proxy.

Only support:

```text
GET /__gh/repos/{owner}/{repo}/releases/assets/{assetId}
```

Upstream destination always:

```text
https://api.github.com
```

Client cannot specify upstream host.

Do not implement:

```text
GET /__gh/asset?url=<arbitrary-url>
```

---

# Caching

Do not cache authenticated release downloads.

Avoid:

```text
Cache-Control: public
```

for private release content.

Prefer appropriate private/no-store behavior.

Token-bearing requests must not become shared proxy cache entries.

---

# Rate Limits

Avoid unnecessary GitHub API requests.

Expected:

```text
Release URL
 ↓
1 metadata request
 ↓
find asset
 ↓
1 asset download
```

Do not fetch release metadata repeatedly on UI render.

Handle rate-limit responses gracefully.

---

# Security Headers

Production should consider:

```text
Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
```

Do not weaken CSP merely to make GitHub download work.

---

# Files To Modify

Inspect existing implementation first.

Expected files:

```text
src/lib/github/fetch.ts
src/lib/github/parser.ts
src/components/GithubImport.svelte
vite.config.ts
Dockerfile
docker-compose.yml
nginx.conf
```

Potential new file:

```text
server.mjs
```

Do not modify unrelated ZIP/OPFS logic unless required.

---

# Remove

Remove:

```text
corsproxy.io
```

Remove generic URL proxy.

Remove production direct binary fetch that exposes browser to GitHub CDN CORS.

Remove any token persistence.

Remove unnecessary `x-github-token` usage if replacing with standard Authorization header.

---

# Acceptance Criteria

## Functional

Given:

```text
Private GitHub Release URL
+
valid GitHub token with repository read access
```

app must:

```text
fetch release
→ find html5.zip
→ download ZIP
→ extract client-side
→ write to OPFS
→ continue existing application flow
```

No manual re-upload.

---

## Security

Verify:

```text
[ ] Token never stored in localStorage
[ ] Token never stored in IndexedDB
[ ] Token never stored in OPFS
[ ] Token never stored in sessionStorage
[ ] Token never appears in URL
[ ] Token never appears in logs
[ ] Token never sent to third-party service
[ ] Token never stored by bridge
[ ] No generic URL proxy
[ ] No SSRF path
[ ] Signed CDN URL never exposed unnecessarily
```

---

## Network

Expected:

```text
Metadata:

Browser
  → api.github.com


Binary:

Browser
  → same-origin /__gh/*
  → api.github.com
  → release-assets.githubusercontent.com
  → bridge
  → Browser
```

Browser must never fetch private CDN URL directly.

---

## Docker

Verify:

```text
[ ] docker build succeeds
[ ] container starts
[ ] Svelte app loads
[ ] /health works
[ ] /__gh/* works
[ ] no GitHub token in Docker image
[ ] no GitHub token in build output
```

---

# Important Constraint Clarification

Original requirement said:

```text
No backend.
```

This is no longer technically accurate.

New architecture has:

```text
stateless same-origin download bridge
```

But bridge is NOT application backend in traditional sense.

Bridge:

```text
does not own credentials
does not store credentials
does not store user data
does not authenticate application users
does not persist GitHub data
only forwards authorized GitHub asset stream
```

Better architecture statement:

> Frontend-first Svelte application with stateless same-origin GitHub download bridge required to overcome browser CORS/redirect limitations for private release assets.

---

# Do Not Over-Engineer

Do NOT add:

```text
OAuth
database
Redis
user account system
GitHub App
persistent token storage
download history backend
generic proxy
```

unless existing requirements explicitly demand them.

Goal is minimal fix for:

```text
Private GitHub Release ZIP
→ browser
→ client-side extraction
→ OPFS
```

Keep existing Svelte + Docker + OPFS + IndexedDB architecture intact.