import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const port = Number(process.env.BRAI_WEB_PLAYWRIGHT_PORT ?? 3210);
const externalBaseURL = process.env.BRAI_WEB_E2E_BASE_URL;
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;
const browserExecutable =
  process.env.BRAI_PLAYWRIGHT_EXECUTABLE_PATH ??
  (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        },
      }),
  use: {
    baseURL,
    browserName: "chromium",
    launchOptions: {
      executablePath: browserExecutable,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
