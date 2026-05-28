import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  plugins: [react()],
  cacheDir: resolve(tmpdir(), '.yadiff-vite'),
  worker: {
    format: 'es',
  },
  server: {
    fs: {
      // Allow serving files from the entire package tree (needed when
      // installed inside node_modules via npx).
      allow: ['..'],
    },
  },
});
