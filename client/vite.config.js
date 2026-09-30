import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时 /api 代理到 Node 服务；生产构建产物由 Express 直接托管。
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
