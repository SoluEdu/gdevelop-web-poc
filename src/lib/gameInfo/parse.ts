// Extract GDevelop ProjectData — robust: reads from original ZIP in OPFS uploads/<id>.zip
// so it works even before Extract, plus OPFS direct and SW fetch fallbacks.
export interface GameInfo {
  name: string;
  packageName: string;
  version: string;
  author: string;
  description: string | null;
  windowWidth: number;
  windowHeight: number;
  orientation: string;
  scaleMode: string;
  maxFPS: number;
  minFPS: number;
  firstLayout: string;
  projectUuid: string | null;
  authorIds: string[];
  authorUsernames: string[];
  folderProject: boolean | null;
  projectFile: string | null;
  layoutsCount: number;
  resourcesCount: number;
  extensionProperties: any[];
  raw: any;
}

const cache = new Map<string, GameInfo | null>();

export async function getGameInfo(gameId: string): Promise<GameInfo | null> {
  if (cache.has(gameId)) return cache.get(gameId)!;
  const info = await fetchGameInfo(gameId);
  cache.set(gameId, info);
  return info;
}

export function clearGameInfoCache(gameId?: string) {
  if (gameId) cache.delete(gameId);
  else cache.clear();
}

async function fetchGameInfo(gameId: string): Promise<GameInfo | null> {
  // 1) ZIP direct — most reliable, no Extract needed, no SW needed
  try {
    const fromZip = await readFromZip(gameId);
    if (fromZip) return fromZip;
  } catch {}

  // 2) OPFS direct FS read — extracted games/<id>/data.js (bypass SW)
  try {
    const fromOPFS = await readFromOPFS(gameId);
    if (fromOPFS) return fromOPFS;
  } catch {}

  // 3) SW fetch — last fallback
  const candidates = [
    `/games/${gameId}/data.js`,
    `/games/${gameId}/code0.js`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = extractProjectData(text);
      if (parsed) return normalize(parsed);
    } catch {}
  }
  for (const url of [`/games/${gameId}/game.json`, `/games/${gameId}/manifest.webmanifest`]) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const json = await res.json();
      if (json.properties || json.firstLayout) return normalize(json);
    } catch {}
  }
  return null;
}

import { getFile, getRoot } from '../storage/opfs';
import { extractZip, tryReadAsText } from '../zip/zip';

async function readFromZip(gameId: string): Promise<GameInfo | null> {
  const file = await getFile(gameId);
  const buf = await file.arrayBuffer();
  const entries = extractZip(buf);
  // find data.js / code0.js / game.json anywhere (handle prefixed folder like mygame/data.js)
  const find = (name: string) => entries.find(e => e.name === name || e.name.endsWith('/' + name));
  let entry = find('data.js');
  if (entry) {
    const text = tryReadAsText(entry);
    if (text) {
      const parsed = extractProjectData(text);
      if (parsed) return normalize(parsed);
    }
  }
  entry = find('code0.js');
  if (entry) {
    const text = tryReadAsText(entry);
    if (text) {
      const parsed = extractProjectData(text);
      if (parsed) return normalize(parsed);
    }
  }
  entry = find('game.json');
  if (entry) {
    const text = tryReadAsText(entry);
    if (text) try { const j = JSON.parse(text); if (j.properties || j.firstLayout) return normalize(j); } catch {}
  }
  return null;
}

async function readFromOPFS(gameId: string): Promise<GameInfo | null> {
  const root: FileSystemDirectoryHandle = await getRoot();
  const gamesDir = await root.getDirectoryHandle('games');
  const gameDir = await gamesDir.getDirectoryHandle(gameId);
  for (const name of ['data.js', 'code0.js', 'game.json']) {
    try {
      const fh = await gameDir.getFileHandle(name);
      const file = await fh.getFile();
      const text = await file.text();
      if (name.endsWith('.js')) {
        const parsed = extractProjectData(text);
        if (parsed) return normalize(parsed);
      } else {
        const j = JSON.parse(text);
        if (j.properties || j.firstLayout) return normalize(j);
      }
    } catch {}
  }
  return null;
}

function extractProjectData(text: string): any | null {
  // data.js: gdjs.projectData = {...};\ngdjs.runtimeGameOptions = {...};
  // Use delimiter split — avoids lazy regex that truncates nested JSON
  const marker = 'gdjs.projectData';
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const braceStart = text.indexOf('{', idx);
  if (braceStart === -1) return null;
  // delimiter is ; before runtimeGameOptions, or just next ;
  const delim = ';\ngdjs.runtimeGameOptions';
  let braceEnd = text.indexOf(delim, braceStart);
  let jsonStr: string;
  if (braceEnd !== -1) {
    jsonStr = text.slice(braceStart, braceEnd).trim();
    // remove trailing ; if any
    if (jsonStr.endsWith(';')) jsonStr = jsonStr.slice(0, -1);
  } else {
    // fallback: find matching closing brace by counting (handles strings naively)
    // find the }; that ends projectData — scan from braceStart
    braceEnd = text.indexOf('};', braceStart);
    if (braceEnd === -1) return null;
    jsonStr = text.slice(braceStart, braceEnd + 1);
  }
  try {
    return JSON.parse(jsonStr);
  } catch {
    try {
      // eslint-disable-next-line no-new-func
      return Function(`"use strict"; return (${jsonStr});`)();
    } catch {
      return null;
    }
  }
}

function normalize(data: any): GameInfo {
  const p = data.properties || {};
  return {
    name: p.name || data.name || '',
    packageName: p.packageName || '',
    version: p.version || '',
    author: p.author || '',
    description: p.description ?? data.description ?? null,
    windowWidth: p.windowWidth ?? 0,
    windowHeight: p.windowHeight ?? 0,
    orientation: p.orientation || 'default',
    scaleMode: p.scaleMode || '',
    maxFPS: p.maxFPS ?? 60,
    minFPS: p.minFPS ?? 20,
    firstLayout: data.firstLayout || '',
    projectUuid: p.projectUuid || null,
    authorIds: p.authorIds || [],
    authorUsernames: p.authorUsernames || [],
    folderProject: p.folderProject ?? null,
    projectFile: p.projectFile || null,
    layoutsCount: Array.isArray(data.layouts) ? data.layouts.length : 0,
    resourcesCount: data.resources?.resources ? data.resources.resources.length : 0,
    extensionProperties: p.extensionProperties || [],
    raw: data,
  };
}

// Validation helpers for Info modal badges
export function isValidPackageName(pkg: string): boolean {
  // co.id.solu.{subject}_k{n}b{n}  — allow lowercase, digits, dots, underscore; must contain _k and b
  if (!pkg) return false;
  if (!pkg.startsWith('co.id.solu.')) return false;
  // basic: co.id.solu.xxx  and contains _k and b
  return /_k\d+b\d+/i.test(pkg) && /^[a-z0-9._]+$/i.test(pkg);
}
export function isProjectTypeMultipleFiles(info: GameInfo | null): boolean {
  if (!info) return false;
  return info.folderProject === true;
}
