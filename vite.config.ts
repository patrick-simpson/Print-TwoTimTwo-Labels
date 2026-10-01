import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // Base path: GitHub Pages serves the repo under its name; the one-site
      // build (site/build.mjs) serves this at the root of awana.kvbchurch.org
      // and sets SITE_BASE=/.
      base: process.env.SITE_BASE || '/Print-TwoTimTwo-Labels/',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        // Compiled Tailwind v4 (was the runtime cdn.tailwindcss.com script).
        // Scanning is pinned to the site's own files in styles/site.css.
        tailwindcss(),
      ],
      build: {
        rollupOptions: {
          // Two pages: the marketing SPA (index) and the capabilities/roadmap
          // reference (capabilities). Both ship to GitHub Pages.
          input: {
            main: path.resolve(__dirname, 'index.html'),
            capabilities: path.resolve(__dirname, 'capabilities.html'),
          },
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
