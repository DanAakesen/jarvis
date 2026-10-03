import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/backend/src/foundry/**/*.test.mts"],
    clearMocks: true,
  },
});
