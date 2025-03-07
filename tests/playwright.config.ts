/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { defineConfig, devices } from '@playwright/test';
import type { CrxFixtureOptions } from './crx/crxTest';

export default defineConfig<CrxFixtureOptions>({
  testDir: './crx',
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
    ...(process.env.CI ? [] : [{
      name: 'Chrome DevTools',
      use: {
        ...devices['Desktop Chrome'],
        enabledInIncognito: true,
        openDevTools: true,
      },
      timeout: 300_000,
    }]),
  ],
  webServer: {
    command: 'npm run serve',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
  }
});
