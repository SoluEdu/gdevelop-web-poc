import { createApp } from 'vue';
import App from './App.vue';

// Service Worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js', { scope: '/games/' })
    .then((reg) => console.log('[SW] Registered, scope:', reg.scope))
    .catch((err) => console.error('[SW] Registration failed:', err));
}

createApp(App).mount('#app');
