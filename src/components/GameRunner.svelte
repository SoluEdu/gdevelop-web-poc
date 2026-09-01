<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import type { StoredFile } from '../lib/db/indexeddb';

  export let game: StoredFile;

  const dispatch = createEventDispatcher<{ close: void }>();

  let iframe: HTMLIFrameElement;
  let isFullscreen = false;

  // Don't set src immediately — wait for SW to be ready first.
  // Without this, Vite's dev server intercepts /games/** and returns its own index.html.
  let iframeSrc = '';
  let swStatus: 'waiting' | 'ready' | 'error' = 'waiting';
  let swError = '';

  const gameUrl = `/games/${game.id}/index.html`;

  onMount(async () => {
    if (!('serviceWorker' in navigator)) {
      swStatus = 'error';
      swError = 'Service Worker is not supported in this browser.';
      return;
    }

    try {
      // Ensure ServiceWorker for /games/ scope is registered and active.
      // Note: navigator.serviceWorker.ready hangs on '/' because scope is '/games/'!
      let reg = await navigator.serviceWorker.getRegistration('/games/');
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js', { scope: '/games/' });
      }

      if (reg.active && reg.active.state === 'activated') {
        swStatus = 'ready';
        iframeSrc = gameUrl;
        return;
      }

      const worker = reg.installing || reg.waiting || reg.active;
      if (worker) {
        await new Promise<void>((resolve) => {
          if (worker.state === 'activated') {
            resolve();
            return;
          }
          const onStateChange = () => {
            if (worker.state === 'activated') {
              worker.removeEventListener('statechange', onStateChange);
              resolve();
            }
          };
          worker.addEventListener('statechange', onStateChange);
          // Safety fallback timeout
          setTimeout(resolve, 1500);
        });
      }

      swStatus = 'ready';
      iframeSrc = gameUrl;
    } catch (e) {
      swStatus = 'error';
      swError = `Service Worker failed to activate: ${(e as Error).message}`;
    }
  });

  function close() {
    if (iframe) iframe.src = 'about:blank';
    dispatch('close');
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await iframe.requestFullscreen?.();
      isFullscreen = true;
    } else {
      await document.exitFullscreen?.();
      isFullscreen = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  function openInNewTab() {
    window.open(gameUrl, '_blank');
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="overlay" on:click={close}>
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="runner" on:click|stopPropagation>

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <div class="header">
      <div class="title">
        <span class="icon">🎮</span>
        <div>
          <span class="name">{game.name}</span>
          {#if game.entryCount}
            <span class="meta">{game.entryCount} files</span>
          {/if}
        </div>
      </div>

      <div class="actions">
        <button class="btn-icon" title="Open in new tab" on:click={openInNewTab}>⧉</button>
        <button class="btn-icon" title="Toggle fullscreen" on:click={toggleFullscreen}>
          {isFullscreen ? '⊠' : '⛶'}
        </button>
        <button class="btn-icon btn-close" title="Close (Esc)" on:click={close}>✕</button>
      </div>
    </div>

    <!-- ── Game iframe ─────────────────────────────────────────────────────── -->
    <div class="iframe-wrap">
      {#if swStatus === 'waiting'}
        <div class="sw-overlay">
          <div class="spinner" />
          <p>Waiting for Service Worker…</p>
        </div>
      {:else if swStatus === 'error'}
        <div class="sw-overlay error">
          <p>⚠ {swError}</p>
          <p class="hint">Make sure the app is served over HTTPS and SW is registered.</p>
        </div>
      {:else}
        <iframe
          bind:this={iframe}
          src={iframeSrc}
          title={game.name}
          allow="autoplay; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups"
        />
      {/if}
    </div>

    <!-- ── Footer ─────────────────────────────────────────────────────────── -->
    <div class="footer">
      <span class="url mono">{gameUrl}</span>
      <span class="hint">Served from OPFS via Service Worker · Press Esc to close</span>
    </div>

  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 1rem;
  }

  .runner {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: min(1200px, 100%);
    height: min(820px, 90dvh);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  }

  /* ── header ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    gap: 1rem;
    flex-shrink: 0;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-width: 0;
  }

  .icon {
    font-size: 1.4rem;
    flex-shrink: 0;
  }

  .name {
    font-weight: 700;
    font-size: 0.95rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }

  .meta {
    font-size: 0.75rem;
    color: var(--text-muted);
    display: block;
  }

  .actions {
    display: flex;
    gap: 0.375rem;
    flex-shrink: 0;
  }

  .btn-icon {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: 6px;
    width: 32px;
    height: 32px;
    font-size: 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .btn-icon:hover {
    background: var(--border);
    color: var(--text);
  }

  .btn-close:hover {
    background: #dc262622;
    color: #dc2626;
    border-color: #dc262644;
  }

  /* ── iframe ── */
  .iframe-wrap {
    flex: 1;
    overflow: hidden;
    background: #000;
    position: relative;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }

  /* ── SW loading / error overlay ── */
  .sw-overlay {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .sw-overlay.error {
    color: #dc2626;
    text-align: center;
    padding: 2rem;
  }

  .sw-overlay .hint {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--border);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── footer ── */
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 1rem;
    border-top: 1px solid var(--border);
    gap: 1rem;
    flex-shrink: 0;
  }

  .url {
    font-size: 0.72rem;
    color: #3b82f6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .mono {
    font-family: monospace;
  }
</style>
