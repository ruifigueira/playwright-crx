import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Chrome Tip-of-Tree',
      use: { ...devices['Desktop Chrome'], channel: "chromium-tip-of-tree" },
    },
  ],
  webServer: {
    command: 'npm run serve',
    url: 'http://127.0.0.1:3000',
  }
});
