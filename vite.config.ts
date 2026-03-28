import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // Base path for GitHub Pages (repository name)
      base: '/Print-TwoTimTwo-Labels/',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          // Serves bookmarklet.js and bookmarklet.min.js from the project root
          // during dev, and emits both into dist/ during build.
          // bookmarklet.html fetches bookmarklet.js to build the drag-to-bookmark URL.
          // bookmarklet.min.js contains "javascript:..." and can be pasted directly
          // into a browser bookmark URL field.
          name: 'serve-bookmarklet-source',
          configureServer(server) {
            server.middlewares.use('/bookmarklet.js', (_req, res) => {
              res.setHeader('Content-Type', 'text/javascript');
              res.end(fs.readFileSync(path.resolve(__dirname, 'bookmarklet.js')));
            });
            server.middlewares.use('/bookmarklet.min.js', (_req, res) => {
              res.setHeader('Content-Type', 'text/javascript');
              res.end(fs.readFileSync(path.resolve(__dirname, 'bookmarklet.min.js')));
            });
          },
          generateBundle() {
            this.emitFile({
              type: 'asset',
              fileName: 'bookmarklet.js',
              source: fs.readFileSync(path.resolve(__dirname, 'bookmarklet.js'), 'utf8'),
            });
            this.emitFile({
              type: 'asset',
              fileName: 'bookmarklet.min.js',
              source: fs.readFileSync(path.resolve(__dirname, 'bookmarklet.min.js'), 'utf8'),
            });
          },
        },
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
