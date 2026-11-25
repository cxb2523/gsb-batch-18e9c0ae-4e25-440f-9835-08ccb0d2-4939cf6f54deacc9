import { defineConfig, devices } from '@playwright/test';

/**
 * Config for the offline-download / audio-preload / mini-player coordination
 * suite (tests/offline-download.spec.ts).
 *
 * It mirrors the main config but runs against an already-running dev server on
 * PLAYWRIGHT_PORT (default 3217, matching config/playwright.config.ts) and skips
 * that config's global warm-up and webServer lifecycle, so the coordination
 * suite — which installs its own route mocks — can run in isolation.
 *
 * Start the server first:
 *   HTTP=1 bunx vite --port 3217 --strictPort
 *   bun run test:offline
 *
 * Set PW_CHROME_PATH to force a specific browser executable (used in
 * environments whose preinstalled Chromium revision differs from the one the
 * Playwright package pins); otherwise Playwright resolves its own browser.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3217);
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: '../tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: ORIGIN,
    trace: 'on-first-retry',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PW_CHROME_PATH
          ? { launchOptions: { executablePath: process.env.PW_CHROME_PATH } }
          : {}),
      },
    },
  ],
});
