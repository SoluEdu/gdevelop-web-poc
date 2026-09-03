<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import type { StoredFile } from '../lib/db/indexeddb';
const props = defineProps<{ game: StoredFile }>();
const emit = defineEmits<{ (e:'close'):void }>();
const iframe = ref<HTMLIFrameElement|null>(null);
const isFullscreen = ref(false);
const iframeSrc = ref('');
const swStatus = ref<'waiting'|'ready'|'error'>('waiting');
const swError = ref('');
const gameUrl = `/games/${props.game.id}/index.html`;

// ── in-app console ──────────────────────────────────────────────────────────
interface LogEntry { id:number; level:'log'|'warn'|'error'|'info'|'debug'; text:string; time:string; }
const showConsole = ref(false);
const consoleMode = ref<'overlay'|'docked'>('overlay'); // default: overlay tidak merubah ukuran game
const consolePos = ref<'bottom'|'right'>('bottom'); // bottom = bawah, right = samping konten
const logs = ref<LogEntry[]>([]);
const filter = ref<'all'|'log'|'warn'|'error'|'info'>('all');
let logId = 0;
const errorCount = computed(()=> logs.value.filter(l=> l.level==='error').length);
const filteredLogs = computed(()=> filter.value==='all' ? logs.value : logs.value.filter(l=> l.level===filter.value));
function addLog(level:LogEntry['level'], args:string[]){
  const text = args.join(' ');
  logs.value.push({ id: ++logId, level, text, time: new Date().toLocaleTimeString() });
  if (logs.value.length>500) logs.value.shift();
}
function handleMessage(e:MessageEvent){
  if (e.data?.__opfsConsole){
    const { level, args } = e.data as { level:LogEntry['level']; args:string[] };
    addLog(level, args);
  }
}
function handleIframeLoad(){
  try {
    const w = iframe.value?.contentWindow as any;
    if (!w) return;
    const script = `
      (function(){
        if(window.__opfsConsolePatched) return;
        window.__opfsConsolePatched=true;
        const send=(level,args)=>{
          try{parent.postMessage({__opfsConsole:true,level,args:args.map(a=>{try{return typeof a==='object'? JSON.stringify(a):String(a)}catch{return String(a)}})},'*')}catch{}
        };
        ['log','warn','error','info','debug'].forEach(function(l){
          var orig=console[l];
          console[l]=function(){ var a=[].slice.call(arguments); try{send(l,a)}catch(e){}; return orig.apply(console,a); };
        });
        window.addEventListener('error', function(ev){ send('error',[ev.message+' @ '+ev.filename+':'+ev.lineno+':'+ev.colno]); });
        window.addEventListener('unhandledrejection', function(ev){ var r=ev.reason; send('error',['Unhandled rejection: '+(r&&r.message?r.message:String(r))]); });
        send('info',['Console ready — '+location.pathname]);
      })();
    `;
    w.eval(script);
  } catch(err){
    addLog('error', [`Inject failed: ${(err as Error).message}`]);
  }
}
function clearLogs(){ logs.value=[]; }
async function copyLogs(){
  const text = logs.value.map(l=> `[${l.time}] [${l.level}] ${l.text}`).join('\n');
  try { await navigator.clipboard.writeText(text); addLog('info',['Logs copied to clipboard']); } catch { /* ignore */ }
}
onMounted(()=> window.addEventListener('message', handleMessage));
onBeforeUnmount(()=> window.removeEventListener('message', handleMessage));

