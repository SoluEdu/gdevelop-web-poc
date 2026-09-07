<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, nextTick } from 'vue';
import { isMimeSupported, transcodeWebMToMP4, type TranscodeProgress } from '../lib/utils/transcoder';

const props = defineProps<{ gameName: string }>();

// ── overlay draw/type ───────────────────────────────────────────────
const overlayRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const showOverlay = ref(false);
const tool = ref<'pen'|'rect'|'arrow'|'text'>('pen');
const color = ref('#ff3b30');
const width = ref(3);
const isDrawing = ref(false);
let ctx: CanvasRenderingContext2D | null = null;
let startX = 0, startY = 0;
let snapshot: ImageData | null = null;
interface TextBox { id:number; x:number; y:number; text:string; color:string; editing:boolean }
const texts = ref<TextBox[]>([]);
let textId = 0;
const history: ImageData[] = [];

function getWrap(): HTMLElement | null {
  const fromRef = overlayRef.value?.closest('.iframe-wrap') as HTMLElement | null;
  if (fromRef) return fromRef;
  return document.querySelector('.iframe-wrap') as HTMLElement | null;
}

function resizeCanvas(){
  const wrap = getWrap();
  const c = canvasRef.value;
  if (!wrap || !c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = w + 'px';
  c.style.height = h + 'px';
  ctx = c.getContext('2d');
  if (ctx){
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.lineCap='round'; ctx.lineJoin='round';
  }
}

function enableOverlay(){
  showOverlay.value = true;
  nextTick(()=> {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  });
}
function disableOverlay(){
  showOverlay.value = false;
  window.removeEventListener('resize', resizeCanvas);
}

function pos(e: PointerEvent){
  const c = canvasRef.value!;
  const r = c.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onPointerDown(e: PointerEvent){
  if (!ctx || !canvasRef.value) { if (!ctx) resizeCanvas(); if (!ctx) return; }
  // Prevent creating new text box or starting drawing when interacting with text popups / inputs / buttons
  if (e.target !== canvasRef.value && e.target !== overlayRef.value) {
    return;
  }
  if (tool.value==='text'){
    const p = pos(e);
    const id = ++textId;
    texts.value.push({ id, x:p.x, y:p.y, text:'Tulis pesan bug...', color: color.value, editing:true });
    nextTick(()=> {
      const el = document.getElementById('tbox-'+id) as HTMLInputElement | null;
      el?.focus(); el?.select();
    });
    return;
  }
  isDrawing.value = true;
  try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
  const p = pos(e);
  startX = p.x; startY = p.y;
  try { snapshot = ctx!.getImageData(0,0, canvasRef.value!.width, canvasRef.value!.height); history.push(snapshot); if (history.length>20) history.shift(); } catch { snapshot=null; }
  ctx!.strokeStyle = color.value;
  ctx!.lineWidth = width.value;
  ctx!.beginPath();
  ctx!.moveTo(p.x, p.y);
}
function onPointerMove(e: PointerEvent){
  if (!isDrawing.value || !ctx) return;
  const p = pos(e);
  if (tool.value==='pen'){
    ctx.strokeStyle = color.value; ctx.lineWidth = width.value;
    ctx.lineTo(p.x, p.y); ctx.stroke();
  } else if (tool.value==='rect'){
    if (snapshot) ctx.putImageData(snapshot,0,0);
    ctx.strokeStyle = color.value; ctx.lineWidth = width.value;
    ctx.strokeRect(startX, startY, p.x-startX, p.y-startY);
  } else if (tool.value==='arrow'){
    if (snapshot) ctx.putImageData(snapshot,0,0);
    drawArrow(startX,startY,p.x,p.y);
  }
}
function onPointerUp(e: PointerEvent){
  if (!isDrawing.value) return;
  isDrawing.value=false;
  try{ (e.target as Element).releasePointerCapture(e.pointerId);}catch{}
  snapshot=null;
}
function drawArrow(x1:number,y1:number,x2:number,y2:number){
  if (!ctx) return;
  const head = 14;
  const angle = Math.atan2(y2-y1, x2-x1);
  ctx.strokeStyle = color.value; ctx.lineWidth = width.value;
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2,y2);
  ctx.lineTo(x2 - head*Math.cos(angle-Math.PI/6), y2 - head*Math.sin(angle-Math.PI/6));
  ctx.moveTo(x2,y2);
  ctx.lineTo(x2 - head*Math.cos(angle+Math.PI/6), y2 - head*Math.sin(angle+Math.PI/6));
  ctx.stroke();
}
function undo(){
  if (history.length===0) return;
  const prev = history.pop()!;
  try { ctx?.putImageData(prev,0,0); } catch {}
}
function clearAll(){
  if (!ctx || !canvasRef.value) return;
  ctx.clearRect(0,0,canvasRef.value.width, canvasRef.value.height);
  texts.value=[];
  history.length=0;
}
function updateText(id:number, v:string){
  const t = texts.value.find(t=>t.id===id);
  if (t) t.text = v;
}
function deleteText(id:number){
  texts.value = texts.value.filter(t => t.id !== id);
}

function handleKeydown(e: KeyboardEvent){
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd'){
    e.preventDefault();
    if (!showOverlay.value) enableOverlay();
    tool.value = 'pen';
  }
  if (e.key === 'Escape' && showOverlay.value){
    disableOverlay();
  }
}
onMounted(()=> window.addEventListener('keydown', handleKeydown));
onBeforeUnmount(()=> window.removeEventListener('keydown', handleKeydown));

