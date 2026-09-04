// QA Todo store — per gameId, localStorage backed. Markdown export matches user format.

export interface QaCheckItem {
  id: string;
  label: string;
  done: boolean;
  // optional sub-items for package name K/B
  children?: { id: string; label: string; done: boolean }[];
}

export interface QaSection {
  key: string;
  title: string;
  items: QaCheckItem[];
}

export interface QaMeta {
  tester: string;
  date: string; // YYYY-MM-DD
  env: string; // PC Chrome / Mobile Safari / ...
}

export interface QaState {
  meta: QaMeta;
  sections: QaSection[];
  updatedAt: number;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function detectEnv(): string {
  try {
    const ua = navigator.userAgent || '';
    let browser = 'Unknown';
    if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Chrome/') && !ua.includes('Chromium')) browser = 'Chrome';
    else if (ua.includes('Firefox/')) browser = 'Firefox';
    else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';
    const m = ua.match(/(Chrome|Firefox|Safari|Edg)\/([\d.]+)/);
    const ver = m ? ` ${m[2].split('.')[0]}` : '';
    let platform = 'PC';
    if (/Android/i.test(ua)) platform = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) platform = /iPad/i.test(ua) ? 'iPad' : 'iPhone';
    else if (/Mobile/i.test(ua)) platform = 'Mobile';
    // desktop OS hint
    let os = '';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac OS')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    const platformPart = platform === 'PC' && os ? `PC ${os}` : platform + (os && platform==='PC' ? '' : '');
    // final: "PC Windows Chrome 124", "Android Chrome", "iPhone Safari"
    const env = `${platformPart} ${browser}${ver}`.replace(/\s+/g,' ').trim();
    // add viewport
    const vw = typeof window !== 'undefined' ? ` ${window.innerWidth}×${window.innerHeight}` : '';
    return env + vw;
  } catch { return ''; }
}

export function defaultQaState(): QaState {
  return {
    meta: { tester: '', date: todayISO(), env: detectEnv() },
    sections: [
      {
        key: 'info',
        title: '1. Info Proyek',
        items: [
          { id: 'pkg', label: 'Package Name: `co.id.solu.{subject_k{n}b{n}}`', done: false, children: [
            { id: 'pkg-k', label: 'K untuk kelas', done: false },
            { id: 'pkg-b', label: 'B untuk bab / Sub-bab', done: false },
          ]},
          { id: 'file', label: 'Nama File Proyek: `game.json`', done: false },
          { id: 'type', label: 'Project Type bertipe `Multiple Files`', done: false },
        ],
      },
      {
        key: 'tampilan',
        title: '2. Ceklis Pengujian — A. Tampilan & Setup',
        items: [
          { id: 'splash', label: 'Loading & splash tanpa error', done: false },
          { id: 'size', label: 'Ukuran Layar: `No change to the game size` — tidak terpotong', done: false },
          { id: 'icon', label: 'Icon Game: muncul di tab browser / window', done: false },
          { id: 'resize', label: 'Uji Ubah Ukuran: tarik window, proporsional, visual tidak pecah', done: false },
        ],
      },
      {
        key: 'audio',
        title: 'B. Audio',
        items: [
          { id: 'bgm-vol', label: 'Volume BGM: pelan ~50% dari VO', done: false },
          { id: 'bgm-loop', label: 'BGM Loop: mengulang tanpa henti tiap scene', done: false },
          { id: 'vo-cut', label: 'VO Tabrakan: VO baru kill VO lama', done: false },
          { id: 'mute', label: 'Mekanisme Mute: 0 tapi audio tetap jalan background', done: false },
        ],
      },
      {
        key: 'konten',
        title: 'C. Konten & Alur',
        items: [
          { id: 'menu', label: 'Navigasi Main Menu → Play / Settings', done: false },
          { id: 'happy', label: 'Happy Path: awal → selesai tidak freeze', done: false },
          { id: 'typo', label: 'Cek Teks: typo, muat di kotak', done: false },
          { id: 'asset', label: 'Kesesuaian Konten: aset sesuai materi', done: false },
          { id: 'back', label: 'Tombol Back: ke scene sebelumnya', done: false },
        ],
      },
      {
        key: 'tahan',
        title: 'D. Uji Ketahanan',
        items: [
          { id: 'multiclick', label: 'Multi-click: klik cepat tidak crash', done: false },
          { id: 'doubleclick', label: 'Double-click: hanya 1 aksi', done: false },
          { id: 'perf', label: 'Performance: FPS stabil, console tanpa error', done: false },
        ],
      },
    ],
    updatedAt: Date.now(),
  };
}

