import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    fileParallelism: false,
    hookTimeout: 180_000,
    include: ["test/**/*.integration.test.ts"],
    isolate: false,
    testTimeout: 60_000,
  },
});
