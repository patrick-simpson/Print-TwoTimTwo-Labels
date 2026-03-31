import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Root is the renderer/ directory (where this config lives).
// Output goes to electron-app/dist/ so main.js can load it.
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: true
  },
  base: './'
});
