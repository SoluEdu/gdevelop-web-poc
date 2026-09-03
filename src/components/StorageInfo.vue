<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { isOPFSAvailable, getStorageEstimate } from '../lib/storage/opfs';
import { openDatabase } from '../lib/db/indexeddb';
import { formatBytes } from '../lib/zip/zip';

const opfsAvailable = ref(false);
const idbAvailable = ref(false);
const persistentStorage = ref(false);
const storageUsage = ref(0);
const storageQuota = ref(0);
const storagePercent = ref(0);
const loading = ref(true);

async function refresh() {
  try {
    const est = await getStorageEstimate();
    storageUsage.value = est.usage;
    storageQuota.value = est.quota;
    storagePercent.value = est.usedPercent;
  } catch {}
}

onMounted(async () => {
  opfsAvailable.value = isOPFSAvailable();
  try { await openDatabase(); idbAvailable.value = true; } catch { idbAvailable.value = false; }
  try { persistentStorage.value = await navigator.storage.persisted(); } catch { persistentStorage.value = false; }
  await refresh();
  loading.value = false;
});

defineExpose({ refresh });
</script>

<template>
  <section class="card">
    <h2>Storage Status</h2>
    <p v-if="loading" class="muted">Checking…</p>
    <div v-else class="grid">
      <div class="status-row">
        <span class="label">OPFS</span>
        <span class="badge" :class="opfsAvailable ? 'ok' : 'err'">{{ opfsAvailable ? 'Available' : 'Not Available' }}</span>
      </div>
      <div class="status-row">
        <span class="label">IndexedDB</span>
        <span class="badge" :class="idbAvailable ? 'ok' : 'err'">{{ idbAvailable ? 'Available' : 'Not Available' }}</span>
      </div>
      <div class="status-row">
        <span class="label">Persistent Storage</span>
        <span class="badge" :class="persistentStorage ? 'ok' : 'warn'">{{ persistentStorage ? 'YES' : 'NO' }}</span>
      </div>
      <div class="divider" />
      <div class="status-row">
        <span class="label">Storage Usage</span>
        <span class="value">{{ formatBytes(storageUsage) }}</span>
      </div>
      <div class="status-row">
        <span class="label">Storage Quota</span>
        <span class="value">{{ formatBytes(storageQuota) }}</span>
      </div>
      <div class="status-row">
        <span class="label">Used</span>
        <span class="value">{{ storagePercent.toFixed(2) }}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: Math.min(storagePercent, 100) + '%' }" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem 1.5rem; }
h2 { margin: 0 0 1rem; font-size: 1rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.grid { display: flex; flex-direction: column; gap: 0.5rem; }
.status-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; }
.label { color: var(--text-muted); }
.value { font-weight: 500; font-family: monospace; }
.badge { font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.04em; }
.badge.ok { background: #16a34a22; color: #16a34a; border: 1px solid #16a34a44; }
.badge.err { background: #dc262622; color: #dc2626; border: 1px solid #dc262644; }
.badge.warn { background: #d9770622; color: #d97706; border: 1px solid #d9770644; }
.divider { height: 1px; background: var(--border); margin: 0.25rem 0; }
.progress-bar { height: 6px; background: var(--border); border-radius: 999px; overflow: hidden; margin-top: 0.25rem; }
.progress-fill { height: 100%; background: #3b82f6; border-radius: 999px; transition: width 0.3s ease; }
.muted { color: var(--text-muted); font-size: 0.875rem; }
</style>
