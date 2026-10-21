<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { getAllFiles, deleteFile as dbDelete, addFile } from '../lib/db/indexeddb';
import { getFile as opfsGet, deleteFile as opfsDelete, fileExists, extractGameToOPFS, deleteGame } from '../lib/storage/opfs';
import { extractZip, formatBytes, tryReadAsText } from '../lib/zip/zip';
import { imageMime, isImageName, readImageMeta } from '../lib/image/meta';
import { auditAssets } from '../lib/gameInfo/audit';
import { extractProjectData } from '../lib/gameInfo/parse';
import GameRunner from './GameRunner.vue';
import type { ZipEntry } from '../lib/zip/zip';
import type { ImageMeta } from '../lib/image/meta';
import type { StoredFile } from '../lib/db/indexeddb';

const emit = defineEmits<{ (e:'deleted', id:string):void; (e:'refreshStorage'):void }>();

const files = ref<StoredFile[]>([]);
const loading = ref(true);

const query = ref('');
const page = ref(1);
const PAGE_SIZE = 20;

const filteredFiles = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return files.value;
  return files.value.filter(f =>
    (f.label ?? '').toLowerCase().includes(q) || f.name.toLowerCase().includes(q));
});
const pageCount = computed(() => Math.max(1, Math.ceil(filteredFiles.value.length / PAGE_SIZE)));
const currentPage = computed(() => Math.min(page.value, pageCount.value));
const pagedFiles = computed(() => filteredFiles.value.slice(
  (currentPage.value - 1) * PAGE_SIZE, currentPage.value * PAGE_SIZE));

const displayName = (f: StoredFile) => f.label || f.name;
const downloadName = (f: StoredFile) => f.label
  ? (f.label.toLowerCase().endsWith('.zip') ? f.label : `${f.label}.zip`)
  : f.name;

function onSearch(){ page.value = 1; }

const projectData = computed(() => {
  const find = (n: string) => readEntries.value.find(e => e.name === n || e.name.endsWith('/' + n));
  const json = find('game.json');
  if (json) {
    const text = tryReadAsText(json);
    if (text) { try { return JSON.parse(text); } catch { /* fall back to data.js */ } }
  }
  const js = find('data.js') ?? find('code0.js');
  if (js) {
    const text = tryReadAsText(js);
    if (text) return extractProjectData(text);
  }
  return null;
});
const assetAudit = computed(() => projectData.value ? auditAssets(projectData.value, readEntries.value) : null);

const readTarget = ref<StoredFile | null>(null);
const readFile = ref<File | null>(null);
const readInOPFS = ref(false);
const readReadable = ref(false);
const readEntries = ref<ZipEntry[]>([]);
const readLoading = ref(false);
const readError = ref('');
const downloadUrl = ref('');
const entryQuery = ref('');
const entrySort = ref<'default'|'size-asc'|'size-desc'>('default');

const visibleEntries = computed(() => {
  const q = entryQuery.value.trim().toLowerCase();
  const list = q ? readEntries.value.filter(e => e.name.toLowerCase().includes(q)) : readEntries.value.slice();
  if (entrySort.value === 'size-asc') list.sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
  else if (entrySort.value === 'size-desc') list.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  return list;
});

const previewEntry = ref<ZipEntry | null>(null);
const previewUrl = ref('');
const previewMeta = ref<(ImageMeta & { mime: string }) | null>(null);
const previewError = ref('');

function clearPreview(){
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = ''; previewEntry.value = null; previewMeta.value = null; previewError.value = '';
}

function selectEntry(entry: ZipEntry){
  const mime = imageMime(entry.name);
  if (!mime) { clearPreview(); return; }
  clearPreview();
  previewEntry.value = entry;
  previewUrl.value = URL.createObjectURL(new Blob([new Uint8Array(entry.data)], { type: mime }));
  const meta = readImageMeta(entry.data, mime);
  previewMeta.value = { ...(meta ?? { width: 0, height: 0, bitDepth: null, channels: null, bitsPerPixel: null }), mime };
  if (!meta || !meta.width) {
    const img = new Image();
    img.onload = () => {
      if (!previewMeta.value) return;
      previewMeta.value.width = img.naturalWidth;
      previewMeta.value.height = img.naturalHeight;
    };
    img.onerror = () => { previewError.value = 'Preview gagal dimuat'; };
    img.src = previewUrl.value;
  }
}

