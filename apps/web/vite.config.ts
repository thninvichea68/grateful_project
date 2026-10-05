/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in development: the refresh cookie works without CORS.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 900 },
  test: { environment: 'jsdom', setupFiles: ['src/test/setup.ts'], css: false },
});
