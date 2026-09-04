<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { QaState } from '../lib/qa/todoStore';
import { toMarkdown, progress, detectEnv } from '../lib/qa/todoStore';

const props = defineProps<{
  gameName: string;
  modelValue: QaState;
  packageName?: string;
  floating?: boolean; // true = overlay floating, false = docked (not used now)
}>();
const emit = defineEmits<{
  (e:'update:modelValue', v: QaState): void;
  (e:'close'): void;
  (e:'openInfo'): void;
}>();

const state = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
});

const prog = computed(()=> progress(state.value));
const copyOk = ref(false);
const showMeta = ref(true);

function toggle(id: string, childId?: string){
  const s = JSON.parse(JSON.stringify(state.value)) as QaState;
  for (const sec of s.sections) for (const it of sec.items) {
    if (it.id===id) {
      if (childId && it.children) {
        const c = it.children.find(c=>c.id===childId);
        if (c) c.done = !c.done;
        // parent auto reflects if all children done? keep manual
      } else {
        it.done = !it.done;
      }
    }
  }
  state.value = s;
}
function updateMeta<K extends keyof QaState['meta']>(k:K, v:string){
  const s = { ...state.value, meta:{ ...state.value.meta, [k]: v } };
  state.value = s;
}
async function copyMarkdown(){
  const md = toMarkdown(state.value, props.gameName, { packageName: props.packageName });
  try { await navigator.clipboard.writeText(md); copyOk.value=true; setTimeout(()=>copyOk.value=false, 1500); } catch {}
}
function addItem(secKey:string){
  const label = prompt('Tambah item checklist:');
  if (!label || !label.trim()) return;
  const s = JSON.parse(JSON.stringify(state.value)) as QaState;
  const sec = s.sections.find(s=>s.key===secKey);
  if (!sec) return;
  const id = 'custom-' + Date.now().toString(36);
  sec.items.push({ id, label: label.trim(), done: false });
  state.value = s;
}
function removeItem(secKey:string, id:string){
  if (!confirm('Hapus item ini?')) return;
  const s = JSON.parse(JSON.stringify(state.value)) as QaState;
  const sec = s.sections.find(s=>s.key===secKey);
  if (!sec) return;
  sec.items = sec.items.filter(i=>i.id!==id);
  state.value = s;
}
</script>
<template>
  <div class="qa-drawer" :class="{ floating }">
    <div class="qa-header" @click="emit('close')" title="Collapse">
      <div class="qa-title">
        <span>☑ QA Checklist</span>
        <span class="qa-count">{{ prog.done }}/{{ prog.total }}</span>
        <span v-if="prog.done===prog.total && prog.total>0" class="badge ok">done</span>
      </div>
      <div class="qa-actions" @click.stop>
        <button class="btn-qa ghost" @click="emit('openInfo')" title="Lihat Info Paket">ⓘ Info</button>
        <button class="btn-qa" @click="copyMarkdown" title="Copy markdown">{{ copyOk ? '✓ Copied' : '⧉ Copy MD' }}</button>
        <button class="btn-qa close" @click="emit('close')" title="Tutup">⌄</button>
      </div>
    </div>

    <div class="qa-body">
      <!-- Meta -->
      <div class="qa-meta-toggle" @click="showMeta=!showMeta">
        <span class="meta-title">Info Proyek</span>
        <span class="meta-caret">{{ showMeta ? '▾' : '▸' }}</span>
      </div>
      <div v-if="showMeta" class="qa-meta">
        <label class="field"><span>Nama Tester</span><input :value="state.meta.tester" @input="updateMeta('tester', ($event.target as HTMLInputElement).value)" placeholder="—" /></label>
        <label class="field"><span>Tanggal</span><input type="date" :value="state.meta.date" @input="updateMeta('date', ($event.target as HTMLInputElement).value)" /></label>
        <label class="field">
          <span>Lingkungan / Browser <button class="btn-mini" @click="updateMeta('env', detectEnv())" title="Deteksi ulang">↻ Deteksi</button></span>
          <input :value="state.meta.env" @input="updateMeta('env', ($event.target as HTMLInputElement).value)" placeholder="PC Chrome / Mobile Safari" />
        </label>
        <div class="mini-hint">Otomatis terisi dari browser. Tersimpan per game, dipakai saat copy markdown.</div>
      </div>

      <!-- Sections -->
      <div v-for="sec in state.sections" :key="sec.key" class="qa-section">
        <div class="sec-title">{{ sec.title }}</div>
        <div v-for="it in sec.items" :key="it.id" class="qa-item">
          <label class="check">
            <input type="checkbox" :checked="it.done" @change="toggle(it.id)" />
            <span class="label-text" :class="{ done: it.done }">{{ it.label }}</span>
          </label>
          <button v-if="it.id.startsWith('custom-')" class="btn-del" @click="removeItem(sec.key, it.id)" title="Hapus">✕</button>
          <div v-if="it.children" class="children">
            <label v-for="c in it.children" :key="c.id" class="check child">
              <input type="checkbox" :checked="c.done" @change="toggle(it.id, c.id)" />
              <span class="label-text" :class="{ done: c.done }">{{ c.label }}</span>
            </label>
          </div>
        </div>
        <button class="btn-add" @click="addItem(sec.key)">+ Tambah item</button>
      </div>
    </div>
    <div class="qa-footer">
      <span class="mono small">Progress {{ prog.done }}/{{ prog.total }}</span>
      <span class="hint">Floating — hide/unhide pakai tombol QA di header. Copy menghasilkan markdown persis format kamu.</span>
    </div>
  </div>
