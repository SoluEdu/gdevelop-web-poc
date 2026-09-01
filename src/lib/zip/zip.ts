// ── ZIP helpers ───────────────────────────────────────────────────────────────
// Thin wrapper around fflate.  Extraction only; no packing needed for POC.

import { unzipSync, strFromU8 } from 'fflate';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  isDirectory: boolean;
  size: number;
}

// ── validation ────────────────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

export function validateZip(file: File): void {
  // Extension is primary (MIME can be inconsistent)
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext !== 'zip') {
    throw new Error(`Invalid file type. Expected .zip, got .${ext ?? 'unknown'}`);
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(
      `File too large. Maximum is 500 MB, but file is ${formatBytes(file.size)}.`
    );
  }
}

// ── extraction ────────────────────────────────────────────────────────────────

/**
 * Extract a ZIP from an ArrayBuffer.
 * Returns a flat list of entries (files + directories).
 */
export function extractZip(buffer: ArrayBuffer): ZipEntry[] {
  const uint8 = new Uint8Array(buffer);
  const unzipped = unzipSync(uint8);

  return Object.entries(unzipped).map(([name, data]) => ({
    name,
    data,
    isDirectory: name.endsWith('/'),
    size: data.byteLength,
  }));
}

/**
 * Peek at ZIP contents without fully extracting data.
 * Returns entry names only (fast).
 */
export function listZipEntries(entries: ZipEntry[]): string[] {
  return entries.map((e) => e.name);
}

// ── utilities ─────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function tryReadAsText(entry: ZipEntry): string | null {
  try {
    return strFromU8(entry.data);
  } catch {
    return null;
  }
}
