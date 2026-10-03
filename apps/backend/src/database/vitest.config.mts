import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/database/**/*.integration.test.ts'],
    testTimeout: 150_000,
    hookTimeout: 150_000,
    fileParallelism: false,
  },
});