const extractingId = ref('');
const extractProgress = ref(0);
const extractTotal = ref(0);

const runningGame = ref<StoredFile | null>(null);
const deletingId = ref('');

const toast = ref('');
const toastType = ref<'ok'|'err'>('ok');
function showToast(msg:string, type:'ok'|'err'='ok'){ toast.value=msg; toastType.value=type; setTimeout(()=> toast.value='', 3500); }

async function reload(){
  loading.value=true;
  try { files.value = (await getAllFiles()).sort((a,b)=> b.createdAt - a.createdAt); }
  finally { loading.value=false; }
}
onMounted(reload);

async function handleRead(meta: StoredFile){
  readTarget.value=meta; readFile.value=null; readInOPFS.value=false; readReadable.value=false; readEntries.value=[]; readError.value=''; readLoading.value=true; entryQuery.value=''; entrySort.value='default';
  if (downloadUrl.value){ URL.revokeObjectURL(downloadUrl.value); downloadUrl.value=''; }
  try {
    readInOPFS.value = await fileExists(meta.id);
    if (!readInOPFS.value){ readError.value='File not found in OPFS. It may have been removed externally.'; return; }
    readFile.value = await opfsGet(meta.id);
    readReadable.value = true;
    const buffer = await readFile.value.arrayBuffer();
    const entries = extractZip(buffer);
    readEntries.value = entries;
    const blob = new Blob([buffer], { type:'application/zip' });
    downloadUrl.value = URL.createObjectURL(blob);
  } catch(err){ readError.value=`Read failed: ${(err as Error).message}`; }
  finally { readLoading.value=false; }
}
function closeRead(){
  if (downloadUrl.value){ URL.revokeObjectURL(downloadUrl.value); downloadUrl.value=''; }
  clearPreview();
  readTarget.value=null;
}
async function handleExtract(meta: StoredFile){
  if (extractingId.value) return;
  extractingId.value=meta.id; extractProgress.value=0; extractTotal.value=0;
  try {
    const zipFile = await opfsGet(meta.id);
    const buffer = await zipFile.arrayBuffer();
    const entries = extractZip(buffer);
    const count = await extractGameToOPFS(meta.id, entries, (done,total)=>{ extractProgress.value=done; extractTotal.value=total; });
    const updated: StoredFile = { ...meta, extracted:true, entryCount: count };
    await addFile(updated);
    files.value = files.value.map(f=> f.id===meta.id ? updated : f);
    showToast(`Extracted ${count} files — ready to play!`);
    emit('refreshStorage');
  } catch(err){ showToast(`Extract failed: ${(err as Error).message}`, 'err'); }
  finally { extractingId.value=''; }
}
function handlePlay(meta: StoredFile){ runningGame.value = meta; }
async function handleRename(meta: StoredFile){
  const input = prompt('Custom name (kosongkan untuk pakai nama asli):', meta.label ?? '');
  if (input === null) return;
  const label = input.trim();
  const updated: StoredFile = { ...meta, label: label || undefined };
  try {
    await addFile(updated);
    files.value = files.value.map(f => f.id === meta.id ? updated : f);
    showToast(label ? `Renamed to "${label}"` : `Name reset to "${meta.name}"`);
  } catch(err){ showToast(`Rename failed: ${(err as Error).message}`, 'err'); }
}
async function handleDelete(meta: StoredFile){
  if (extractingId.value) return;
  const hasGame = meta.extracted;
  const msg = hasGame
    ? `Delete "${meta.name}"?\n\nThis will remove:\n• OPFS uploads/${meta.id}.zip\n• OPFS games/${meta.id}/ (extracted files)\n• IndexedDB record`
    : `Delete "${meta.name}"?\n\nThis will remove the OPFS file and IndexedDB record.`;
  if (!confirm(msg)) return;
  deletingId.value = meta.id;
  try {
    await opfsDelete(meta.id);
    if (hasGame) await deleteGame(meta.id);
    await dbDelete(meta.id);
    files.value = files.value.filter(f=> f.id!==meta.id);
    emit('deleted', meta.id);
    emit('refreshStorage');
    showToast(`"${meta.name}" deleted.`);
  } catch(err){ showToast(`Delete failed: ${(err as Error).message}`, 'err'); }
  finally { deletingId.value=''; }
}
function formatDate(ts:number){ return new Date(ts).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}); }
const extractPercent = computed(()=> extractTotal.value>0 ? Math.round((extractProgress.value/extractTotal.value)*100) : 0);

