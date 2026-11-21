import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const apiProxy = {
  // Same-origin API access for interactive dev and preview: the browser talks
  // to Vite only, and Vite forwards to the Rust server. The target is the
  // Browser development and E2E share this loopback HTTP/WebSocket proxy.
  // Host is rewritten upstream; the browser Origin must remain intact.
  '/api': {
    target: process.env.DEEPBLOCK_DEV_PROXY_TARGET ?? 'http://127.0.0.1:8000',
    changeOrigin: true,
    ws: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: process.env.DEEPBLOCK_DEV_BIND ?? '127.0.0.1',
    port: Number(process.env.DEEPBLOCK_DEV_PORT ?? 5173),
    strictPort: true,
    allowedHosts: (process.env.DEEPBLOCK_DEV_HOSTNAMES ?? '').split(',').filter(Boolean),
    proxy: apiProxy,
  },
  preview: {
    host: process.env.DEEPBLOCK_DEV_BIND ?? '127.0.0.1',
    strictPort: true,
    proxy: apiProxy,
  },
});
