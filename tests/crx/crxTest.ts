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

import type { Worker } from '@playwright/test';
import { test as base, chromium } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CrxApplication, BrowserContext as CrxBrowserContext, Page as CrxPage } from 'playwright-crx';
import type * as CrxTests from 'playwright-crx/test';
import { rimraf } from 'rimraf';

type CrxServer = {
  EMPTY_PAGE: string;
  PREFIX: string;
  CROSS_PROCESS_PREFIX: string;
};

type CrxFixtures = {
  expect: typeof CrxTests.expect;
  page: CrxPage;
  context: CrxBrowserContext;
  crxApp: CrxApplication;
  server: CrxServer;
  _debug: Debug;
}

type Debug = {
  enable(namespaces: string): Promise<void>;
  disable(): Promise<void>;
}

type CrxTest = (fixtures: CrxFixtures) => Promise<void>;

declare const serviceWorker: ServiceWorker;

// from https://playwright.dev/docs/chrome-extensions#testing
export const test = base.extend<{
  basePath: string,
  extensionPath: string;
  browserVersion: string;
  browserMajorVersion: number;
  createUserDataDir: () => string;
  extensionServiceWorker: Worker;
  extensionId: string;
  server: CrxServer;
  runCrxTest: (testFn: CrxTest) => Promise<void>;
  mockPaths: (paths: Record<string, string | { body: string, contentType?: string }>) => Promise<void>;
  _extensionServiceWorkerDevtools: void;
  _debug: Debug;
}>({

  basePath: path.join(__dirname, '..', '..', 'playwright', 'tests', 'assets'),

  extensionPath: path.join(__dirname, '..', 'test-extension', 'dist'),

  browserVersion: async ({ browser }, run) => {
    await run(browser.version());
  },

  browserMajorVersion: async ({ browserVersion }, run) => {
    await run(Number(browserVersion.split('.')[0]));
  },

  createUserDataDir: async ({}, run) => {
    const dirs: string[] = [];
    await run(() => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-crx-test-'));
      dirs.push(dir);
      return dir;
    });
    await rimraf(dirs).catch(() => {});
  },

  context: async ({ extensionPath, createUserDataDir }, use) => {
    const context = await chromium.launchPersistentContext(createUserDataDir(), {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },

  extensionServiceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');

    // wait for initialization
    await worker.evaluate(() => new Promise<void>((resolve, reject) => {
      if (serviceWorker.state !== 'activated') {
        serviceWorker.addEventListener('statechange', () => {
          if (serviceWorker.state === 'activated') resolve();
        });
        serviceWorker.addEventListener('error', reject);
      } else {
        resolve();
      }
    }));

    await use(worker);
  },

  extensionId: async ({ extensionServiceWorker }, use) => {
    const extensionId = extensionServiceWorker.url().split('/')[2];
    await use(extensionId);
  },

  server: async ({ baseURL }, use) => {
    const prefix = baseURL!;
    const crossProcessUrl = new URL(prefix);
    crossProcessUrl.hostname = crossProcessUrl.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    const crossProcessPrefix = crossProcessUrl.toString().replace(/\/$/, '');
    await use({
      PREFIX: prefix,
      CROSS_PROCESS_PREFIX: crossProcessPrefix,
      EMPTY_PAGE: `${baseURL}/empty.html`,
    });
  },

  runCrxTest: async ({ extensionServiceWorker, server }, use) => {
    const params = { server };
    use((fn) => extensionServiceWorker.evaluate(`_runTest(${fn.toString()}, ${JSON.stringify(params)})`));
  },

  mockPaths: async ({ context, baseURL }, run) => {
    await run(async (paths) => {
      await Promise.all([
        ...Object.entries(paths).map(([path, mockedContent]) => {
          if (path.startsWith('/')) path = path.substring(1);
          const { body, contentType } = typeof mockedContent === 'string' ? { body: mockedContent, contentType: undefined } : mockedContent;
          return context.route(`${baseURL}/${path}`, route => route.fulfill({ body, contentType }));
        })
      ]);
    });
  },

  // we don't have a way to capture service worker logs, so this trick will open
  // service worker dev tools for debugging purposes
  _extensionServiceWorkerDevtools: async ({ context, extensionId, extensionServiceWorker }, run) => {
    const extensionsPage = await context.newPage();
    await extensionsPage.goto(`chrome://extensions/?id=${extensionId}`);
    await extensionsPage.locator('#devMode').click();
    await extensionsPage.getByRole('link', { name: /.*service worker.*/ }).click();
    await extensionsPage.close();
    // ensures devtools is open (it must stop in debugger, and user will take at least 1 sec. to continue)
    while(true) {
      const start = Date.now();
      await extensionServiceWorker.evaluate(() => { debugger });
      if (Date.now() - start > 1000) break;
      await new Promise(r => setTimeout(r, 100));
    }
    await run();
  },

  _debug: async ({ extensionServiceWorker }, run) => {
    await run({
      async enable(namespaces: string) {
        await extensionServiceWorker.evaluate((namespaces) => {
          // @ts-ignore
          const _debug = self._debug as any;
          if (!_debug) console.warn(`_debug is not available`);
          _debug?.enable(namespaces);
        }, namespaces);
      },

      async disable() {
        await extensionServiceWorker.evaluate(() => {
          // @ts-ignore
          const _debug = self._debug as any;
          if (!_debug) console.warn(`_debug is not available`);
          _debug?.disable();
        });
      }
    });
  },
});

export const expect = test.expect;