</template>
<style scoped>
.qa-drawer{ display:flex; flex-direction:column; background:#0a0c12; border:1px solid #1e293b; border-left-width:1px; overflow:hidden; }
.qa-drawer.floating{ position:absolute; z-index:12; top:0; right:0; bottom:0; width:380px; max-width:46%; min-width:300px; box-shadow:-12px 0 32px rgba(0,0,0,0.65); animation: slideSide 0.18s ease; border-left:1px solid #1e293b; }
@media (max-width: 700px){ .qa-drawer.floating{ width:100%; max-width:100%; } }
@keyframes slideSide{ from{ transform:translateX(12px); opacity:0 } to{ transform:translateX(0); opacity:1 } }
.qa-header{ display:flex; align-items:center; justify-content:space-between; padding:0.45rem 0.75rem; background:#0f1117; border-bottom:1px solid var(--border); gap:0.5rem; cursor:pointer; flex-shrink:0; }
.qa-title{ display:flex; align-items:center; gap:0.5rem; font-size:0.8rem; font-weight:700; color:var(--text); }
.qa-count{ font-size:0.7rem; color:var(--text-muted); font-weight:400; }
.badge.ok{ background:#16a34a22; color:#16a34a; border:1px solid #16a34a44; padding:1px 6px; border-radius:999px; font-size:0.65rem; }
.qa-actions{ display:flex; gap:0.35rem; align-items:center; }
.btn-qa{ background:var(--card); border:1px solid var(--border); color:var(--text-muted); border-radius:6px; padding:0.2rem 0.5rem; font-size:0.72rem; cursor:pointer; }
.btn-qa:hover{ background:var(--border); color:var(--text); }
.btn-qa.close:hover{ background:#dc262622; color:#dc2626; border-color:#dc262644; }
.btn-qa.ghost{ background:transparent; }
.qa-body{ flex:1; overflow-y:auto; padding:0.6rem 0.75rem; display:flex; flex-direction:column; gap:0.9rem; font-size:0.82rem; }
.qa-meta-toggle{ display:flex; justify-content:space-between; align-items:center; font-weight:700; color:var(--text-muted); text-transform:uppercase; font-size:0.7rem; letter-spacing:0.04em; cursor:pointer; user-select:none; }
.qa-meta{ display:flex; flex-direction:column; gap:0.5rem; background:var(--card); border:1px solid var(--border); border-radius:6px; padding:0.6rem; }
.field{ display:flex; flex-direction:column; gap:0.25rem; }
.field span{ font-size:0.7rem; color:var(--text-muted); font-weight:600; }
.field input{ background:var(--bg); border:1px solid var(--border); color:var(--text); border-radius:6px; padding:0.4rem 0.6rem; font-size:0.8rem; outline:none; }
.field input:focus{ border-color:#3b82f6; }
.btn-mini{ background:var(--bg); border:1px solid var(--border); color:var(--text-muted); border-radius:999px; padding:0 6px; font-size:0.6rem; cursor:pointer; margin-left:0.4rem; }
.btn-mini:hover{ background:var(--border); color:var(--text); }
.mini-hint{ font-size:0.65rem; color:var(--text-muted); }
.qa-section{ display:flex; flex-direction:column; gap:0.35rem; }
.sec-title{ font-size:0.75rem; font-weight:700; color:#93c5fd; margin-top:0.2rem; }
.qa-item{ display:flex; flex-direction:column; gap:0.2rem; padding:0.2rem 0; }
.check{ display:flex; gap:0.5rem; align-items:flex-start; cursor:pointer; }
.check input{ margin-top:0.2rem; accent-color:#3b82f6; }
.label-text{ font-size:0.78rem; line-height:1.4; }
.label-text.done{ color:var(--text-muted); text-decoration:line-through; }
.children{ margin-left:1.6rem; display:flex; flex-direction:column; gap:0.15rem; border-left:1px dashed var(--border); padding-left:0.6rem; }
.check.child .label-text{ font-size:0.74rem; }
.btn-del{ align-self:flex-start; margin-left:1.6rem; background:none; border:none; color:#dc2626; cursor:pointer; font-size:0.7rem; }
.btn-add{ align-self:flex-start; margin-top:0.15rem; background:transparent; border:1px dashed var(--border); color:var(--text-muted); border-radius:6px; padding:0.15rem 0.5rem; font-size:0.7rem; cursor:pointer; }
.btn-add:hover{ background:var(--card); color:var(--text); }
.qa-footer{ display:flex; flex-direction:column; gap:0.2rem; padding:0.45rem 0.75rem; border-top:1px solid var(--border); background:#0f1117; flex-shrink:0; }
.mono{ font-family:monospace; }
.small{ font-size:0.7rem; color:var(--text-muted); }
.hint{ font-size:0.65rem; color:var(--text-muted); line-height:1.3; }
</style>
