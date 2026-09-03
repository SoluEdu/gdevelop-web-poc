<script setup lang="ts">
import { ref, computed } from 'vue';
import { saveBuffer } from '../lib/storage/opfs';
import { addFile } from '../lib/db/indexeddb';
import { formatBytes } from '../lib/zip/zip';
import { generateUUID } from '../lib/utils/uuid';
import { fetchGithubZip, parseGithubReleaseUrl } from '../lib/github/fetch';
import type { StoredFile } from '../lib/db/indexeddb';

const emit = defineEmits<{ (e: 'saved', file: StoredFile): void }>();

const url = ref('');
const token = ref('');
const showToken = ref(false);
const error = ref('');
const success = ref('');
const loading = ref(false);
const loaded = ref(0);
const total = ref<number | null>(null);
let abortCtrl: AbortController | null = null;

const urlHint = ref('');
function handleUrlInput() {
  error.value = '';
  success.value = '';
  urlHint.value = '';
  if (!url.value.trim()) return;
  try {
    const p = parseGithubReleaseUrl(url.value);
    urlHint.value = `${p.owner}/${p.repo} @ ${p.tag} → ${p.filename}`;
  } catch (e) {
    urlHint.value = (e as Error).message;
  }
}

const isUrlOk = computed(() => {
  if (!url.value.trim()) return false;
  try { parseGithubReleaseUrl(url.value); return true; } catch { return false; }
});

const progressPercent = computed(() => total.value ? Math.round((loaded.value / total.value) * 100) : 0);

async function handleImport() {
  error.value = ''; success.value = ''; loaded.value = 0; total.value = null;
  if (!url.value.trim()) { error.value = 'URL wajib diisi'; return; }
  try { parseGithubReleaseUrl(url.value); } catch (e) { error.value = (e as Error).message; return; }
  loading.value = true;
  abortCtrl = new AbortController();
  try {
    const { buffer, filename } = await fetchGithubZip(
      url.value.trim(),
      token.value.trim() || undefined,
      (l, t) => { loaded.value = l; total.value = t; },
      abortCtrl.signal
    );
    const id = generateUUID();
    const opfsPath = `uploads/${id}.zip`;
    await saveBuffer(id, buffer);
    const meta: StoredFile = {
      id, name: filename, size: buffer.byteLength, type: 'application/zip',
      createdAt: Date.now(), opfsPath, sourceUrl: url.value.trim(), sourceType: 'github',
    };
    await addFile(meta);
    success.value = `"${filename}" (${formatBytes(buffer.byteLength)}) berhasil di-import dari GitHub`;
    emit('saved', meta);
    url.value = ''; urlHint.value = '';
  } catch (e) {
    if ((e as Error).message.includes('dibatalkan')) error.value = 'Download dibatalkan';
    else error.value = (e as Error).message;
  } finally { loading.value = false; abortCtrl = null; }
}
function handleCancel() { abortCtrl?.abort(); }
function handleKeydown(e: KeyboardEvent) { if (e.key === 'Enter' && !loading.value && isUrlOk.value) handleImport(); }
</script>

