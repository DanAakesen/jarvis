import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,mts}'],
    exclude: ['src/**/*.integration.test.ts'],
    clearMocks: true,
  },
});
