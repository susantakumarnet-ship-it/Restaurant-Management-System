import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_API_PROXY || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/uploads': { target: API, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: { manualChunks: { charts: ['recharts'], vendor: ['react', 'react-dom', 'react-router-dom'] } },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any);
