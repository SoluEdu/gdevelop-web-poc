<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { openDatabase, addFile, getFile, deleteFile, clearFiles } from '../lib/db/indexeddb';
  import {
    isOPFSAvailable,
    createUploadDirectory,
    saveFile,
    getFile as opfsGetFile,
    deleteFile as opfsDeleteFile,
  } from '../lib/storage/opfs';

  const dispatch = createEventDispatcher<{ refreshAll: void }>();

  interface TestResult {
    label: string;
    status: 'pass' | 'fail' | 'running' | 'idle';
    detail: string;
  }

  let opfsResults: TestResult[] = [];
  let idbResults: TestResult[] = [];
  let clearMsg = '';
  let clearError = '';
  let clearing = false;

  // ── OPFS test ─────────────────────────────────────────────────────────────

  async function testOPFS() {
    opfsResults = [];
    const push = (label: string, status: TestResult['status'], detail = '') => {
      opfsResults = [...opfsResults, { label, status, detail }];
    };

    // 1 availability
    if (!isOPFSAvailable()) {
      push('Availability', 'fail', 'navigator.storage.getDirectory not found');
      return;
    }
    push('Availability', 'pass', 'navigator.storage.getDirectory exists');

    // 2 get root
    try {
      await navigator.storage.getDirectory();
      push('Get Root', 'pass', 'Root FileSystemDirectoryHandle obtained');
    } catch (e) {
      push('Get Root', 'fail', String(e));
      return;
    }

    // 3 create uploads dir
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await createUploadDirectory();
      push('Create uploads/ dir', 'pass', 'uploads/ handle obtained');
    } catch (e) {
      push('Create uploads/ dir', 'fail', String(e));
      return;
    }

    // 4 write test file
    const testId = '__opfs_test__';
    const testData = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]); // minimal ZIP
    const testFile = new File([testData], 'test.zip', { type: 'application/zip' });
    try {
      await saveFile(testId, testFile);
      push('Write file', 'pass', 'Wrote test bytes to uploads/__opfs_test__.zip');
    } catch (e) {
      push('Write file', 'fail', String(e));
      return;
    }

    // 5 read file back
    try {
      const f = await opfsGetFile(testId);
      const buf = await f.arrayBuffer();
      push('Read file', 'pass', `Read ${buf.byteLength} bytes back`);
    } catch (e) {
      push('Read file', 'fail', String(e));
    }

    // 6 delete test file
    try {
      await opfsDeleteFile(testId);
      push('Delete file', 'pass', 'Test file removed');
    } catch (e) {
      push('Delete file', 'fail', String(e));
    }
  }

  // ── IndexedDB test ────────────────────────────────────────────────────────

  async function testIDB() {
    idbResults = [];
    const push = (label: string, status: TestResult['status'], detail = '') => {
      idbResults = [...idbResults, { label, status, detail }];
    };

    // 1 open
    let db: IDBDatabase;
    try {
      db = await openDatabase();
      push('Open Database', 'pass', 'file-storage-poc opened');
    } catch (e) {
      push('Open Database', 'fail', String(e));
      return;
    }

    // 2 add
    const testMeta = {
      id: '__idb_test__',
      name: '__test__.zip',
      size: 1234,
      type: 'application/zip',
      createdAt: Date.now(),
      opfsPath: 'uploads/__idb_test__.zip',
    };
    try {
      await addFile(testMeta);
      push('Add record', 'pass', `Inserted id=${testMeta.id}`);
    } catch (e) {
      push('Add record', 'fail', String(e));
      return;
    }

    // 3 get
    try {
      const record = await getFile(testMeta.id);
      if (record?.name === testMeta.name) {
        push('Get record', 'pass', `name="${record.name}" matches`);
      } else {
        push('Get record', 'fail', `Got ${JSON.stringify(record)}`);
      }
    } catch (e) {
      push('Get record', 'fail', String(e));
    }

    // 4 delete
    try {
      await deleteFile(testMeta.id);
      const gone = await getFile(testMeta.id);
      if (!gone) {
        push('Delete record', 'pass', 'Record no longer found after delete');
      } else {
        push('Delete record', 'fail', 'Record still exists after delete');
      }
    } catch (e) {
      push('Delete record', 'fail', String(e));
    }
  }

  // ── clear all ─────────────────────────────────────────────────────────────

  async function handleClearAll() {
    if (!confirm('Clear ALL stored files?\n\nThis will delete every OPFS file and all IndexedDB records.')) return;

    clearing = true;
    clearMsg = '';
    clearError = '';

    try {
      // Clear OPFS uploads/
      if (isOPFSAvailable()) {
        const root = await navigator.storage.getDirectory();
        try {
          await root.removeEntry('uploads', { recursive: true });
        } catch {
          // uploads/ may not exist yet
        }
      }

      // Clear IndexedDB
      await clearFiles();

      clearMsg = 'All files cleared.';
      dispatch('refreshAll');
    } catch (e) {
      clearError = `Clear failed: ${(e as Error).message}`;
    } finally {
      clearing = false;
    }
  }
