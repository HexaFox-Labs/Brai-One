import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@brai/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url),
      ),
      "@brai/nats": fileURLToPath(
        new URL("../../packages/nats/src/index.ts", import.meta.url),
      ),
      "@brai/runtime": fileURLToPath(
        new URL("../../packages/runtime/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
  },
});
