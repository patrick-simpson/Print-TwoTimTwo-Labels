import path from 'path';
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