</script>

<section class="card">
  <h2>Storage Tests</h2>

  <div class="btn-row">
    <button class="btn-outline" on:click={testOPFS}>🗂 Test OPFS</button>
    <button class="btn-outline" on:click={testIDB}>🗃 Test IndexedDB</button>
    <button class="btn-danger" on:click={handleClearAll} disabled={clearing}>
      {clearing ? 'Clearing…' : '🗑 Clear All'}
    </button>
  </div>

  {#if clearMsg}
    <div class="alert success">{clearMsg}</div>
  {/if}

  {#if clearError}
    <div class="alert error">{clearError}</div>
  {/if}

  {#if opfsResults.length > 0}
    <div class="results">
      <p class="results-title">OPFS Test</p>
      {#each opfsResults as r}
        <div class="result-row" class:pass={r.status === 'pass'} class:fail={r.status === 'fail'}>
          <span class="status-icon">{r.status === 'pass' ? '✓' : '✗'}</span>
          <span class="result-label">{r.label}</span>
          <span class="result-detail">{r.detail}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if idbResults.length > 0}
    <div class="results">
      <p class="results-title">IndexedDB Test</p>
      {#each idbResults as r}
        <div class="result-row" class:pass={r.status === 'pass'} class:fail={r.status === 'fail'}>
          <span class="status-icon">{r.status === 'pass' ? '✓' : '✗'}</span>
          <span class="result-label">{r.label}</span>
          <span class="result-detail">{r.detail}</span>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .btn-outline,
  .btn-danger {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }

  .btn-outline {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
  }

  .btn-outline:hover {
    background: var(--border);
  }

  .btn-danger {
    background: #dc262618;
    color: #dc2626;
    border: 1px solid #dc262644;
  }

  .btn-danger:hover:not(:disabled) {
    background: #dc262630;
  }

  .btn-danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .alert {
    padding: 0.625rem 0.875rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .alert.success {
    background: #16a34a18;
    color: #16a34a;
    border: 1px solid #16a34a44;
  }

  .alert.error {
    background: #dc262618;
    color: #dc2626;
    border: 1px solid #dc262644;
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: var(--bg);
    border-radius: 6px;
    padding: 0.75rem;
  }

  .results-title {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .result-row {
    display: grid;
    grid-template-columns: 1.25rem 10rem 1fr;
    align-items: start;
    gap: 0.5rem;
    font-size: 0.8rem;
    padding: 3px 0;
    border-bottom: 1px solid var(--border);
  }

  .result-row:last-child {
    border-bottom: none;
  }

  .status-icon {
    font-size: 0.85rem;
    font-weight: 700;
  }

  .result-row.pass .status-icon {
    color: #16a34a;
  }

  .result-row.fail .status-icon {
    color: #dc2626;
  }

  .result-label {
    font-weight: 600;
  }

  .result-row.pass .result-label {
    color: #16a34a;
  }

  .result-row.fail .result-label {
    color: #dc2626;
  }

  .result-detail {
    color: var(--text-muted);
    font-family: monospace;
    font-size: 0.75rem;
    word-break: break-all;
  }
</style>