// ── format & codec settings ─────────────────────────────────────────
const exportFormat = ref<'webm'|'mp4'|'custom'>('webm');
const customMime = ref('video/mp4;codecs=avc1');
const isTranscoding = ref(false);
const transcodeProg = ref<TranscodeProgress | null>(null);
const activeFormatExt = ref<'webm'|'mp4'>('webm');

const targetMime = computed(() => {
  if (exportFormat.value === 'webm') {
    return isMimeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9'
         : isMimeSupported('video/webm') ? 'video/webm'
         : 'video/webm';
  }
  if (exportFormat.value === 'mp4') {
    return 'video/mp4;codecs=avc1';
  }
  return customMime.value.trim();
});

const isNativeCodecSupported = computed(() => {
  return isMimeSupported(targetMime.value);
});

// ── screen record ───────────────────────────────────────────────────
const isRecording = ref(false);
const recTime = ref(0);
const recError = ref('');
const recUrl = ref('');
const recBlob = ref<Blob|null>(null);
let mediaRecorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let timer: number | null = null;
let stream: MediaStream | null = null;
let isDirectNativeRecord = false;

async function startRecording(){
  recError.value='';
  if (recUrl.value){ try{ URL.revokeObjectURL(recUrl.value);}catch{}; recUrl.value=''; }
  recBlob.value=null; chunks=[];
  try {
    const wrap = document.querySelector('.iframe-wrap') as HTMLElement | null;
    if (!wrap) throw new Error('Game area not found');

    let captureStream: MediaStream;
    try {
      captureStream = await (navigator.mediaDevices as unknown as { getDisplayMedia: (c: unknown) => Promise<MediaStream> }).getDisplayMedia({
        video: { displaySurface: 'browser' } as unknown as MediaTrackConstraints,
        audio: true,
        preferCurrentTab: true,
      } as unknown as DisplayMediaStreamOptions) as MediaStream;
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name === 'NotAllowedError') throw new Error('Izin screen capture ditolak');
      throw new Error(err?.message || 'Gagal memulai screen capture — butuh HTTPS & izin browser');
    }

    stream = captureStream;
    const vidTrack = stream.getVideoTracks()[0];
    vidTrack?.addEventListener('ended', ()=> { if (isRecording.value) stopRecording(); });

    // Determine recording MIME type:
    let mime = targetMime.value;
    isDirectNativeRecord = isNativeCodecSupported.value;

    if (!isDirectNativeRecord) {
      // Fallback native recording codec
      mime = isMimeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9'
           : isMimeSupported('video/webm') ? 'video/webm'
           : 'video/mp4';
    }

    mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 });
    mediaRecorder.ondataavailable = e=> { if (e.data && e.data.size>0) chunks.push(e.data); };
    
    mediaRecorder.onstop = async ()=> {
      try {
        const rawBlob = new Blob(chunks, { type: mediaRecorder?.mimeType || 'video/webm' });
        const requestedExt = (exportFormat.value === 'mp4' || targetMime.value.includes('mp4')) ? 'mp4' : 'webm';

        if (isDirectNativeRecord) {
          // Native MediaRecorder recording supported directly!
          recBlob.value = rawBlob;
          activeFormatExt.value = requestedExt;
          if (recUrl.value) try{ URL.revokeObjectURL(recUrl.value);}catch{}
          recUrl.value = URL.createObjectURL(rawBlob);
        } else if (requestedExt === 'mp4') {
          // Perform browser-side transcoding (WebM → MP4) via WebCodecs + mp4-muxer
          isTranscoding.value = true;
          transcodeProg.value = { percent: 0, currentFrame: 0, totalFrames: 0 };
          try {
            const mp4Blob = await transcodeWebMToMP4(rawBlob, (p) => {
              transcodeProg.value = p;
            });
            recBlob.value = mp4Blob;
            activeFormatExt.value = 'mp4';
            if (recUrl.value) try{ URL.revokeObjectURL(recUrl.value);}catch{}
            recUrl.value = URL.createObjectURL(mp4Blob);
          } catch (err) {
            console.warn('Transcoding fallback to WebM:', err);
            recBlob.value = rawBlob;
            activeFormatExt.value = 'webm';
            recError.value = `Konversi MP4 gagal (${(err as Error).message}), menyimpan sebagai WebM.`;
            if (recUrl.value) try{ URL.revokeObjectURL(recUrl.value);}catch{}
            recUrl.value = URL.createObjectURL(rawBlob);
          } finally {
            isTranscoding.value = false;
            transcodeProg.value = null;
          }
        } else {
          recBlob.value = rawBlob;
          activeFormatExt.value = 'webm';
          if (recUrl.value) try{ URL.revokeObjectURL(recUrl.value);}catch{}
          recUrl.value = URL.createObjectURL(rawBlob);
        }
      } catch (err) {
        recError.value = (err as Error).message || 'Gagal memproses file rekaman';
      }

      if (stream){
        stream.getTracks().forEach(t=> { try{ t.stop(); } catch{} });
        stream = null;
      }
      mediaRecorder = null;
    };

    mediaRecorder.onerror = (e: unknown)=> { const ev = e as { error?: { message?: string } }; recError.value = ev?.error?.message || 'MediaRecorder error'; };
    mediaRecorder.start(100);
    isRecording.value = true;
    recTime.value = 0;
    if (timer) clearInterval(timer);
    timer = window.setInterval(()=> recTime.value++, 1000) as unknown as number;

    if (!showOverlay.value) enableOverlay();

  } catch(e: unknown){
    recError.value = (e as Error)?.message || String(e);
    cleanupRecorder(true);
  }
}

