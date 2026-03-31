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
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
