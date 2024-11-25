import { defineConfig, devices } from '@playwright/test';
import { CrxFixtureOptions } from './crx/crxTest';

export default defineConfig<CrxFixtureOptions>({
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
      use: {
        ...devices['Desktop Chrome'],
        enabledInIncognito: true,
      },
    },
  ],
  webServer: {
    command: 'npm run serve',
    url: 'http://127.0.0.1:3000',
  }
});
