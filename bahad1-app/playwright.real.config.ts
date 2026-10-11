import { defineConfig, devices } from '@playwright/test';
// Runs against the REAL private build (dist/ with public/content). Local use only; never run in a public CI.
export default defineConfig({
  testDir: 'tests/real', timeout: 90_000, workers: 1, retries: 0, reporter: [['list']], outputDir: 'test-results/real',
  use: { baseURL: 'http://localhost:4174', locale: 'he-IL', timezoneId: 'Asia/Jerusalem' },
  webServer: { command: 'npx vite preview --port 4174 --strictPort', url: 'http://localhost:4174', reuseExistingServer: true, timeout: 60_000 },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }, { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 393, height: 851 } } }],
});
