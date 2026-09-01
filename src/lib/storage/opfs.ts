// ── OPFS helpers ──────────────────────────────────────────────────────────────
// All binary data is stored here; IndexedDB only keeps metadata.

import type { ZipEntry } from '../zip/zip';

const UPLOAD_DIR = 'uploads';
const GAMES_DIR = 'games';


export interface StorageEstimate {
  usage: number;
  quota: number;
  usedPercent: number;
}

// ── availability ──────────────────────────────────────────────────────────────

export function isOPFSAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

// ── root / directory ──────────────────────────────────────────────────────────

export async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (!isOPFSAvailable()) throw new Error('OPFS is not supported in this browser');
  return navigator.storage.getDirectory();
}

export async function createUploadDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot();
  return root.getDirectoryHandle(UPLOAD_DIR, { create: true });
}

// ── file operations ───────────────────────────────────────────────────────────

/**
 * Save a File into OPFS at uploads/<id>.zip
 */
export async function saveFile(id: string, file: File): Promise<void> {
  const dir = await createUploadDirectory();
  const filename = `${id}.zip`;
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(await file.arrayBuffer());
  await writable.close();
}

/**
 * Read a File object from OPFS for the given id.
 */
export async function getFile(id: string): Promise<File> {
  const dir = await createUploadDirectory();
  const filename = `${id}.zip`;
  const fileHandle = await dir.getFileHandle(filename);
  return fileHandle.getFile();
}

/**
 * Delete the OPFS file for the given id.
 * Throws if the file does not exist.
 */
export async function deleteFile(id: string): Promise<void> {
  const dir = await createUploadDirectory();
  const filename = `${id}.zip`;
  await dir.removeEntry(filename);
}

/**
 * Returns true if the OPFS file for the given id exists.
 */
export async function fileExists(id: string): Promise<boolean> {
  try {
    const dir = await createUploadDirectory();
    await dir.getFileHandle(`${id}.zip`);
    return true;
  } catch {
    return false;
  }
}

// ── storage estimate ──────────────────────────────────────────────────────────

export async function getStorageEstimate(): Promise<StorageEstimate> {
  const est = await navigator.storage.estimate();
  const usage = est.usage ?? 0;
  const quota = est.quota ?? 0;
  const usedPercent = quota > 0 ? (usage / quota) * 100 : 0;
  return { usage, quota, usedPercent };
}

// ── game extraction ────────────────────────────────────────────────────────────

/**
 * Strip a common root folder prefix if all entries share one.
 * GDevelop may export as: mygame/index.html, mygame/game.js …
 * We want to extract as:        index.html,        game.js …
 */
function stripCommonPrefix(entries: ZipEntry[]): ZipEntry[] {
  const fileEntries = entries.filter((e) => !e.isDirectory);
  if (fileEntries.length === 0) return entries;

  const firstParts = fileEntries[0].name.split('/');
  if (firstParts.length < 2) return entries; // no prefix

  const commonRoot = firstParts[0] + '/';
  const allShareRoot = fileEntries.every((e) => e.name.startsWith(commonRoot));

  if (!allShareRoot) return entries;

  return entries.map((e) => ({
    ...e,
    name: e.name.startsWith(commonRoot) ? e.name.slice(commonRoot.length) : e.name,
  }));
}

/**
 * Write all ZIP entries into OPFS at games/<gameId>/<path>.
 * Skips directory entries (directories are created implicitly).
 * Returns the number of files written.
 */
export async function extractGameToOPFS(
  gameId: string,
  entries: ZipEntry[],
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const root = await getRoot();
  const gamesDir = await root.getDirectoryHandle(GAMES_DIR, { create: true });
  const gameDir = await gamesDir.getDirectoryHandle(gameId, { create: true });

  const normalized = stripCommonPrefix(entries);
  const fileEntries = normalized.filter((e) => !e.isDirectory && e.name.length > 0);
  let written = 0;

  for (const entry of fileEntries) {
    const pathParts = entry.name.split('/').filter(Boolean);
    if (pathParts.length === 0) continue;

    // Create parent directories as needed
    let currentDir = gameDir;
    for (let i = 0; i < pathParts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(pathParts[i], { create: true });
    }

    // Write file
    const filename = pathParts[pathParts.length - 1];
    const fileHandle = await currentDir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(entry.data);
    await writable.close();

    written++;
    onProgress?.(written, fileEntries.length);
  }

  return written;
}

/**
 * Delete the entire games/<gameId>/ directory tree from OPFS.
 */
export async function deleteGame(gameId: string): Promise<void> {
  const root = await getRoot();
  try {
    const gamesDir = await root.getDirectoryHandle(GAMES_DIR);
    await gamesDir.removeEntry(gameId, { recursive: true });
  } catch {
    // games/<gameId>/ may not exist if extraction was never done — that's fine
  }
}
