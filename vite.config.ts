import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';

// Ask the OS for a free TCP port so concurrent yadiff/Vite instances
// don't fight over the default HMR port (24678).
function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => resolvePort(port));
      } else {
        srv.close();
        reject(new Error('Failed to acquire a free port'));
      }
    });
  });
}

export default defineConfig(async () => {
  const hmrPort = process.env.VITE_HMR_PORT
    ? Number(process.env.VITE_HMR_PORT)
    : await getFreePort();

  return {
    plugins: [react()],
    cacheDir: resolve(tmpdir(), '.yadiff-vite'),
    worker: {
      format: 'es',
    },
    server: {
      strictPort: false,
      fs: {
        // Allow serving files from the entire package tree (needed when
        // installed inside node_modules via npx).
        allow: ['..'],
      },
      hmr: {
        port: hmrPort,
      },
    },
  };
});
