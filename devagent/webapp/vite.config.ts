import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The workbench RPC/SSE live on the same origin (R1). The shell is served at `/`: the dev server
// proxies the API to the running server, and the production build is served by that same server.
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 5183,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4173', changeOrigin: false },
    },
  },
  build: { outDir: '../web-static', emptyOutDir: true },
});
