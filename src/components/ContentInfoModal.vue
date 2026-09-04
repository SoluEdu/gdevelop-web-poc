<script setup lang="ts">
import type { GameInfo } from '../lib/gameInfo/parse';
import { isValidPackageName } from '../lib/gameInfo/parse';
import type { StoredFile } from '../lib/db/indexeddb';
import { formatBytes } from '../lib/zip/zip';

const props = defineProps<{
  game: StoredFile;
  info: GameInfo | null;
  loading: boolean;
  error: string;
}>();
const emit = defineEmits<{ (e:'close'):void; (e:'openQa'):void }>();

function pkgOk(pkg:string){ return isValidPackageName(pkg); }
</script>
<template>
  <div class="overlay-info" @click="emit('close')">
    <div class="modal modal-info" @click.stop>
      <div class="modal-header">
        <h3>ⓘ Info Konten — {{ game.name }}</h3>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>

      <div v-if="loading" class="muted">Memuat info paket…</div>
      <div v-else-if="error" class="alert error">⚠ {{ error }}</div>

      <template v-else>
        <div v-if="!info" class="alert warn">
          Belum bisa baca <code>data.js</code> — pastikan game sudah <b>Extract</b> dan coba lagi.<br/>
          Menampilkan metadata IndexedDB sementara.
        </div>

        <!-- always show StoredFile basics -->
        <div class="grid">
          <div class="row"><span>File</span><span class="mono">{{ game.name }}</span></div>
          <div class="row"><span>Ukuran</span><span class="mono">{{ formatBytes(game.size) }}</span></div>
          <div class="row"><span>Entry</span><span class="mono">{{ game.entryCount ?? '—' }} files</span></div>
          <div v-if="game.sourceUrl" class="row"><span>Source</span><span class="mono small">{{ game.sourceUrl }}</span></div>
        </div>

        <div v-if="info" class="grid">
          <div class="row"><span>Nama (properties)</span><span class="mono">{{ info.name || '—' }}</span></div>
          <div class="row">
            <span>Package Name</span>
            <span class="mono pkg" :class="{ ok: pkgOk(info.packageName), bad: info.packageName && !pkgOk(info.packageName) }">
              {{ info.packageName || '—' }}
              <span v-if="info.packageName" class="badge" :class="pkgOk(info.packageName) ? 'ok':'warn'">{{ pkgOk(info.packageName) ? 'valid' : 'perlu cek' }}</span>
            </span>
          </div>
          <div class="row"><span>Deskripsi</span><span class="mono">{{ info.description || '—' }}</span></div>
          <div class="row"><span>Version</span><span class="mono">{{ info.version || '—' }}</span></div>
          <div class="row"><span>Author</span><span class="mono">{{ info.author || '—' }}{{ info.authorUsernames?.length ? ' ('+info.authorUsernames.join(', ')+')' : '' }}</span></div>
          <div class="row"><span>Resolusi</span><span class="mono">{{ info.windowWidth }} × {{ info.windowHeight }} ({{ info.orientation }}, {{ info.scaleMode }})</span></div>
          <div class="row"><span>FPS</span><span class="mono">min {{ info.minFPS }} / max {{ info.maxFPS }}</span></div>
          <div class="row"><span>First Layout</span><span class="mono">{{ info.firstLayout || '—' }}</span></div>
          <div class="row"><span>Project Type</span>
            <span class="mono">{{ info.folderProject===true ? 'Multiple Files ✓' : info.folderProject===false ? 'Single File' : '—' }}
              <span v-if="info.folderProject===true" class="badge ok">OK</span>
              <span v-else-if="info.folderProject===false" class="badge warn">cek: harus Multiple Files</span>
            </span>
          </div>
          <div class="row"><span>Project File</span><span class="mono">{{ info.projectFile || '—' }}</span></div>
          <div class="row"><span>Layouts / Resources</span><span class="mono">{{ info.layoutsCount }} / {{ info.resourcesCount }}</span></div>
          <div v-if="info.projectUuid" class="row"><span>Project UUID</span><span class="mono small">{{ info.projectUuid }}</span></div>
        </div>

        <div v-if="info && info.packageName" class="hint-box">
          <span class="hint">Pattern cek:</span> <code>co.id.solu.{subject}_k{n}b{n}</code> — K=kelas, B=bab/sub-bab. Contoh <code>co.id.solu.ipas_k3b6</code>
        </div>
      </template>

      <div class="modal-actions">
        <button class="btn-primary" @click="emit('openQa')">☑ Buka Checklist QA</button>
        <button class="btn-ghost" @click="emit('close')">Tutup</button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.overlay-info{position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:350;padding:1rem}
.modal-info{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.25rem 1.5rem;max-width:640px;width:100%;max-height:85vh;overflow-y:auto;display:flex;flex-direction:column;gap:1rem;box-shadow:0 24px 64px rgba(0,0,0,0.5)}
.modal-header{display:flex;justify-content:space-between;align-items:center;gap:1rem}
.modal-header h3{margin:0;font-size:0.95rem;font-weight:700;word-break:break-all}
.close-btn{background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--text-muted)}
.muted{color:var(--text-muted);font-size:0.85rem}
.alert{padding:0.6rem 0.85rem;border-radius:6px;font-size:0.82rem}
.alert.error{background:#dc262618;color:#dc2626;border:1px solid #dc262644}
.alert.warn{background:#d9770618;color:#d97706;border:1px solid #d9770644;word-break:break-word}
.alert code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:0.75rem}
.grid{display:flex;flex-direction:column;gap:0.45rem;background:var(--bg);border-radius:6px;padding:0.75rem 1rem;font-size:0.82rem}
.row{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}
.row span:first-child{color:var(--text-muted);flex-shrink:0;min-width:140px}
.mono{font-family:monospace;word-break:break-all;text-align:right}
.mono.small{font-size:0.72rem}
.mono.pkg{display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.badge{font-size:0.65rem;font-weight:700;padding:1px 6px;border-radius:999px;border:1px solid}
.badge.ok{background:#16a34a22;color:#16a34a;border-color:#16a34a44}
.badge.warn{background:#d9770622;color:#d97706;border-color:#d9770644}
.hint-box{font-size:0.75rem;color:var(--text-muted);background:var(--bg);border:1px dashed var(--border);border-radius:6px;padding:0.5rem 0.75rem}
.hint-box code{font-family:monospace;background:var(--card);padding:1px 5px;border-radius:4px}
.modal-actions{display:flex;gap:0.5rem;justify-content:flex-end;flex-wrap:wrap}
.btn-primary{padding:0.5rem 1rem;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:0.82rem;font-weight:600;cursor:pointer}
.btn-primary:hover{background:#2563eb}
.btn-ghost{padding:0.5rem 1rem;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--text-muted);cursor:pointer}
.btn-ghost:hover{background:var(--border);color:var(--text)}
</style>
