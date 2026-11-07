import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-development-csp',
      apply: 'serve',
      // Vite React refresh injects an inline preamble in development only.
      transformIndexHtml: { order: 'pre', handler: html => html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';") },
    },
  ],
  envPrefix: [],
  base: './',
  server: { host: '127.0.0.1', port: 5183, strictPort: true },
  build: { outDir: 'dist/renderer' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.tsx', 'electron/**/*.test.ts'],
    restoreMocks: true,
  },
});
