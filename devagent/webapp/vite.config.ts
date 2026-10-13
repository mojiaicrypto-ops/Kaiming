import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The workbench RPC/SSE live on the same origin (R1): the dev server proxies them to the
// running server, and the production build is served by that same server under /app/.
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  server: {
    port: 5183,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4173', changeOrigin: false },
      '/i18n.json': { target: 'http://127.0.0.1:4173', changeOrigin: false },
      '/vendor': { target: 'http://127.0.0.1:4173', changeOrigin: false },
    },
  },
  build: { outDir: '../web-static/app', emptyOutDir: true },
});
