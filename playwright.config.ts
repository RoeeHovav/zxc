import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

const PORT = Number(process.env.E2E_PORT ?? 3200);
const executablePath = process.env.PW_CHROMIUM_PATH || (process.env.PLAYWRIGHT_BROWSERS_PATH ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } }],
  webServer: {
    // The standalone server is what Docker runs; `npm run build` must have been run first.
    command: "sh scripts/start-standalone.sh",
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: process.env.E2E_DATABASE_URL ?? "", UPLOAD_DIR: path.resolve("storage/e2e-uploads"), APP_ENV: "development", PORT: String(PORT), HOSTNAME: "127.0.0.1" },
  },
});