function stopRecording(){
  if (!mediaRecorder) {
    if (stream){ stream.getTracks().forEach(t=>{ try{t.stop()}catch{} }); stream=null; }
    isRecording.value = false;
    if (timer){ clearInterval(timer); timer=null; }
    return;
  }
  if (mediaRecorder.state === 'inactive'){
    isRecording.value = false;
    return;
  }
  try { mediaRecorder.stop(); } catch(e: unknown){ recError.value = (e as Error)?.message || String(e); }
  isRecording.value = false;
  if (timer) { clearInterval(timer); timer=null; }
}

function cleanupRecorder(stopTracks:boolean){
  if (timer) { clearInterval(timer); timer=null; }
  isRecording.value = false;
  try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch {}
  mediaRecorder = null;
  if (stopTracks && stream){ stream.getTracks().forEach(t=>{ try{t.stop()}catch{} }); stream=null; }
}

function discardRecording(){
  if (recUrl.value) { try{ URL.revokeObjectURL(recUrl.value);}catch{}; recUrl.value=''; }
  recBlob.value=null; chunks=[];
  recError.value='';
  if (stream){ stream.getTracks().forEach(t=>{ try{t.stop()}catch{} }); stream=null; }
  mediaRecorder=null;
  if (timer){ clearInterval(timer); timer=null; }
  isRecording.value=false;
}

function downloadRecording(){
  if (!recUrl.value) return;
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const ext = activeFormatExt.value || 'webm';
  a.href = recUrl.value;
  a.download = `bug-evidence-${props.gameName.replace(/[^a-z0-9._-]+/gi,'_')}-${ts}.${ext}`;
  document.body.appendChild(a); a.click(); a.remove();
}

function fmtTime(s:number){
  const m = Math.floor(s/60).toString().padStart(2,'0');
  const ss = (s%60).toString().padStart(2,'0');
  return `${m}:${ss}`;
}

onBeforeUnmount(()=>{
  window.removeEventListener('resize', resizeCanvas);
  window.removeEventListener('keydown', handleKeydown);
  if (timer) clearInterval(timer);
  if (stream) stream.getTracks().forEach(t=>{ try{t.stop()}catch{} });
  if (recUrl.value) try{ URL.revokeObjectURL(recUrl.value);}catch{}
});
</script>

