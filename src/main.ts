import App from './App.svelte';

// ── Service Worker registration ───────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js', { scope: '/games/' })
    .then((reg) => console.log('[SW] Registered, scope:', reg.scope))
    .catch((err) => console.error('[SW] Registration failed:', err));
}

const app = new App({
  target: document.getElementById('app')!,
});

export default app;
