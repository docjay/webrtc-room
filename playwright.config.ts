import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  // A full three-profile real browser ICE matrix can legitimately consume all
  // per-profile deadlines before the post-matrix performance assertion.
  timeout: 180_000,
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', headless: true },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
