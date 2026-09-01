<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { getAllFiles, deleteFile as dbDelete, addFile } from '../lib/db/indexeddb';
  import {
    getFile as opfsGet,
    deleteFile as opfsDelete,
    fileExists,
    extractGameToOPFS,
    deleteGame,
  } from '../lib/storage/opfs';
  import { extractZip, formatBytes } from '../lib/zip/zip';
  import GameRunner from './GameRunner.svelte';
  import type { StoredFile } from '../lib/db/indexeddb';

  const dispatch = createEventDispatcher<{ deleted: string; refreshStorage: void }>();

  let files: StoredFile[] = [];
  let loading = true;

  // ── read modal state ────────────────────────────────────────────────────────
  let readTarget: StoredFile | null = null;
  let readFile: File | null = null;
  let readInOPFS = false;
  let readReadable = false;
  let readEntries: { name: string; size: number; isDir: boolean }[] = [];
  let readLoading = false;
  let readError = '';
  let downloadUrl = '';

  // ── extract state ───────────────────────────────────────────────────────────
  let extractingId = '';
  let extractProgress = 0;
  let extractTotal = 0;

  // ── game runner ─────────────────────────────────────────────────────────────
  let runningGame: StoredFile | null = null;

  // ── delete state ────────────────────────────────────────────────────────────
  let deletingId = '';

  // ── toast ───────────────────────────────────────────────────────────────────
  let toast = '';
  let toastType: 'ok' | 'err' = 'ok';

  function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
    toast = msg;
    toastType = type;
    setTimeout(() => (toast = ''), 3500);
  }

  // ── load ──────────────────────────────────────────────────────────────────

  export async function reload() {
    loading = true;
    try {
      files = await getAllFiles();
      files.sort((a, b) => b.createdAt - a.createdAt);
    } finally {
      loading = false;
    }
  }

  onMount(reload);

  // ── read ──────────────────────────────────────────────────────────────────

  async function handleRead(meta: StoredFile) {
    readTarget = meta;
    readFile = null;
    readInOPFS = false;
    readReadable = false;
    readEntries = [];
    readError = '';
    readLoading = true;

    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      downloadUrl = '';
    }

    try {
      readInOPFS = await fileExists(meta.id);
      if (!readInOPFS) {
        readError = 'File not found in OPFS. It may have been removed externally.';
        return;
      }

      readFile = await opfsGet(meta.id);
      readReadable = true;

      const buffer = await readFile.arrayBuffer();
      const entries = extractZip(buffer);
      readEntries = entries.map((e) => ({
        name: e.name,
        size: e.size,
        isDir: e.isDirectory,
      }));

      const blob = new Blob([buffer], { type: 'application/zip' });
      downloadUrl = URL.createObjectURL(blob);
    } catch (err) {
      readError = `Read failed: ${(err as Error).message}`;
    } finally {
      readLoading = false;
    }
  }

  function closeRead() {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      downloadUrl = '';
    }
    readTarget = null;
  }

  // ── extract ───────────────────────────────────────────────────────────────

  async function handleExtract(meta: StoredFile) {
    extractingId = meta.id;
    extractProgress = 0;
    extractTotal = 0;

    try {
      // Read ZIP from OPFS
      const zipFile = await opfsGet(meta.id);
      const buffer = await zipFile.arrayBuffer();

      // Decompress
      const entries = extractZip(buffer);

      // Write to OPFS games/<id>/
      const count = await extractGameToOPFS(meta.id, entries, (done, total) => {
        extractProgress = done;
        extractTotal = total;
      });

      // Update IndexedDB metadata
      const updated: StoredFile = { ...meta, extracted: true, entryCount: count };
      await addFile(updated);

      // Update local list
      files = files.map((f) => (f.id === meta.id ? updated : f));

      showToast(`Extracted ${count} files — ready to play!`);
      dispatch('refreshStorage');
    } catch (err) {
      showToast(`Extract failed: ${(err as Error).message}`, 'err');
    } finally {
      extractingId = '';
    }
  }

  // ── play ──────────────────────────────────────────────────────────────────

  function handlePlay(meta: StoredFile) {
    runningGame = meta;
  }

  // ── delete ────────────────────────────────────────────────────────────────

  async function handleDelete(meta: StoredFile) {
    const hasGame = meta.extracted;
    const msg = hasGame
      ? `Delete "${meta.name}"?\n\nThis will remove:\n• OPFS uploads/<id>.zip\n• OPFS games/<id>/ (extracted files)\n• IndexedDB record`
      : `Delete "${meta.name}"?\n\nThis will remove the OPFS file and IndexedDB record.`;

    if (!confirm(msg)) return;

    deletingId = meta.id;
    try {
      // Delete ZIP from OPFS
      await opfsDelete(meta.id);

      // Delete extracted game dir if it exists
      if (hasGame) await deleteGame(meta.id);

      // Delete IDB record
      await dbDelete(meta.id);

      files = files.filter((f) => f.id !== meta.id);
      dispatch('deleted', meta.id);
      dispatch('refreshStorage');
      showToast(`"${meta.name}" deleted.`);
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`, 'err');
    } finally {
      deletingId = '';
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
  }

  $: extractPercent =
    extractTotal > 0 ? Math.round((extractProgress / extractTotal) * 100) : 0;
</script>

<!-- ── Game Runner ─────────────────────────────────────────────────────────── -->
{#if runningGame}
  <GameRunner game={runningGame} on:close={() => (runningGame = null)} />
{/if}

<section class="card">
  <h2>Stored Files</h2>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if files.length === 0}
    <p class="muted">No files stored yet. Upload a ZIP above.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Date</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each files as file (file.id)}
            <tr>
              <td class="name" title={file.name}>{file.name}</td>
              <td class="mono">{formatBytes(file.size)}</td>
              <td class="mono">{formatDate(file.createdAt)}</td>
              <td>
                {#if file.extracted}
                  <span class="badge ok">✓ Extracted</span>
                {:else}
                  <span class="badge idle">ZIP only</span>
                {/if}
              </td>
              <td class="actions">
                <!-- Read -->
                <button class="btn-sm read" on:click={() => handleRead(file)}>
                  Read
                </button>

                <!-- Extract or Play -->
                {#if file.extracted}
                  <button class="btn-sm play" on:click={() => handlePlay(file)}>
                    ▶ Play
                  </button>
                {:else}
                  <button
                    class="btn-sm extract"
                    on:click={() => handleExtract(file)}
                    disabled={extractingId === file.id}
                  >
                    {extractingId === file.id
                      ? `${extractPercent}%`
                      : 'Extract'}
                  </button>
                {/if}

                <!-- Delete -->
                <button
                  class="btn-sm del"
                  on:click={() => handleDelete(file)}
                  disabled={deletingId === file.id}
                >
                  {deletingId === file.id ? '…' : 'Delete'}
                </button>
              </td>
            </tr>

            <!-- Extraction progress bar (inline) -->
            {#if extractingId === file.id && extractTotal > 0}
              <tr class="progress-row">
                <td colspan="5">
                  <div class="extract-progress">
                    <div class="bar">
                      <div class="fill" style="width: {extractPercent}%" />
                    </div>
                    <span class="mono">{extractProgress} / {extractTotal} files ({extractPercent}%)</span>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if toast}
    <div class="toast" class:toast-ok={toastType === 'ok'} class:toast-err={toastType === 'err'}>
      {toast}
    </div>
  {/if}
</section>

<!-- ── Read Modal ─────────────────────────────────────────────────────────── -->
{#if readTarget}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="overlay" on:click={closeRead}>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h3>📄 {readTarget.name}</h3>
        <button class="close-btn" on:click={closeRead}>✕</button>
      </div>

      {#if readLoading}
        <p class="muted">Reading from OPFS…</p>
      {:else if readError}
        <div class="alert error">{readError}</div>
      {:else}
        <div class="read-grid">
          <div class="read-row"><span>File</span><span class="mono">{readTarget.name}</span></div>
          <div class="read-row"><span>Size</span><span class="mono">{formatBytes(readTarget.size)}</span></div>
          <div class="read-row">
            <span>Readable</span>
            <span class="badge ok">{readReadable ? 'YES' : 'NO'}</span>
          </div>
          <div class="read-row">
            <span>In OPFS</span>
            <span class="badge ok">{readInOPFS ? 'YES' : 'NO'}</span>
          </div>
          {#if readTarget.extracted}
            <div class="read-row">
              <span>Extracted</span>
              <span class="badge ok">YES — {readTarget.entryCount} files</span>
            </div>
          {/if}
        </div>

        {#if downloadUrl}
          <a class="btn-download" href={downloadUrl} download={readTarget.name}>
            ⬇ Download ZIP
          </a>
        {/if}

        {#if readEntries.length > 0}
          <div class="entries">
            <p class="entries-title">ZIP Contents ({readEntries.length} entries)</p>
            <div class="entries-list">
              {#each readEntries as entry}
                <div class="entry" class:dir={entry.isDir}>
                  <span class="entry-icon">{entry.isDir ? '📂' : '📄'}</span>
                  <span class="entry-name">{entry.name}</span>
                  {#if !entry.isDir}
                    <span class="entry-size mono">{formatBytes(entry.size)}</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    position: relative;
  }

  h2 {
    margin: 0 0 1rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .muted {
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  th {
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-bottom: 2px solid var(--border);
    color: var(--text-muted);
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  td {
    padding: 0.625rem 0.75rem;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }

  tr:last-child td {
    border-bottom: none;
  }

  .name {
    font-weight: 500;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mono {
    font-family: monospace;
    font-size: 0.8rem;
  }

  /* ── badges ── */
  .badge {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }

  .badge.ok {
    background: #16a34a22;
    color: #16a34a;
    border: 1px solid #16a34a44;
  }

  .badge.idle {
    background: #64748b22;
    color: #94a3b8;
    border: 1px solid #64748b44;
  }

  /* ── action buttons ── */
  .actions {
    display: flex;
    gap: 0.375rem;
    flex-wrap: nowrap;
  }

  .btn-sm {
    padding: 3px 10px;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 4px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: opacity 0.15s, background 0.15s;
    white-space: nowrap;
  }

  .btn-sm:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-sm.read {
    background: #3b82f622;
    color: #3b82f6;
    border-color: #3b82f644;
  }

  .btn-sm.read:hover {
    background: #3b82f633;
  }

  .btn-sm.extract {
    background: #d9770622;
    color: #d97706;
    border-color: #d9770644;
    min-width: 58px;
    text-align: center;
  }

  .btn-sm.extract:hover:not(:disabled) {
    background: #d9770633;
  }

  .btn-sm.play {
    background: #16a34a22;
    color: #16a34a;
    border-color: #16a34a44;
  }

  .btn-sm.play:hover {
    background: #16a34a33;
  }

  .btn-sm.del {
    background: #dc262622;
    color: #dc2626;
    border-color: #dc262644;
  }

  .btn-sm.del:hover:not(:disabled) {
    background: #dc262633;
  }

  /* ── extraction progress row ── */
  .progress-row td {
    padding: 0 0.75rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .extract-progress {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .bar {
    flex: 1;
    height: 6px;
    background: var(--border);
    border-radius: 999px;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: #d97706;
    border-radius: 999px;
    transition: width 0.1s linear;
  }

  /* ── toast ── */
  .toast {
    position: absolute;
    bottom: 1rem;
    right: 1rem;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    animation: fadeIn 0.15s ease;
    z-index: 10;
  }

  .toast-ok {
    background: #16a34a18;
    color: #16a34a;
    border: 1px solid #16a34a44;
  }

  .toast-err {
    background: #dc262618;
    color: #dc2626;
    border: 1px solid #dc262644;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── read modal ── */
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 1rem;
  }

  .modal {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.5rem;
    max-width: 560px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    word-break: break-all;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.1rem;
    cursor: pointer;
    color: var(--text-muted);
    line-height: 1;
    padding: 0 0.25rem;
  }

  .read-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: var(--bg);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
  }

  .read-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .btn-download {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.6rem 1.25rem;
    background: #16a34a;
    color: #fff;
    text-decoration: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 600;
    transition: background 0.15s;
    align-self: flex-start;
  }

  .btn-download:hover {
    background: #15803d;
  }

  .entries-title {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .entries-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 240px;
    overflow-y: auto;
    background: var(--bg);
    border-radius: 6px;
    padding: 0.5rem;
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 2px 0.25rem;
    font-size: 0.8rem;
    border-radius: 4px;
  }

  .entry:hover {
    background: var(--border);
  }

  .entry-icon {
    flex-shrink: 0;
    font-size: 0.9rem;
  }

  .entry-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: monospace;
  }

  .entry-size {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .alert {
    padding: 0.625rem 0.875rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .alert.error {
    background: #dc262618;
    color: #dc2626;
    border: 1px solid #dc262644;
  }
</style>
