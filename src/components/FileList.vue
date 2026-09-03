<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { getAllFiles, deleteFile as dbDelete, addFile } from '../lib/db/indexeddb';
import { getFile as opfsGet, deleteFile as opfsDelete, fileExists, extractGameToOPFS, deleteGame } from '../lib/storage/opfs';
import { extractZip, formatBytes } from '../lib/zip/zip';
import GameRunner from './GameRunner.vue';
import type { StoredFile } from '../lib/db/indexeddb';

const emit = defineEmits<{ (e:'deleted', id:string):void; (e:'refreshStorage'):void }>();

const files = ref<StoredFile[]>([]);
const loading = ref(true);

const readTarget = ref<StoredFile | null>(null);
const readFile = ref<File | null>(null);
const readInOPFS = ref(false);
const readReadable = ref(false);
const readEntries = ref<{ name:string; size:number; isDir:boolean }[]>([]);
const readLoading = ref(false);
const readError = ref('');
const downloadUrl = ref('');

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
  readTarget.value=meta; readFile.value=null; readInOPFS.value=false; readReadable.value=false; readEntries.value=[]; readError.value=''; readLoading.value=true;
  if (downloadUrl.value){ URL.revokeObjectURL(downloadUrl.value); downloadUrl.value=''; }
  try {
    readInOPFS.value = await fileExists(meta.id);
    if (!readInOPFS.value){ readError.value='File not found in OPFS. It may have been removed externally.'; return; }
    readFile.value = await opfsGet(meta.id);
    readReadable.value = true;
    const buffer = await readFile.value.arrayBuffer();
    const entries = extractZip(buffer);
    readEntries.value = entries.map(e=> ({ name:e.name, size:e.size, isDir:e.isDirectory }));
    const blob = new Blob([buffer], { type:'application/zip' });
    downloadUrl.value = URL.createObjectURL(blob);
  } catch(err){ readError.value=`Read failed: ${(err as Error).message}`; }
  finally { readLoading.value=false; }
}
function closeRead(){
  if (downloadUrl.value){ URL.revokeObjectURL(downloadUrl.value); downloadUrl.value=''; }
  readTarget.value=null;
}
async function handleExtract(meta: StoredFile){
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
async function handleDelete(meta: StoredFile){
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

defineExpose({ reload });
</script>

<template>
  <GameRunner v-if="runningGame" :game="runningGame" @close="runningGame=null" />
  <section class="card">
    <h2>Stored Files</h2>
    <p v-if="loading" class="muted">Loading…</p>
    <p v-else-if="files.length===0" class="muted">No files stored yet. Upload a ZIP above.</p>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Size</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <template v-for="file in files" :key="file.id">
            <tr>
              <td class="name" :title="file.name">{{ file.name }}</td>
              <td class="mono">{{ formatBytes(file.size) }}</td>
              <td class="mono">{{ formatDate(file.createdAt) }}</td>
              <td>
                <span v-if="file.extracted" class="badge ok">✓ Extracted</span>
                <span v-else class="badge idle">ZIP only</span>
              </td>
              <td class="actions">
                <button class="btn-sm read" @click="handleRead(file)">Read</button>
                <button v-if="file.extracted" class="btn-sm play" @click="handlePlay(file)">▶ Play</button>
                <button v-else class="btn-sm extract" @click="handleExtract(file)" :disabled="extractingId===file.id">{{ extractingId===file.id ? `${extractPercent}%` : 'Extract' }}</button>
                <button class="btn-sm del" @click="handleDelete(file)" :disabled="deletingId===file.id">{{ deletingId===file.id ? '…' : 'Delete' }}</button>
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
          <div v-if="readTarget.extracted" class="read-row"><span>Extracted</span><span class="badge ok">YES — {{ readTarget.entryCount }} files</span></div>
        </div>
        <a v-if="downloadUrl" class="btn-download" :href="downloadUrl" :download="readTarget.name">⬇ Download ZIP</a>
        <div v-if="readEntries.length>0" class="entries">
          <p class="entries-title">ZIP Contents ({{ readEntries.length }} entries)</p>
          <div class="entries-list">
            <div v-for="entry in readEntries" :key="entry.name" class="entry" :class="{ dir: entry.isDir }">
              <span class="entry-icon">{{ entry.isDir ? '📂' : '📄' }}</span>
              <span class="entry-name">{{ entry.name }}</span>
              <span v-if="!entry.isDir" class="entry-size mono">{{ formatBytes(entry.size) }}</span>
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
.entries-list { display: flex; flex-direction: column; gap: 2px; max-height: 240px; overflow-y: auto; background: var(--bg); border-radius: 6px; padding: 0.5rem; }
.entry { display: flex; align-items: center; gap: 0.5rem; padding: 2px 0.25rem; font-size: 0.8rem; border-radius: 4px; }
.entry:hover { background: var(--border); }
.entry-icon { flex-shrink: 0; font-size: 0.9rem; }
.entry-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; }
.entry-size { color: var(--text-muted); flex-shrink: 0; }
.alert { padding: 0.625rem 0.875rem; border-radius: 6px; font-size: 0.875rem; font-weight: 500; }
.alert.error { background: #dc262618; color: #dc2626; border: 1px solid #dc262644; }
</style>
