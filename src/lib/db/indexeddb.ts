// ── IndexedDB wrapper ─────────────────────────────────────────────────────────
// Native IDB, no 3rd-party lib.  Stores only metadata; binary lives in OPFS.

const DB_NAME = 'file-storage-poc';
const DB_VERSION = 2;
const STORE_NAME = 'files';

export interface StoredFile {
  id: string;
  name: string;
  size: number;
  type: string;
  createdAt: number;
  opfsPath: string;
  extracted?: boolean;     // true once games/<id>/ exists in OPFS
  entryCount?: number;     // number of files extracted from the ZIP
}

// ── open ──────────────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;
      resolve(_db);
    };

    req.onerror = () => reject(new Error(`Failed to open IndexedDB: ${req.error?.message}`));
  });
}

// ── helpers ───────────────────────────────────────────────────────────────────

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(req.error?.message ?? 'IDBRequest failed'));
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function addFile(meta: StoredFile): Promise<void> {
  const db = await openDatabase();
  await wrap(tx(db, 'readwrite').put(meta));
}

export async function getFile(id: string): Promise<StoredFile | undefined> {
  const db = await openDatabase();
  return wrap<StoredFile | undefined>(tx(db, 'readonly').get(id));
}

export async function getAllFiles(): Promise<StoredFile[]> {
  const db = await openDatabase();
  return wrap<StoredFile[]>(tx(db, 'readonly').getAll());
}

export async function deleteFile(id: string): Promise<void> {
  const db = await openDatabase();
  await wrap(tx(db, 'readwrite').delete(id));
}

export async function clearFiles(): Promise<void> {
  const db = await openDatabase();
  await wrap(tx(db, 'readwrite').clear());
}
