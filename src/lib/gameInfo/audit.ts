export interface AssetAuditItem {
  name: string;
  kind: string;
  file: string;
  zipSize: number | null;
}

export interface AssetAudit {
  total: number;
  used: number;
  unused: AssetAuditItem[];
  missing: AssetAuditItem[];
}

interface EntryLike {
  name: string;
  size: number;
}

interface ResourceRef {
  name: string;
  kind: string;
  file: string;
}

export function auditAssets(project: unknown, entries: EntryLike[]): AssetAudit | null {
  const resources = (project as { resources?: { resources?: unknown } } | null)?.resources?.resources;
  if (!Array.isArray(resources) || resources.length === 0) return null;

  const refs: ResourceRef[] = resources
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { name: String(o.name ?? ''), kind: String(o.kind ?? ''), file: String(o.file ?? '') };
    })
    .filter((r) => r.name);

  const names = new Set(refs.map((r) => r.name));
  const used = new Set<string>();
  const root = (project ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(root)) {
    if (key === 'resources') continue;
    collectUsed(value, names, used);
  }

  const sizeOf = (file: string) => {
    const key = file.toLowerCase();
    for (const e of entries) {
      if (e.name.endsWith('/')) continue;
      const n = e.name.toLowerCase();
      if (n === key || n.endsWith('/' + key)) return e.size;
    }
    return null;
  };

  const items: AssetAuditItem[] = refs.map((r) => ({ ...r, zipSize: sizeOf(r.file) }));
  const unused = items
    .filter((i) => !used.has(i.name))
    .sort((a, b) => (b.zipSize ?? -1) - (a.zipSize ?? -1) || a.name.localeCompare(b.name));
  const missing = items.filter((i) => used.has(i.name) && i.zipSize === null);

  return { total: refs.length, used: refs.length - unused.length, unused, missing };
}

function collectUsed(value: unknown, names: Set<string>, out: Set<string>): void {
  if (typeof value === 'string') {
    if (names.has(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUsed(v, names, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectUsed(v, names, out);
  }
}