onMounted(async ()=>{
  if (!('serviceWorker' in navigator)) { swStatus.value='error'; swError.value='Service Worker not supported'; return; }
  try {
    let reg = await navigator.serviceWorker.getRegistration('/games/');
    if (!reg) reg = await navigator.serviceWorker.register('/sw.js', { scope: '/games/' });
    if (reg.active?.state==='activated') { swStatus.value='ready'; iframeSrc.value=gameUrl; return; }
    const worker = reg.installing || reg.waiting || reg.active;
    if (worker) {
      await new Promise<void>((resolve)=>{
        if (worker.state==='activated') return resolve();
        const onStateChange=()=>{ if(worker.state==='activated'){ worker.removeEventListener('statechange', onStateChange); resolve(); } };
        worker.addEventListener('statechange', onStateChange);
        setTimeout(resolve,1500);
      });
    }
    swStatus.value='ready'; iframeSrc.value=gameUrl;
  } catch(e){ swStatus.value='error'; swError.value=`SW failed: ${(e as Error).message}`; }
});
function close(){ if(iframe.value) iframe.value.src='about:blank'; emit('close'); }
async function toggleFullscreen(){
  if (!document.fullscreenElement){ await iframe.value?.requestFullscreen?.(); isFullscreen.value=true; }
  else { await document.exitFullscreen?.(); isFullscreen.value=false; }
}
function openInNewTab(){ window.open(gameUrl,'_blank'); }
</script>
<template>
  <div class="overlay" @click="close">
    <div class="runner" @click.stop>
      <div class="header">
        <div class="title"><span class="icon">🎮</span><div><span class="name">{{ game.name }}</span><span v-if="game.entryCount" class="meta">{{ game.entryCount }} files</span></div></div>
        <div class="actions">
          <button class="btn-icon" :class="{ active: showConsole }" title="Toggle console (logs from game)" @click="showConsole=!showConsole">
            <span>◧</span>
            <span v-if="errorCount" class="err-dot">{{ errorCount }}</span>
          </button>
          <button class="btn-icon" title="Open in new tab" @click="openInNewTab">⧉</button>
          <button class="btn-icon" title="Toggle fullscreen" @click="toggleFullscreen">{{ isFullscreen?'⊠':'⛶' }}</button>
          <button class="btn-icon btn-close" title="Close (Esc)" @click="close">✕</button>
        </div>
      </div>
      <!-- body: iframe + console (docked) ─────────────────────────────── -->
      <div class="body" :class="[`pos-${consolePos}`, `mode-${consoleMode}`, { 'has-docked': showConsole && consoleMode==='docked' }]">
        <div class="iframe-wrap">
          <div v-if="swStatus==='waiting'" class="sw-overlay"><div class="spinner"/><p>Waiting for Service Worker…</p></div>
          <div v-else-if="swStatus==='error'" class="sw-overlay error"><p>⚠ {{ swError }}</p><p class="hint">Make sure app is served over HTTPS and SW is registered.</p></div>
          <iframe v-else ref="iframe" :src="iframeSrc" :title="game.name" allow="autoplay; fullscreen" sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups" @load="handleIframeLoad" />
          <!-- overlay console — absolute, tidak merubah ukuran game -->
          <div v-if="showConsole && consoleMode==='overlay'" class="console console--overlay" :class="`pos-${consolePos}`">
            <div class="console-header" @click="showConsole=false" title="Collapse">
              <div class="console-title">
                <span>◧ Console</span>
                <span v-if="logs.length" class="console-count">{{ filteredLogs.length }}/{{ logs.length }}</span>
                <span v-if="errorCount" class="console-badge err">{{ errorCount }} errors</span>
                <span class="console-hint">{{ consolePos==='right' ? 'overlay · samping' : 'overlay · bawah' }}</span>
              </div>
              <div class="console-actions" @click.stop>
                <div class="seg">
                  <button class="seg-btn" :class="{on: consolePos==='bottom'}" @click="consolePos='bottom'" title="Pindah ke bawah">▭ Bottom</button>
                  <button class="seg-btn" :class="{on: consolePos==='right'}" @click="consolePos='right'" title="Pindah ke samping">▯ Side</button>
                </div>
                <div class="seg">
                  <button class="seg-btn" :class="{on: consoleMode==='overlay'}" @click="consoleMode='overlay'" title="Overlay — tidak merubah ukuran game">Overlay</button>
                  <button class="seg-btn" :class="{on: consoleMode==='docked'}" @click="consoleMode='docked'" title="Docked — merubah ukuran game (fixed)">Docked</button>
                </div>
                <select v-model="filter" class="console-filter">
                  <option value="all">All</option>
                  <option value="log">Log</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
                <button class="btn-console" @click="copyLogs" title="Copy logs">⧉ Copy</button>
                <button class="btn-console" @click="clearLogs" title="Clear">Clear</button>
                <button class="btn-console close" @click="showConsole=false" title="Collapse">⌄</button>
              </div>
            </div>
            <div class="console-body">
              <div v-if="filteredLogs.length===0" class="console-empty">{{ logs.length===0 ? 'No logs yet — run the game to see output' : 'No logs for this filter' }}</div>
              <div v-for="l in filteredLogs" :key="l.id" class="log-row" :class="l.level">
                <span class="log-time">{{ l.time }}</span>
                <span class="log-level">{{ l.level }}</span>
                <span class="log-text">{{ l.text }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- docked console — fixed, merubah ukuran game -->
        <div v-if="showConsole && consoleMode==='docked'" class="console console--docked" :class="`pos-${consolePos}`">
          <div class="console-header">
            <div class="console-title">
              <span>◧ Console</span>
              <span v-if="logs.length" class="console-count">{{ filteredLogs.length }}/{{ logs.length }}</span>
              <span v-if="errorCount" class="console-badge err">{{ errorCount }} errors</span>
              <span class="console-hint">docked · {{ consolePos==='right' ? 'samping' : 'bawah' }} · fixed</span>
            </div>
            <div class="console-actions" @click.stop>
              <div class="seg">
                <button class="seg-btn" :class="{on: consolePos==='bottom'}" @click="consolePos='bottom'">▭ Bottom</button>
                <button class="seg-btn" :class="{on: consolePos==='right'}" @click="consolePos='right'">▯ Side</button>
              </div>
              <div class="seg">
                <button class="seg-btn" :class="{on: consoleMode==='overlay'}" @click="consoleMode='overlay'">Overlay</button>
                <button class="seg-btn" :class="{on: consoleMode==='docked'}" @click="consoleMode='docked'">Docked</button>
              </div>
              <select v-model="filter" class="console-filter">
                <option value="all">All</option>
                <option value="log">Log</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
              <button class="btn-console" @click="copyLogs" title="Copy logs">⧉ Copy</button>
              <button class="btn-console" @click="clearLogs" title="Clear">Clear</button>
              <button class="btn-console close" @click="showConsole=false" title="Collapse">⌄</button>
            </div>
          </div>
          <div class="console-body">
            <div v-if="filteredLogs.length===0" class="console-empty">{{ logs.length===0 ? 'No logs yet — run the game to see output' : 'No logs for this filter' }}</div>
            <div v-for="l in filteredLogs" :key="l.id" class="log-row" :class="l.level">
              <span class="log-time">{{ l.time }}</span>
              <span class="log-level">{{ l.level }}</span>
              <span class="log-text">{{ l.text }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="footer"><span class="url mono">{{ gameUrl }}</span><span class="hint">Served from OPFS via Service Worker · Press Esc to close · Console: {{ consoleMode }} {{ consolePos }}</span></div>
    </div>
  </div>
</template>
<style scoped>
.overlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:200;padding:1rem}
.runner{background:var(--card);border:1px solid var(--border);border-radius:12px;width:min(1200px,100%);height:min(820px,90dvh);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.6)}
.header{display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;border-bottom:1px solid var(--border);gap:1rem;flex-shrink:0}
.title{display:flex;align-items:center;gap:0.625rem;min-width:0}
.icon{font-size:1.4rem;flex-shrink:0}
.name{font-weight:700;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.meta{font-size:0.75rem;color:var(--text-muted);display:block}
.actions{display:flex;gap:0.375rem;flex-shrink:0}
.btn-icon{background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:6px;width:32px;height:32px;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
.btn-icon:hover{background:var(--border);color:var(--text)}
.btn-close:hover{background:#dc262622;color:#dc2626;border-color:#dc262644}
.body{ flex:1; display:flex; overflow:hidden; min-height:0; position:relative; }
.body.pos-bottom{ flex-direction:column; }
.body.pos-right{ flex-direction:row; }
.body.has-docked.pos-bottom .iframe-wrap{ flex:1; min-height:0; }
.body.has-docked.pos-right .iframe-wrap{ flex:1; min-width:0; }
.iframe-wrap{flex:1;overflow:hidden;background:#000;position:relative; min-height:0; min-width:0; }
iframe{width:100%;height:100%;border:none;display:block}
.sw-overlay{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;color:var(--text-muted);font-size:0.9rem}
.sw-overlay.error{color:#dc2626;text-align:center;padding:2rem}
.sw-overlay .hint{font-size:0.8rem;color:var(--text-muted);margin:0}
.spinner{width:36px;height:36px;border:3px solid var(--border);border-top-color:#3b82f6;border-radius:50%;animation:spin 0.7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.footer{display:flex;align-items:center;justify-content:space-between;padding:0.4rem 1rem;border-top:1px solid var(--border);gap:1rem;flex-shrink:0}
.url{font-size:0.72rem;color:#3b82f6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hint{font-size:0.72rem;color:var(--text-muted);white-space:nowrap;flex-shrink:0}
.mono{font-family:monospace}

/* ── console ── */
.btn-icon.active{ background: var(--border); color: var(--text); position: relative; }
.err-dot{ position: absolute; top: -6px; right: -6px; background: #dc2626; color: #fff; font-size: 0.6rem; font-weight: 700; min-width: 16px; height: 16px; border-radius: 999px; display: flex; align-items: center; justify-content: center; padding: 0 3px; }
/* accordion — overlay vs docked */
.console{ display: flex; flex-direction: column; border-top: 1px solid var(--border); background: #0a0c12; }
/* overlay — absolute, tidak merubah ukuran game (default) */
.console--overlay{
  position: absolute;
  z-index: 10;
  border-top: 1px solid #1e293b;
  box-shadow: 0 -12px 32px rgba(0,0,0,0.65);
  animation: slideUp 0.18s ease;
}
.console--overlay.pos-bottom{ left:0; right:0; bottom:0; height:42%; min-height:180px; max-height:55%; }
.console--overlay.pos-right{ top:0; right:0; bottom:0; width:380px; max-width:45%; min-width:280px; height:auto; border-top:none; border-left:1px solid #1e293b; box-shadow: -12px 0 32px rgba(0,0,0,0.65); animation: slideSide 0.18s ease; }
/* docked — fixed, merubah ukuran game */
.console--docked{ flex-shrink:0; }
.console--docked.pos-bottom{ height:38%; min-height:160px; max-height:50%; border-top:1px solid #1e293b; }
.console--docked.pos-right{ width:380px; min-width:300px; max-width:45%; border-top:none; border-left:1px solid #1e293b; }
@keyframes slideUp { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes slideSide { from { transform: translateX(12px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
.seg{ display:flex; border:1px solid var(--border); border-radius:6px; overflow:hidden; }
.seg-btn{ background: var(--card); border:none; color:var(--text-muted); padding:0.2rem 0.45rem; font-size:0.68rem; font-weight:600; cursor:pointer; border-right:1px solid var(--border); }
.seg-btn:last-child{ border-right:none; }
.seg-btn.on{ background: var(--border); color: var(--text); }
.seg-btn:hover{ background: var(--border); }
.console-hint{ font-size:0.65rem; color:var(--text-muted); font-weight:400; border:1px solid var(--border); padding:1px 6px; border-radius:999px; }
.console-header{ display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--border); background: #0f1117; gap: 0.5rem; flex-shrink: 0; cursor: pointer; }
.console--overlay .console-header{ cursor: pointer; }
.console-title{ display: flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; font-weight: 600; color: var(--text); }
.console-count{ font-size: 0.7rem; color: var(--text-muted); font-weight: 400; }
.console-badge.err{ background: #dc262622; color: #dc2626; border: 1px solid #dc262644; padding: 1px 6px; border-radius: 999px; font-size: 0.68rem; font-weight: 700; }
.console-actions{ display: flex; align-items: center; gap: 0.35rem; }
.console-filter{ background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 0.2rem 0.35rem; font-size: 0.72rem; outline: none; }
.btn-console{ background: var(--card); border: 1px solid var(--border); color: var(--text-muted); border-radius: 6px; padding: 0.2rem 0.5rem; font-size: 0.72rem; cursor: pointer; }
.btn-console:hover{ background: var(--border); color: var(--text); }
.btn-console.close:hover{ background: #dc262622; color: #dc2626; border-color: #dc262644; }
.console-body{ flex: 1; overflow-y: auto; padding: 0.5rem 0; font-family: monospace; font-size: 0.73rem; line-height: 1.45; }
.console-empty{ color: var(--text-muted); text-align: center; padding: 1.5rem; font-family: sans-serif; font-size: 0.82rem; }
.log-row{ display: flex; gap: 0.5rem; padding: 0.18rem 0.75rem; border-left: 3px solid transparent; word-break: break-all; }
.log-row:hover{ background: rgba(255,255,255,0.04); }
.log-row.log{ border-color: transparent; color: #e2e8f0; }
.log-row.info{ border-color: #3b82f6; color: #93c5fd; background: #3b82f608; }
.log-row.warn{ border-color: #d97706; color: #fcd34d; background: #d977060d; }
.log-row.error{ border-color: #dc2626; color: #fca5a5; background: #dc26260d; }
.log-row.debug{ border-color: #6b7280; color: #9ca3af; }
.log-time{ color: #64748b; white-space: nowrap; flex-shrink: 0; }
.log-level{ text-transform: uppercase; font-weight: 700; min-width: 2.8rem; flex-shrink: 0; opacity: 0.9; }
.log-text{ flex: 1; white-space: pre-wrap; }
</style>
