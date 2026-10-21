import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ["./tests/global-setup.ts"],
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
});
