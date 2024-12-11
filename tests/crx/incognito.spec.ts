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
import { test } from './crxTest';

test.skip(({ enabledInIncognito }) => !enabledInIncognito);

test('should create incognito page', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx, crxApp, server, expect }) => {
    const incognitoApp = await crx.start({ incognito: true });
    expect(incognitoApp).not.toBe(crxApp);
    const incognitoPage = await incognitoApp.newPage();
    expect(incognitoPage).toBeDefined();
    expect(crxApp.pages()).not.toContain(incognitoPage);
    await incognitoPage.goto(`${server.EMPTY_PAGE}?incognito`);
    const [tab] = await chrome.tabs.query({ url: `${server.EMPTY_PAGE}?incognito` });
    expect(tab?.incognito).toBe(true);
    await incognitoApp.close();
  });
});

test('should attach incognito tab', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx, crxApp, server, expect }) => {
    const incognitoApp = await crx.start({ incognito: true });
    const [tab] = await Promise.all([
      new Promise<chrome.tabs.Tab>(f => chrome.tabs.onCreated.addListener(f)),
      chrome.windows.create({ incognito: true, url: server.EMPTY_PAGE }),
    ]);
    const incognitoPage = await incognitoApp.attach(tab.id!);
    expect(crxApp.pages()).not.toContain(incognitoPage);
    expect(incognitoApp.pages()).toContain(incognitoPage);
    await incognitoApp.close();
  });
});

test('should close incognito page if incognito window is closed', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx, expect }) => {
    const incognitoApp = await crx.start({ incognito: true });
    const incognitoPage = await incognitoApp.newPage();
    const { id: windowId } = (await chrome.windows.getAll()).find(w => w.incognito) ?? {};
    await Promise.all([
      incognitoPage.waitForEvent('close'),
      chrome.windows.remove(windowId!),
    ]);
    expect(incognitoPage.isClosed()).toBe(true);
  });
});

test('should close incognito context if incognito window is closed', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx }) => {
    const incognitoApp = await crx.start({ incognito: true });
    const windows = await chrome.windows.getAll();
    const { id: windowId } = windows.find(w => w.incognito) ?? {};
    await Promise.all([
      incognitoApp.context().waitForEvent('close'),
      chrome.windows.remove(windowId!),
    ]);
  });
});

test('should allow new incognito context after closing', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx }) => {
    const incognitoApp = await crx.start({ incognito: true });
    await incognitoApp.close();
    await crx.start({ incognito: true });
  });
});

test('should fail if two incognito contexts are opened', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx, expect }) => {
    await crx.start({ incognito: true });
    await expect(() => crx.start({ incognito: true })).rejects.toThrowError('incognito crxApplication is already started');
  });
});

test('should fail if incognito tab is attached to default crxApp', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crxApp, server, expect }) => {
    const [tab] = await Promise.all([
      new Promise<chrome.tabs.Tab>(f => chrome.tabs.onCreated.addListener(f)),
      chrome.windows.create({ incognito: true, url: server.EMPTY_PAGE }),
    ]);
    await expect(crxApp.attach(tab.id!)).rejects.toThrowError('Tab is not in the expected browser context');
  });
});

test('should fail if normal tab is attached to incognito crxApp', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx, server, expect }) => {
    const tab = await chrome.tabs.create({ url: server.EMPTY_PAGE });
    const incognitoApp = await crx.start({ incognito: true });
    await expect(incognitoApp.attach(tab.id!)).rejects.toThrowError('Tab is not in the expected browser context');
  });
});

test('should fail when create new page in default crxApp passing on an incognito window', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crxApp, expect }) => {
    const [wnd] = await Promise.all([
      new Promise<chrome.windows.Window>(f => chrome.windows.onCreated.addListener(f)),
      chrome.windows.create({ incognito: true }),
    ]);
    await expect(crxApp.newPage({ windowId: wnd.id! })).rejects.toThrowError(/Window with id \d+ not found or bound to a different context/);
  });
});

test('should fail when create new page in incognito crxApp passing on a normal window', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx, expect }) => {
    const wnd = await chrome.windows.create();
    const incognitoApp = await crx.start({ incognito: true });
    await expect(incognitoApp.newPage({ windowId: wnd.id! })).rejects.toThrowError(/Window with id \d+ not found or bound to a different context/);
  });
});

test('should not detach normal pages when incognito crxApp is closed', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx, crxApp, expect }) => {
    const incognitoApp = await crx.start({ incognito: true });
    const page = await crxApp.newPage();
    await incognitoApp.close();
    expect(page.isClosed()).toBe(false);
  });
});

test('should create pages in corresponding contexts', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx, crxApp, expect }) => {
    const incognitoApp = await crx.start({ incognito: true });
    const page = await crxApp.context().newPage();
    const incognitoPage = await incognitoApp.context().newPage();
    expect(crxApp.pages()).toContain(page);
    expect(crxApp.pages()).not.toContain(incognitoPage);
    expect(incognitoApp.pages()).not.toContain(page);
    expect(incognitoApp.pages()).toContain(incognitoPage);
    await incognitoApp.close();
  });
});

test('should start with viewport', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx, expect, server }) => {
    const incognitoApp = await crx.start({
      incognito: true,
      contextOptions: {
        viewport: { width: 400, height: 620 }
      }
    });
    const [page] = incognitoApp.pages();
    await page.goto(server.EMPTY_PAGE);
    expect(page.viewportSize()).toEqual({ width: 400, height: 620 });
    expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([400, 620]);
    incognitoApp.close();
  });
});

test('should start with device name', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx, expect, server }) => {
    const incognitoApp = await crx.start({ incognito: true, deviceName: 'Nokia N9' });
    const [page] = incognitoApp.pages();
    await page.goto(server.EMPTY_PAGE);
    expect(page.viewportSize()).toEqual({ width: 480, height: 854 });
    await page.close();
    await incognitoApp.close();
  });
});

test('should start with device name and custom viewport', async ({ runCrxTest }) => {
  await runCrxTest(async ({ crx, expect, server }) => {
    const incognitoApp = await crx.start({
      incognito: true,
      deviceName: 'Nokia N9',
      contextOptions: {
        viewport: { width: 400, height: 620 }
      }
    });
    const [page] = incognitoApp.pages();
    await page.goto(server.EMPTY_PAGE);
    expect(page.viewportSize()).toEqual({ width: 400, height: 620 });
    await page.close();
    await incognitoApp.close();
  });
});
