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
    emptyOutDir: true,
    // Every asset as a file, never a data: URI: the window's CSP
    // (default-src 'self') would refuse a data: font or image.
    assetsInlineLimit: 0
  },
  server: {
    // The brand kit and the stepped-chip script live in the print server's
    // public folder (the one mirror); let the dev server read them.
    fs: { allow: [path.resolve(__dirname, '..'), path.resolve(__dirname, '../../print-server/public')] }
  },
  base: './'
});