<template>
  <section class="card">
    <h2>Import dari GitHub Release</h2>
    <p class="desc">
      Paste URL release seperti
      <code>https://github.com/SoluEdu/ipas-k3b6/releases/download/v1.0.0/html5.zip</code>
      — untuk repo privat isi token tiap kali paste.
    </p>
    <label class="field">
      <span class="field-label">Release URL <span class="req">*</span></span>
      <input class="input" type="url" placeholder="https://github.com/owner/repo/releases/download/v1.0.0/file.zip" v-model="url" @input="handleUrlInput" @keydown="handleKeydown" :disabled="loading" />
      <span v-if="urlHint" class="hint" :class="{ 'hint-ok': isUrlOk, 'hint-err': !isUrlOk }">{{ urlHint }}</span>
    </label>
    <label class="field">
      <span class="field-label">Access Token <span class="muted">(opsional — untuk repo privat)</span></span>
      <div class="token-row">
        <input class="input token-input" :type="showToken ? 'text' : 'password'" placeholder="ghp_... / github_pat_..." v-model="token" :disabled="loading" />
        <button class="btn-ghost" type="button" @click="showToken = !showToken" :title="showToken ? 'Hide' : 'Show'">{{ showToken ? '🙈' : '👁' }}</button>
      </div>
      <span class="hint">Token tidak disimpan — hanya dipakai untuk request ini. Kosongkan untuk repo publik.</span>
    </label>
    <div class="actions">
      <button class="btn-primary" @click="handleImport" :disabled="loading || !isUrlOk">{{ loading ? 'Downloading…' : '📥 Import dari GitHub' }}</button>
      <button v-if="loading" class="btn-secondary" @click="handleCancel">Batal</button>
    </div>
    <div v-if="loading" class="progress">
      <div class="bar"><div class="fill" :style="{ width: (total ? progressPercent : 50) + '%' }"></div></div>
      <span class="mono">
        <template v-if="total">{{ formatBytes(loaded) }} / {{ formatBytes(total) }} ({{ progressPercent }}%)</template>
        <template v-else>{{ formatBytes(loaded) }} downloaded…</template>
      </span>
    </div>
    <div v-if="error" class="alert error">⚠ {{ error }}</div>
    <div v-if="success" class="alert success">✓ {{ success }}</div>
  </section>
</template>

<style scoped>
.card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 0.9rem; }
h2 { margin: 0; font-size: 1rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.desc { font-size: 0.82rem; color: var(--text-muted); line-height: 1.5; margin: 0; }
.desc code { font-family: monospace; font-size: 0.75rem; background: var(--bg); padding: 1px 6px; border-radius: 4px; word-break: break-all; }
.field { display: flex; flex-direction: column; gap: 0.35rem; }
.field-label { font-size: 0.8rem; font-weight: 600; color: var(--text); }
.req { color: #dc2626; } .muted { color: var(--text-muted); font-weight: 400; }
.input { width: 100%; padding: 0.55rem 0.75rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 0.85rem; outline: none; }
.input:focus { border-color: #3b82f6; } .input:disabled { opacity: 0.6; cursor: not-allowed; }
.hint { font-size: 0.72rem; color: var(--text-muted); word-break: break-all; } .hint-ok { color: #16a34a; } .hint-err { color: #d97706; }
.token-row { display: flex; gap: 0.4rem; } .token-input { flex: 1; }
.btn-ghost { padding: 0 0.6rem; border: 1px solid var(--border); background: var(--bg); border-radius: 6px; cursor: pointer; font-size: 1rem; line-height: 1; }
.actions { display: flex; gap: 0.5rem; align-items: center; }
.btn-primary { padding: 0.55rem 1.1rem; background: #3b82f6; color: #fff; border: none; border-radius: 6px; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; } .btn-primary:hover:not(:disabled) { background: #2563eb; }
.btn-secondary { padding: 0.5rem 0.9rem; background: transparent; color: var(--text-muted); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
.progress { display: flex; align-items: center; gap: 0.75rem; } .bar { flex: 1; height: 6px; background: var(--border); border-radius: 999px; overflow: hidden; } .fill { height: 100%; background: #3b82f6; border-radius: 999px; transition: width 0.15s; animation: pulse 1s infinite alternate; } .mono { font-family: monospace; font-size: 0.78rem; }
.alert { padding: 0.6rem 0.85rem; border-radius: 6px; font-size: 0.82rem; font-weight: 500; word-break: break-word; } .alert.error { background: #dc262618; color: #dc2626; border: 1px solid #dc262644; } .alert.success { background: #16a34a18; color: #16a34a; border: 1px solid #16a34a44; }
@keyframes pulse { from { opacity: 1; } to { opacity: 0.7; } }
</style>