const LS_PREFIX = 'qa:';

function lsKey(gameId: string) { return LS_PREFIX + gameId; }

export function loadQa(gameId: string): QaState {
  try {
    const raw = localStorage.getItem(lsKey(gameId));
    if (raw) {
      const parsed = JSON.parse(raw) as QaState;
      // merge with defaults to add new items after updates
      return mergeWithDefaults(parsed);
    }
  } catch {}
  return defaultQaState();
}

function mergeWithDefaults(saved: QaState): QaState {
  const def = defaultQaState();
  // keep meta — auto-fill empty env with detected
  const meta = { ...def.meta, ...saved.meta };
  if (!meta.env) meta.env = detectEnv();
  if (!meta.date) meta.date = def.meta.date;
  // merge sections by key
  const sectionMap = new Map(saved.sections.map(s => [s.key, s]));
  const sections: QaSection[] = def.sections.map(defSec => {
    const savedSec = sectionMap.get(defSec.key);
    if (!savedSec) return defSec;
    const itemMap = new Map(savedSec.items.map(i => [i.id, i]));
    const items: QaCheckItem[] = defSec.items.map(defItem => {
      const s = itemMap.get(defItem.id);
      if (!s) return defItem;
      // merge children
      let children = defItem.children;
      if (defItem.children && s.children) {
        const cMap = new Map(s.children.map(c => [c.id, c]));
        children = defItem.children.map(dc => cMap.get(dc.id) || dc);
        // keep extra children
        for (const sc of s.children) if (!children.find(c=>c.id===sc.id)) children.push(sc);
      } else if (s.children) children = s.children;
      return { ...defItem, done: s.done, children };
    });
    // keep extra items
    for (const si of savedSec.items) if (!items.find(i=>i.id===si.id)) items.push(si);
    return { ...defSec, title: savedSec.title || defSec.title, items };
  });
  // keep extra sections
  for (const ss of saved.sections) if (!sections.find(s=>s.key===ss.key)) sections.push(ss);
  return { meta, sections, updatedAt: saved.updatedAt || Date.now() };
}

export function saveQa(gameId: string, state: QaState) {
  state.updatedAt = Date.now();
  try { localStorage.setItem(lsKey(gameId), JSON.stringify(state)); } catch {}
}

export function resetQa(gameId: string): QaState {
  const def = defaultQaState();
  saveQa(gameId, def);
  return def;
}

// Markdown export — exact format user gave, with checkboxes
export function toMarkdown(state: QaState, gameName?: string, gameInfo?: { packageName?: string; name?: string } | null): string {
  const lines: string[] = [];
  if (gameName) lines.push(`# QA — ${gameName}`, '');
  lines.push('## 1. Info Proyek', '');
  lines.push(`* **Nama Tester:** ${state.meta.tester || '-'}`);
  lines.push(`* **Tanggal:** ${state.meta.date || '-'}`);
  lines.push(`* **Lingkungan / Browser:** ${state.meta.env || '-'}`, '');

  for (const sec of state.sections) {
    lines.push(`## ${sec.title}`, '');
    for (const it of sec.items) {
      // special handling for package name to show value if available
      let label = it.label;
      if (it.id === 'pkg' && gameInfo?.packageName) {
        label = `Package Name: \`${gameInfo.packageName}\``;
      }
      const box = it.done ? '[x]' : '[ ]';
      lines.push(`- ${box} ${label}`);
      if (it.children) {
        for (const c of it.children) {
          const cb = c.done ? '[x]' : '[ ]';
          lines.push(`  * ${cb} ${c.label}`);
        }
      }
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function progress(state: QaState): { done: number; total: number } {
  let done = 0, total = 0;
  for (const s of state.sections) for (const it of s.items) {
    total++; if (it.done) done++;
    if (it.children) for (const c of it.children) { total++; if (c.done) done++; }
  }
  return { done, total };
}