// Reusable extraction state helpers
const isExtractDisabled = (fileId?: string) => !!extractingId.value;
const isPlayDisabled = (fileId?: string) => !!extractingId.value || deletingId.value === fileId;
const getExtractTitle = (fileId?: string, isReExtract = false) => {
  if (extractingId.value) {
    return extractingId.value !== fileId ? 'Proses ekstraksi lain sedang berjalan' : '';
  }
  return isReExtract ? 'Ekstrak ulang file dari ZIP' : '';
};

defineExpose({ reload });
</script>

<template>
  <GameRunner v-if="runningGame" :game="runningGame" @close="runningGame=null" />
  <section class="card">
    <h2>Stored Files</h2>
    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="files.length===0" class="muted">No files stored yet. Upload a ZIP above.</p>
    <template v-else>
    <div class="toolbar">
      <input class="search" type="search" placeholder="Cari nama…" v-model="query" @input="onSearch" />
      <span class="count mono">{{ filteredFiles.length }} / {{ files.length }} file</span>
    </div>
    <p v-if="filteredFiles.length===0" class="muted">Tidak ada file yang cocok dengan "{{ query }}".</p>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Size</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <template v-for="file in pagedFiles" :key="file.id">
            <tr>
              <td class="name" :title="file.label ? `${file.label} — ${file.name}` : file.name">
                <span class="display-name">{{ displayName(file) }}</span>
                <span v-if="file.label" class="orig-name mono">{{ file.name }}</span>
              </td>
              <td class="mono">{{ formatBytes(file.size) }}</td>
              <td class="mono">{{ formatDate(file.createdAt) }}</td>
              <td>
                <span v-if="file.extracted" class="badge ok">✓ Extracted</span>
                <span v-else class="badge idle">ZIP only</span>
              </td>
              <td class="actions">
                <button class="btn-sm read" @click="handleRead(file)">Read</button>
                <template v-if="file.extracted">
                  <button class="btn-sm play" @click="handlePlay(file)" :disabled="isPlayDisabled(file.id)" :title="extractingId ? 'Proses ekstraksi sedang berjalan' : ''">▶ Play</button>
                  <button class="btn-sm reextract" @click="handleExtract(file)" :disabled="isExtractDisabled(file.id)" :title="getExtractTitle(file.id, true)">{{ extractingId===file.id ? `${extractPercent}%` : '🔄 Re-Extract' }}</button>
                </template>
                <button v-else class="btn-sm extract" @click="handleExtract(file)" :disabled="isExtractDisabled(file.id)" :title="getExtractTitle(file.id, false)">{{ extractingId===file.id ? `${extractPercent}%` : 'Extract' }}</button>
                <button class="btn-sm rename" @click="handleRename(file)" :disabled="deletingId===file.id">Rename</button>
                <button class="btn-sm del" @click="handleDelete(file)" :disabled="deletingId===file.id || isExtractDisabled(file.id)">{{ deletingId===file.id ? '…' : 'Delete' }}</button>
              </td>
            </tr>
            <tr v-if="extractingId===file.id && extractTotal>0" class="progress-row">
              <td colspan="5">
                <div class="extract-progress">
                  <div class="bar"><div class="fill" :style="{ width: extractPercent+'%' }" /></div>
                  <span class="mono">{{ extractProgress }} / {{ extractTotal }} files ({{ extractPercent }}%)</span>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <div v-if="pageCount > 1" class="pager">
      <button class="btn-sm page" :disabled="currentPage===1" @click="page=currentPage-1">← Prev</button>
      <span class="mono">Halaman {{ currentPage }} / {{ pageCount }}</span>
      <button class="btn-sm page" :disabled="currentPage===pageCount" @click="page=currentPage+1">Next →</button>
    </div>
    </template>
    <div v-if="toast" class="toast" :class="toastType==='ok' ? 'toast-ok' : 'toast-err'">{{ toast }}</div>
  </section>

  <div v-if="readTarget" class="overlay" @click="closeRead">
    <div class="modal" @click.stop>
      <div class="modal-header">
        <h3>📄 {{ readTarget.name }}</h3>
        <button class="close-btn" @click="closeRead">✕</button>
      </div>
      <p v-if="readLoading" class="muted">Reading from OPFS…</p>
      <div v-else-if="readError" class="alert error">{{ readError }}</div>
      <template v-else>
        <div class="read-grid">
          <div class="read-row"><span>File</span><span class="mono">{{ readTarget.name }}</span></div>
          <div class="read-row"><span>Size</span><span class="mono">{{ formatBytes(readTarget.size) }}</span></div>
          <div class="read-row"><span>Readable</span><span class="badge ok">{{ readReadable ? 'YES' : 'NO' }}</span></div>
          <div class="read-row"><span>In OPFS</span><span class="badge ok">{{ readInOPFS ? 'YES' : 'NO' }}</span></div>
          <div v-if="readTarget.extracted" class="read-row">
            <span>Extracted</span>
            <span class="badge ok">YES — {{ readTarget.entryCount }} files</span>
            <button class="btn-sm reextract" @click="handleExtract(readTarget)" :disabled="isExtractDisabled(readTarget.id)" :title="getExtractTitle(readTarget.id, true)">🔄 Re-Extract</button>
          </div>
        </div>
        <a v-if="downloadUrl" class="btn-download" :href="downloadUrl" :download="downloadName(readTarget)">⬇ Download ZIP</a>
        <div v-if="previewUrl" class="preview">
          <img :src="previewUrl" :alt="previewEntry?.name" @error="previewError = 'Preview gagal dimuat'" />
          <div class="preview-meta">
            <div class="read-row"><span>Name</span><span class="mono entry-name">{{ previewEntry?.name }}</span></div>
            <div class="read-row"><span>Type</span><span class="mono">{{ previewMeta?.mime }}</span></div>
            <div class="read-row"><span>Resolution</span><span class="mono">{{ previewMeta?.width }} × {{ previewMeta?.height }} px</span></div>
            <div class="read-row"><span>Bit depth</span><span class="mono">{{ previewMeta?.bitDepth ?? '—' }}<template v-if="previewMeta?.bitDepth">-bit</template></span></div>
            <div class="read-row"><span>Bits / pixel</span><span class="mono">{{ previewMeta?.bitsPerPixel ?? '—' }}<template v-if="previewMeta?.channels"> ({{ previewMeta?.channels }} channel)</template></span></div>
            <div class="read-row"><span>Size</span><span class="mono">{{ formatBytes(previewEntry?.size ?? 0) }}</span></div>
          </div>
        </div>
        <p v-if="previewError" class="alert error">{{ previewError }}</p>
        <details v-if="assetAudit" class="audit">
          <summary>
            🔍 Asset Audit — {{ assetAudit.used }}/{{ assetAudit.total }} dipakai
            <span class="audit-badge" :class="{ warn: assetAudit.unused.length > 0 }">{{ assetAudit.unused.length }} unused</span>
            <span v-if="assetAudit.missing.length" class="audit-badge err">{{ assetAudit.missing.length }} hilang</span>
          </summary>
          <p class="audit-sub">Referensi asset dicocokkan dari nama resource di seluruh isi project (game.json / data.js).</p>
          <p v-if="assetAudit.unused.length===0" class="muted">Semua asset di game.json dipakai.</p>
          <div v-else class="entries-list audit-list">
            <div v-for="a in assetAudit.unused" :key="a.name" class="entry">
              <span class="entry-icon">🗑</span>
              <span class="entry-name">{{ a.name }}</span>
              <span class="audit-kind">{{ a.kind }}</span>
              <span class="entry-size mono">{{ a.zipSize !== null ? formatBytes(a.zipSize) : 'not in zip' }}</span>
            </div>
          </div>
          <template v-if="assetAudit.missing.length">
            <p class="audit-sub">Dipakai tapi file tidak ada di ZIP:</p>
            <div class="entries-list audit-list">
              <div v-for="a in assetAudit.missing" :key="a.name" class="entry">
                <span class="entry-icon">⚠</span>
                <span class="entry-name">{{ a.name }}</span>
                <span class="audit-kind">{{ a.file }}</span>
              </div>
            </div>
          </template>
        </details>
        <div v-if="readEntries.length>0" class="entries">
          <div class="entries-head">
            <p class="entries-title">ZIP Contents ({{ visibleEntries.length }} / {{ readEntries.length }})</p>
            <div class="entries-tools">
              <input class="search entry-search" type="search" placeholder="Filter nama…" v-model="entryQuery" />
              <select class="select" v-model="entrySort">
                <option value="default">Default</option>
                <option value="size-desc">Size ↓</option>
                <option value="size-asc">Size ↑</option>
              </select>
            </div>
          </div>
          <p v-if="visibleEntries.length===0" class="muted">Tidak ada entry yang cocok.</p>
          <div v-else class="entries-list">
            <div v-for="entry in visibleEntries" :key="entry.name" class="entry" :class="{ dir: entry.isDirectory, selectable: isImageName(entry.name), selected: previewEntry?.name === entry.name }" @click="selectEntry(entry)">
              <span class="entry-icon">{{ entry.isDirectory ? '📂' : isImageName(entry.name) ? '🖼' : '📄' }}</span>
              <span class="entry-name">{{ entry.name }}</span>
              <span v-if="!entry.isDirectory" class="entry-size mono">{{ formatBytes(entry.size) }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem 1.5rem; position: relative; }
