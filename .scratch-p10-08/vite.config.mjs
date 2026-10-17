import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('../apps/web/', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [{ find: /^\.\/auth$/, replacement: fileURLToPath(new URL('./auth.ts', import.meta.url)) }],
  },
  define: {
    __JARVIS_CONFIG__: JSON.stringify({
      tenantId: '00000000-0000-4000-8000-000000000001',
      webClientId: '00000000-0000-4000-8000-000000000002',
      apiScope: 'api://fixture/access_as_user',
      backendUrl: 'https://fixture.invalid',
    }),
  },
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
});
