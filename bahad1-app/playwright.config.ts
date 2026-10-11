import { defineConfig, devices } from '@playwright/test';

// E2E runs against SYNTHETIC fixture content (scripts/make-fixture.mjs) so no book content is needed or exposed.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { baseURL: 'http://localhost:4173', trace: 'off', locale: 'he-IL', timezoneId: 'Asia/Jerusalem' },
  webServer: {
    command: 'node scripts/make-fixture.mjs && E2E_FIXTURE=1 npx vite build && E2E_FIXTURE=1 npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { E2E_FIXTURE: '1' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 393, height: 851 } } },
  ],
});