<template>
  <div class="rec-root">
    <!-- Fullscreen overlay canvas + text boxes — behind toolbar -->
    <div v-if="showOverlay" ref="overlayRef" class="draw-overlay" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
      <canvas ref="canvasRef" class="draw-canvas"></canvas>
      <div v-for="t in texts" :key="t.id" class="tbox" :style="{ left: t.x+'px', top: t.y+'px', borderColor: t.color }" @pointerdown.stop>
        <input v-if="t.editing" :id="'tbox-'+t.id" :value="t.text" @input="updateText(t.id, ($event.target as HTMLInputElement).value)" @blur="t.editing=false" @keydown.enter="t.editing=false" @keydown.escape="t.editing=false" class="tinput" :style="{ color: t.color, borderColor: t.color }" @pointerdown.stop />
        <span v-else @click.stop="t.editing=true" tabindex="0" class="tspan" :style="{ color: t.color }" @pointerdown.stop>{{ t.text }}</span>
        <button class="tclose" @click.stop="deleteText(t.id)" @pointerdown.stop>✕</button>
      </div>
      <div class="overlay-hint">Mode {{ tool }} — gambar di atas konten akan ikut terekam. Klik ✎ atau Ctrl+D untuk hide.</div>
    </div>

    <!-- Toolbar — on top of overlay, always visible -->
    <div class="rec-toolbar">
      <div class="rec-main">
        <button v-if="!isRecording" class="btn-rec" @click="startRecording" :disabled="isTranscoding" title="Mulai rekam layar (akan minta izin browser)">● Rec</button>
        <button v-else class="btn-rec stop" @click="stopRecording" title="Stop rekaman">■ Stop {{ fmtTime(recTime) }}</button>
        <span v-if="isRecording" class="rec-dot" title="Recording"></span>
      </div>

      <!-- Format & Codec Option Selector -->
      <div class="rec-format" v-if="!isRecording && !isTranscoding">
        <select v-model="exportFormat" class="sel-fmt" title="Pilih format ekspor video">
          <option value="webm">WebM</option>
          <option value="mp4">MP4</option>
          <option value="custom">Custom Codec</option>
        </select>
        <input v-if="exportFormat==='custom'" v-model="customMime" placeholder="video/mp4;codecs=avc1" class="inp-custom" title="Masukkan custom MIME string" />
        <span class="fmt-badge" :class="isNativeCodecSupported ? 'native' : 'transcode'" :title="isNativeCodecSupported ? 'Supported natively by MediaRecorder' : 'MediaRecorder not supported natively — will use in-browser transcoding'">
          {{ isNativeCodecSupported ? '✓ Native' : '⚡ Browser Transcode' }}
        </span>
      </div>

      <!-- Transcoding status indicator -->
      <div v-if="isTranscoding" class="transcoding-indicator">
        <span class="spinner-sm"></span>
        <span>Konversi MP4... {{ transcodeProg?.percent || 0 }}%</span>
      </div>

      <div class="rec-tools">
        <button class="btn-tool" :class="{on: showOverlay}" @click="showOverlay?disableOverlay():enableOverlay()" title="Overlay draw (Ctrl+D)">{{ showOverlay?'✎ On':'✎ Draw' }}</button>
        <template v-if="showOverlay">
          <div class="seg">
            <button class="seg-btn" :class="{on: tool==='pen'}" @click="tool='pen'" title="Pen">✒ Pen</button>
            <button class="seg-btn" :class="{on: tool==='rect'}" @click="tool='rect'" title="Rectangle">▭</button>
            <button class="seg-btn" :class="{on: tool==='arrow'}" @click="tool='arrow'" title="Arrow">↗</button>
            <button class="seg-btn" :class="{on: tool==='text'}" @click="tool='text'" title="Text">T</button>
          </div>
          <input type="color" v-model="color" class="color" title="Warna" />
          <select v-model.number="width" class="sel" title="Tebal">
            <option :value="2">2px</option><option :value="3">3px</option><option :value="5">5px</option><option :value="8">8px</option>
          </select>
          <button class="btn-tool" @click="undo" title="Undo">↩</button>
          <button class="btn-tool" @click="clearAll" title="Clear">Clear</button>
        </template>
      </div>

      <div class="rec-dl" v-if="recUrl && !isTranscoding">
        <a class="btn-tool primary" href="#" @click.prevent="downloadRecording">⬇ Download ({{ activeFormatExt.toUpperCase() }})</a>
        <button class="btn-tool" @click="discardRecording" title="Hapus">✕</button>
        <video :src="recUrl" class="preview" controls muted playsinline title="Preview rekaman"></video>
      </div>
    </div>
    <div v-if="recError" class="rec-error">⚠ {{ recError }}</div>
  </div>
</template>

