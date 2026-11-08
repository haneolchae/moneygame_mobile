import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 화면(renderer) 번들. Electron이 file://로 불러오므로 상대 경로(base './')를 쓴다.
export default defineConfig({
  root: 'src/ui',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
