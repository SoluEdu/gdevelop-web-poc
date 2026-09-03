<script setup lang="ts">
import { ref } from 'vue';
import StorageInfo from './components/StorageInfo.vue';
import FileUpload from './components/FileUpload.vue';
import GithubImport from './components/GithubImport.vue';
import FileList from './components/FileList.vue';
import TestPanel from './components/TestPanel.vue';
import type { StoredFile } from './lib/db/indexeddb';

const storageInfoRef = ref<InstanceType<typeof StorageInfo> | null>(null);
const fileListRef = ref<InstanceType<typeof FileList> | null>(null);

async function onFileSaved(_file: StoredFile) {
  await fileListRef.value?.reload();
  await storageInfoRef.value?.refresh();
}
async function onFileDeleted() {
  await storageInfoRef.value?.refresh();
}
async function onRefreshAll() {
  await fileListRef.value?.reload();
  await storageInfoRef.value?.refresh();
}
</script>

<template>
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
        <div class="left">
          <StorageInfo ref="storageInfoRef" />
          <FileUpload @saved="onFileSaved" />
          <GithubImport @saved="onFileSaved" />
        </div>
        <div class="right">
          <FileList ref="fileListRef" @deleted="onFileDeleted" @refreshStorage="onFileDeleted" />
          <TestPanel @refreshAll="onRefreshAll" />
        </div>
      </div>
    </main>
  </div>
</template>

<style>
:root {
  --bg: #0f1117;
  --card: #1a1d27;
  --border: #2a2d3a;
  --text: #e2e8f0;
  --text-muted: #94a3b8;
  color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  min-height: 100dvh;
}
h1, h2, h3, h4 { line-height: 1.2; }
p { margin: 0; }
.app { display: flex; flex-direction: column; min-height: 100dvh; }
header { border-bottom: 1px solid var(--border); background: var(--card); padding: 0 1.5rem; }
.header-inner { max-width: 1280px; margin: 0 auto; padding: 1rem 0; display: flex; align-items: center; gap: 1rem; }
.logo { font-size: 2rem; line-height: 1; }
h1 { margin: 0; font-size: 1.25rem; font-weight: 700; }
.subtitle { font-size: 0.8rem; color: var(--text-muted); margin: 0; }
main { flex: 1; padding: 1.5rem; }
.layout { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: 380px 1fr; gap: 1.25rem; align-items: start; }
.left, .right { display: flex; flex-direction: column; gap: 1.25rem; }
@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } }
</style>