<style scoped>
.rec-root{
  position:absolute; inset:0;
  display:flex; flex-direction:column;
  pointer-events:none; z-index:12;
}
.rec-toolbar{
  pointer-events:auto;
  position:relative; z-index:20;
  display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;
  background:#0f1117; border:1px solid var(--border); border-radius:8px;
  padding:0.4rem 0.6rem; margin:0.5rem;
  box-shadow:0 8px 24px rgba(0,0,0,0.6);
}
.rec-main{ display:flex; align-items:center; gap:0.4rem; }
.btn-rec{ background:#dc2626; color:#fff; border:none; border-radius:999px; padding:0.35rem 0.8rem; font-weight:800; font-size:0.78rem; cursor:pointer; }
.btn-rec:disabled{ opacity:0.5; cursor:not-allowed; }
.btn-rec.stop{ background:#111; color:#dc2626; border:1px solid #dc262644; }
.rec-dot{ width:8px; height:8px; border-radius:50%; background:#dc2626; animation: blink 1s infinite; }
@keyframes blink{ 50%{ opacity:0.2 } }

.rec-format{ display:flex; align-items:center; gap:0.3rem; }
.sel-fmt{ background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:0.2rem 0.4rem; font-size:0.7rem; outline:none; }
.inp-custom{ background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:0.2rem 0.4rem; font-size:0.7rem; width:140px; outline:none; }
.fmt-badge{ font-size:0.65rem; font-weight:700; padding:1px 6px; border-radius:4px; }
.fmt-badge.native{ background:#16a34a22; color:#16a34a; border:1px solid #16a34a44; }
.fmt-badge.transcode{ background:#d9770622; color:#f59e0b; border:1px solid #d9770644; }

.transcoding-indicator{ display:flex; align-items:center; gap:0.4rem; color:#f59e0b; font-size:0.75rem; font-weight:600; }
.spinner-sm{ width:12px; height:12px; border:2px solid #f59e0b; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; }
@keyframes spin{ to{ transform:rotate(360deg) } }

.rec-tools{ display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap; }
.btn-tool{ background:var(--card); border:1px solid var(--border); color:var(--text-muted); border-radius:6px; padding:0.25rem 0.6rem; font-size:0.72rem; cursor:pointer; }
.btn-tool.on{ background:var(--border); color:var(--text); }
.btn-tool.primary{ background:#3b82f6; color:#fff; border-color:#3b82f6; }
.btn-tool:hover{ background:var(--border); color:var(--text); }
.seg{ display:flex; border:1px solid var(--border); border-radius:6px; overflow:hidden; }
.seg-btn{ background:var(--card); border:none; color:var(--text-muted); padding:0.25rem 0.5rem; font-size:0.68rem; cursor:pointer; border-right:1px solid var(--border); }
.seg-btn.on{ background:var(--border); color:var(--text); }
.seg-btn:last-child{ border-right:none; }
.color{ width:28px; height:28px; border:1px solid var(--border); border-radius:6px; padding:0; background:transparent; cursor:pointer; }
.sel{ background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:0.2rem; font-size:0.7rem; }
.rec-dl{ display:flex; gap:0.4rem; align-items:center; }
.preview{ width:140px; height:80px; border:1px solid var(--border); border-radius:6px; background:#000; }
.rec-error{ pointer-events:auto; margin:0 0.5rem; background:#dc262618; color:#dc2626; border:1px solid #dc262644; padding:0.4rem 0.6rem; border-radius:6px; font-size:0.75rem; position:relative; z-index:20; }
.draw-overlay{ position:absolute; inset:0; top:0; left:0; right:0; bottom:0; z-index:11; touch-action:none; cursor:crosshair; pointer-events:auto; }
.draw-canvas{ position:absolute; inset:0; width:100%; height:100%; display:block; }
.tbox{ position:absolute; display:flex; gap:0.25rem; align-items:center; background:rgba(0,0,0,0.78); border:1px solid; border-radius:6px; padding:0.25rem 0.4rem; max-width:280px; z-index:15; }
.tinput{ background:transparent; border:1px dashed; color:inherit; outline:none; font-size:0.78rem; min-width:160px; }
.tspan{ font-size:0.78rem; white-space:pre-wrap; cursor:text; }
.tclose{ background:none; border:none; color:inherit; cursor:pointer; font-size:0.7rem; opacity:0.7; }
.tclose:hover{ opacity:1; }
.overlay-hint{ position:absolute; bottom:0.5rem; left:0.5rem; background:rgba(15,17,23,0.9); color:var(--text-muted); border:1px solid var(--border); border-radius:999px; padding:0.2rem 0.6rem; font-size:0.65rem; }
</style>
