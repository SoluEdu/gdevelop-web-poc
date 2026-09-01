<script lang="ts">
  import { onMount } from 'svelte';
  import { isOPFSAvailable, getStorageEstimate } from '../lib/storage/opfs';
  import { openDatabase } from '../lib/db/indexeddb';
  import { formatBytes } from '../lib/zip/zip';

  let opfsAvailable = false;
  let idbAvailable = false;
  let persistentStorage = false;
  let storageUsage = 0;
  let storageQuota = 0;
  let storagePercent = 0;
  let loading = true;

  export async function refresh() {
    try {
      const est = await getStorageEstimate();
      storageUsage = est.usage;
      storageQuota = est.quota;
      storagePercent = est.usedPercent;
    } catch {
      // estimate may fail silently
    }
  }

  onMount(async () => {
    opfsAvailable = isOPFSAvailable();

    try {
      await openDatabase();
      idbAvailable = true;
    } catch {
      idbAvailable = false;
    }

    try {
      persistentStorage = await navigator.storage.persisted();
    } catch {
      persistentStorage = false;
    }

    await refresh();
    loading = false;
  });
</script>

<section class="card">
  <h2>Storage Status</h2>

  {#if loading}
    <p class="muted">Checking…</p>
  {:else}
    <div class="grid">
      <div class="status-row">
        <span class="label">OPFS</span>
        <span class="badge" class:ok={opfsAvailable} class:err={!opfsAvailable}>
          {opfsAvailable ? 'Available' : 'Not Available'}
        </span>
      </div>

      <div class="status-row">
        <span class="label">IndexedDB</span>
        <span class="badge" class:ok={idbAvailable} class:err={!idbAvailable}>
          {idbAvailable ? 'Available' : 'Not Available'}
        </span>
      </div>

      <div class="status-row">
        <span class="label">Persistent Storage</span>
        <span class="badge" class:ok={persistentStorage} class:warn={!persistentStorage}>
          {persistentStorage ? 'YES' : 'NO'}
        </span>
      </div>

      <div class="divider" />

      <div class="status-row">
        <span class="label">Storage Usage</span>
        <span class="value">{formatBytes(storageUsage)}</span>
      </div>

      <div class="status-row">
        <span class="label">Storage Quota</span>
        <span class="value">{formatBytes(storageQuota)}</span>
      </div>

      <div class="status-row">
        <span class="label">Used</span>
        <span class="value">{storagePercent.toFixed(2)}%</span>
      </div>

      <div class="progress-bar">
        <div class="progress-fill" style="width: {Math.min(storagePercent, 100)}%" />
      </div>
    </div>
  {/if}
</section>

<style>
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
  }

  h2 {
    margin: 0 0 1rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .status-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9rem;
  }

  .label {
    color: var(--text-muted);
  }

  .value {
    font-weight: 500;
    font-family: monospace;
  }

  .badge {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    letter-spacing: 0.04em;
  }

  .badge.ok {
    background: #16a34a22;
    color: #16a34a;
    border: 1px solid #16a34a44;
  }

  .badge.err {
    background: #dc262622;
    color: #dc2626;
    border: 1px solid #dc262644;
  }

  .badge.warn {
    background: #d9770622;
    color: #d97706;
    border: 1px solid #d9770644;
  }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 0.25rem 0;
  }

  .progress-bar {
    height: 6px;
    background: var(--border);
    border-radius: 999px;
    overflow: hidden;
    margin-top: 0.25rem;
  }

  .progress-fill {
    height: 100%;
    background: #3b82f6;
    border-radius: 999px;
    transition: width 0.3s ease;
  }

  .muted {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
