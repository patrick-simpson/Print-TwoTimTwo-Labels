import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The website is published to GitHub Pages under /Print-TwoTimTwo-Labels/,
// so all assets need that base prefix. When building locally for preview
// set VITE_BASE=/ to make it root-relative.
export default defineConfig({
  root: __dirname,
  base: process.env.VITE_BASE || '/Print-TwoTimTwo-Labels/',
  plugins: [react()],
  publicDir: path.resolve(__dirname, 'public'),
  build: {
    outDir: path.resolve(__dirname, '..', 'dist', 'website'),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@': __dirname,
    },
  },
});