h2 { margin: 0 0 1rem; font-size: 1rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.muted { color: var(--text-muted); font-size: 0.875rem; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid var(--border); color: var(--text-muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
td { padding: 0.625rem 0.75rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
tr:last-child td { border-bottom: none; }
.name { font-weight: 500; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.display-name { display: block; overflow: hidden; text-overflow: ellipsis; }
.orig-name { display: block; color: var(--text-muted); font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; }
.toolbar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
.search { flex: 1; padding: 0.45rem 0.7rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 0.85rem; outline: none; }
.search:focus { border-color: #3b82f6; }
.count { color: var(--text-muted); white-space: nowrap; }
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 0.75rem; margin-top: 0.75rem; color: var(--text-muted); }
.btn-sm.page { background: #64748b22; color: var(--text-muted); border-color: #64748b44; }
.btn-sm.page:hover:not(:disabled) { background: #64748b33; }
.btn-sm.rename { background: #8b5cf622; color: #a78bfa; border-color: #8b5cf644; }
.btn-sm.rename:hover:not(:disabled) { background: #8b5cf633; }
.mono { font-family: monospace; font-size: 0.8rem; }
.badge { font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.03em; white-space: nowrap; }
.badge.ok { background: #16a34a22; color: #16a34a; border: 1px solid #16a34a44; }
.badge.idle { background: #64748b22; color: #94a3b8; border: 1px solid #64748b44; }
.actions { display: flex; gap: 0.375rem; flex-wrap: nowrap; }
.btn-sm { padding: 3px 10px; font-size: 0.75rem; font-weight: 600; border-radius: 4px; border: 1px solid transparent; cursor: pointer; transition: opacity 0.15s, background 0.15s; white-space: nowrap; }
.btn-sm:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-sm.read { background: #3b82f622; color: #3b82f6; border-color: #3b82f644; }
.btn-sm.read:hover { background: #3b82f633; }
.btn-sm.extract { background: #d9770622; color: #d97706; border-color: #d9770644; min-width: 58px; text-align: center; }
.btn-sm.extract:hover:not(:disabled) { background: #d9770633; }
.btn-sm.reextract { background: #d9770618; color: #f59e0b; border-color: #d9770644; }
.btn-sm.reextract:hover:not(:disabled) { background: #d9770630; }
.btn-sm.play { background: #16a34a22; color: #16a34a; border-color: #16a34a44; }
.btn-sm.play:hover { background: #16a34a33; }
.btn-sm.del { background: #dc262622; color: #dc2626; border-color: #dc262644; }
.btn-sm.del:hover:not(:disabled) { background: #dc262633; }
.progress-row td { padding: 0 0.75rem 0.75rem; border-bottom: 1px solid var(--border); }
.extract-progress { display: flex; align-items: center; gap: 0.75rem; }
.bar { flex: 1; height: 6px; background: var(--border); border-radius: 999px; overflow: hidden; }
.fill { height: 100%; background: #d97706; border-radius: 999px; transition: width 0.1s linear; }
.toast { position: absolute; bottom: 1rem; right: 1rem; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; font-weight: 500; animation: fadeIn 0.15s ease; z-index: 10; }
.toast-ok { background: #16a34a18; color: #16a34a; border: 1px solid #16a34a44; }
.toast-err { background: #dc262618; color: #dc2626; border: 1px solid #dc262644; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 1rem; }
.modal { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; max-width: 560px; width: 100%; max-height: 80vh; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem; }
.modal-header { display: flex; justify-content: space-between; align-items: center; }
.modal-header h3 { margin: 0; font-size: 1rem; font-weight: 700; word-break: break-all; }
.close-btn { background: none; border: none; font-size: 1.1rem; cursor: pointer; color: var(--text-muted); line-height: 1; padding: 0 0.25rem; }
.read-grid { display: flex; flex-direction: column; gap: 0.5rem; background: var(--bg); border-radius: 6px; padding: 0.75rem 1rem; font-size: 0.875rem; }
.read-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.btn-download { display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.6rem 1.25rem; background: #16a34a; color: #fff; text-decoration: none; border-radius: 6px; font-size: 0.875rem; font-weight: 600; transition: background 0.15s; align-self: flex-start; }
.btn-download:hover { background: #15803d; }
.entries-title { margin: 0 0 0.5rem; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.entries-head { display: flex; flex-direction: column; gap: 0.5rem; }
.entries-tools { display: flex; gap: 0.5rem; }
.entry-search { flex: 1; padding: 0.35rem 0.6rem; font-size: 0.78rem; }
.select { padding: 0.35rem 0.5rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 0.78rem; outline: none; }
.select:focus { border-color: #3b82f6; }
.entries-list { display: flex; flex-direction: column; gap: 2px; max-height: 240px; overflow-y: auto; background: var(--bg); border-radius: 6px; padding: 0.5rem; }
.entry { display: flex; align-items: center; gap: 0.5rem; padding: 2px 0.25rem; font-size: 0.8rem; border-radius: 4px; }
.entry:hover { background: var(--border); }
.entry.selectable { cursor: pointer; }
.entry.selected { background: #3b82f622; outline: 1px solid #3b82f644; }
.preview { display: flex; gap: 0.75rem; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem; }
.preview img { max-width: 200px; max-height: 160px; object-fit: contain; border-radius: 4px; background: #000; flex-shrink: 0; }
.preview-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.8rem; }
.audit { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.8rem; }
.audit summary { cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.audit-badge { font-size: 0.68rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: #16a34a22; color: #16a34a; border: 1px solid #16a34a44; }
.audit-badge.warn { background: #d9770622; color: #f59e0b; border-color: #d9770644; }
.audit-badge.err { background: #dc262622; color: #dc2626; border-color: #dc262644; }
.audit-list { margin-top: 0.5rem; max-height: 180px; }
.audit-kind { font-size: 0.68rem; color: var(--text-muted); flex-shrink: 0; }
.audit-sub { margin-top: 0.5rem; font-size: 0.72rem; color: var(--text-muted); }
.entry-icon { flex-shrink: 0; font-size: 0.9rem; }
.entry-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; }
.entry-size { color: var(--text-muted); flex-shrink: 0; }
.alert { padding: 0.625rem 0.875rem; border-radius: 6px; font-size: 0.875rem; font-weight: 500; }
.alert.error { background: #dc262618; color: #dc2626; border: 1px solid #dc262644; }
</style>
