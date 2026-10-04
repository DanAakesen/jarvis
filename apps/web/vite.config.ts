import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { createPublicConfig } from './config/public-config.ts';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({ mode }) => {
  const bootstrap: unknown = JSON.parse(readFileSync(new URL('../../infra/bootstrap.output.json', import.meta.url), 'utf8'));
  const settings: { backendUrl: unknown } = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
  const env = loadEnv(mode, repositoryRoot, 'VITE_BACKEND_URL');
  const publicConfig = createPublicConfig(bootstrap, env.VITE_BACKEND_URL ?? settings.backendUrl);

  return {
    plugins: [react()],
    // Load only the explicit public URL override, not arbitrary root environment variables.
    envDir: repositoryRoot,
    envPrefix: [],
    define: { __JARVIS_CONFIG__: JSON.stringify(publicConfig) },
    server: { host: '0.0.0.0', port: 5173, strictPort: true },
    build: {
      rollupOptions: {
        // redirect.html is MSAL's redirect bridge for popup and silent sign-in (L63).
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          redirect: fileURLToPath(new URL('./redirect.html', import.meta.url)),
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.tsx', 'config/**/*.test.ts'],
    },
  };
});
