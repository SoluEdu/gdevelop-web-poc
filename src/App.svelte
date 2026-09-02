<script lang="ts">
  import StorageInfo from './components/StorageInfo.svelte';
  import FileUpload from './components/FileUpload.svelte';
  import GithubImport from './components/GithubImport.svelte';
  import FileList from './components/FileList.svelte';
  import TestPanel from './components/TestPanel.svelte';
  import type { StoredFile } from './lib/db/indexeddb';

  let storageInfo: StorageInfo;
  let fileList: FileList;

  async function onFileSaved(e: CustomEvent<StoredFile>) {
    await fileList.reload();
    await storageInfo.refresh();
  }

  async function onFileDeleted() {
    await storageInfo.refresh();
  }

  async function onRefreshAll() {
    await fileList.reload();
    await storageInfo.refresh();
  }
</script>

<div class="app">
  <header>
    <div class="header-inner">
      <span class="logo">🗂</span>
      <div>
        <h1>Browser Storage POC</h1>
        <p class="subtitle">OPFS + IndexedDB — no backend required</p>
      </div>
    </div>
  </header>

  <main>
    <div class="layout">
      <!-- Left column: status + upload -->
      <div class="left">
        <StorageInfo bind:this={storageInfo} />
        <FileUpload on:saved={onFileSaved} />
        <GithubImport on:saved={onFileSaved} />
      </div>

      <!-- Right column: list + tests -->
      <div class="right">
        <FileList bind:this={fileList} on:deleted={onFileDeleted} on:refreshStorage={onFileDeleted} />
        <TestPanel on:refreshAll={onRefreshAll} />
      </div>
    </div>
  </main>
</div>

<style>
  /* ── CSS variables (dark theme) ──────────────────────────────────────────── */
  :global(:root) {
    --bg: #0f1117;
    --card: #1a1d27;
    --border: #2a2d3a;
    --text: #e2e8f0;
    --text-muted: #94a3b8;

    color-scheme: dark;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    min-height: 100dvh;
  }

  :global(h1, h2, h3, h4) {
    line-height: 1.2;
  }

  :global(p) {
    margin: 0;
  }

  /* ── layout ──────────────────────────────────────────────────────────────── */

  .app {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
  }

  header {
    border-bottom: 1px solid var(--border);
    background: var(--card);
    padding: 0 1.5rem;
  }

  .header-inner {
    max-width: 1280px;
    margin: 0 auto;
    padding: 1rem 0;
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .logo {
    font-size: 2rem;
    line-height: 1;
  }

  h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
  }

  .subtitle {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
  }

  main {
    flex: 1;
    padding: 1.5rem;
  }

  .layout {
    max-width: 1280px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 380px 1fr;
    gap: 1.25rem;
    align-items: start;
  }

  .left,
  .right {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  @media (max-width: 860px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
