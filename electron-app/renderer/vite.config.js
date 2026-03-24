import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Root is the renderer/ directory (where this config lives).
// Output goes to electron-app/dist/ so main.js can load it.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  base: './'
});
