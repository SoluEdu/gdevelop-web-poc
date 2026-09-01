<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { saveFile as opfsSave } from '../lib/storage/opfs';
  import { addFile } from '../lib/db/indexeddb';
  import { validateZip, formatBytes } from '../lib/zip/zip';
  import { generateUUID } from '../lib/utils/uuid';
  import type { StoredFile } from '../lib/db/indexeddb';

  const dispatch = createEventDispatcher<{ saved: StoredFile }>();

  let selectedFile: File | null = null;
  let error = '';
  let success = '';
  let saving = false;

  function handleFileChange(e: Event) {
    error = '';
    success = '';
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    selectedFile = file;

    if (file) {
      try {
        validateZip(file);
      } catch (err) {
        error = (err as Error).message;
        selectedFile = null;
        input.value = '';
      }
    }
  }

  async function handleSave() {
    if (!selectedFile) return;
    saving = true;
    error = '';
    success = '';

    try {
      const id = generateUUID();
      const opfsPath = `uploads/${id}.zip`;

      // 1. Write binary to OPFS
      await opfsSave(id, selectedFile);

      // 2. Write metadata to IndexedDB
      const meta: StoredFile = {
        id,
        name: selectedFile.name,
        size: selectedFile.size,
        type: selectedFile.type || 'application/zip',
        createdAt: Date.now(),
        opfsPath,
      };
      await addFile(meta);

      success = `"${selectedFile.name}" saved successfully!`;
      dispatch('saved', meta);
      selectedFile = null;

      // reset input
      const input = document.getElementById('zip-input') as HTMLInputElement;
      if (input) input.value = '';
    } catch (err) {
      error = `Save failed: ${(err as Error).message}`;
    } finally {
      saving = false;
    }
  }
</script>

<section class="card">
  <h2>Upload ZIP</h2>

  <label class="drop-zone" for="zip-input">
    <span class="icon">📁</span>
    <span>{selectedFile ? selectedFile.name : 'Choose a .zip file'}</span>
    <input
      id="zip-input"
      type="file"
      accept=".zip"
      on:change={handleFileChange}
      hidden
    />
  </label>

  {#if selectedFile}
    <div class="file-meta">
      <div class="meta-row">
        <span class="label">Selected</span>
        <span class="value">{selectedFile.name}</span>
      </div>
      <div class="meta-row">
        <span class="label">Size</span>
        <span class="value">{formatBytes(selectedFile.size)}</span>
      </div>
      <div class="meta-row">
        <span class="label">Type</span>
        <span class="value">{selectedFile.type || 'application/zip'}</span>
      </div>
    </div>

    <button class="btn-primary" on:click={handleSave} disabled={saving}>
      {saving ? 'Saving…' : '💾 Save to Browser'}
    </button>
  {/if}

  {#if error}
    <div class="alert error">⚠ {error}</div>
  {/if}

  {#if success}
    <div class="alert success">✓ {success}</div>
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

  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 2rem 1rem;
    border: 2px dashed var(--border);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    font-size: 0.9rem;
    color: var(--text-muted);
    text-align: center;
  }

  .drop-zone:hover {
    border-color: #3b82f6;
    background: #3b82f608;
    color: var(--text);
  }

  .icon {
    font-size: 2rem;
  }

  .file-meta {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.75rem 1rem;
    background: var(--bg);
    border-radius: 6px;
    font-size: 0.875rem;
  }

  .meta-row {
    display: flex;
    justify-content: space-between;
  }

  .label {
    color: var(--text-muted);
  }

  .value {
    font-weight: 500;
    font-family: monospace;
    word-break: break-all;
  }

  .btn-primary {
    padding: 0.6rem 1.25rem;
    background: #3b82f6;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    align-self: flex-start;
  }

  .btn-primary:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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

  .alert.success {
    background: #16a34a18;
    color: #16a34a;
    border: 1px solid #16a34a44;
  }
</style>
