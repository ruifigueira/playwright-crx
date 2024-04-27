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

type Tab = chrome.tabs.Tab;

test('should work @smoke', async ({ runCrxTest }) => {
  await runCrxTest(async ({ expect, crxApp }) => {
    const numPages = crxApp.pages().length;
    const newPage = await crxApp.newPage();
    expect(crxApp.pages()).toHaveLength(numPages + 1);
    let closed = false;
    newPage.once('close', () => {
      closed = true;
    });
    await newPage.close();
    expect(crxApp.pages()).toHaveLength(numPages);
    expect(closed).toBeTruthy();
  });
});

test('should add attached page to context', async ({ runCrxTest }) => {
  await runCrxTest(async ({ expect, crxApp }) => {
    const tab = await chrome.tabs.create({ url: 'about:blank' });
    const page = await crxApp.attach(tab.id!);
    expect(crxApp.pages()).toContain(page);
  });
});

test('should remove detached page from context', async ({ runCrxTest }) => {
  await runCrxTest(async ({ expect, crxApp }) => {
    const tab = await chrome.tabs.create({ url: 'about:blank' });
    const page = await crxApp.attach(tab.id!);
    await crxApp.detach(tab.id!);
    expect(crxApp.pages()).not.toContain(page);
  });
});

test('should detach with page', async ({ runCrxTest }) => {
  await runCrxTest(async ({ expect, crxApp }) => {
    const page = await crxApp.newPage();
    expect(crxApp.pages()).toContain(page);
    await crxApp.detach(page);
    expect(crxApp.pages()).not.toContain(page);
  });
});

test('should create new page', async ({ runCrxTest }) => {
  await runCrxTest(async ({ expect, crxApp, server }) => {
    const windowTabPromise = new Promise<Tab>(x => chrome.tabs.onCreated.addListener(x));
    const window = await chrome.windows.create();
    // wait for the default tab of the window to be created
    await windowTabPromise;

    // this will catch the tab created via crx
    const tabPromise = new Promise<Tab>(x => chrome.tabs.onCreated.addListener(x));
    const page = await crxApp.newPage({
      windowId: window.id,
      url: server.EMPTY_PAGE,
    });
    expect(crxApp.pages()).toContain(page);
    expect(page.url()).toBe(server.EMPTY_PAGE);

    const { id: tabId } = await tabPromise;
    const tab = await chrome.tabs.get(tabId!);
    expect(tab.url).toBe(server.EMPTY_PAGE);
    expect(tab.windowId).toBe(window.id);
  });
});

test('should attach with query url as string', async ({ runCrxTest }) => {
  await runCrxTest(async ({ expect, crxApp, server }) => {
    await chrome.tabs.create({ url: server.EMPTY_PAGE });
    const [p1] = await crxApp.attachAll({
      url: server.EMPTY_PAGE
    });
    expect(p1).toBeTruthy();
    expect(p1.url()).toBe(server.EMPTY_PAGE);
  });
});

test('should attach with query url as array of strings', async ({ runCrxTest }) => {
  await runCrxTest(async ({ expect, crxApp, server }) => {
    await Promise.all([
      chrome.tabs.create({ url: server.EMPTY_PAGE }),
      chrome.tabs.create({ url: server.PREFIX + '/input/button.html' }),
      chrome.tabs.create({ url: 'about:blank' }),
    ]);
    const pages = await crxApp.attachAll({
      url: [server.EMPTY_PAGE, server.PREFIX + '/input/button.html'],
    });
    expect(pages).toHaveLength(2);
    const urls = pages.map(p => p.url());
    expect(urls).toContain(server.EMPTY_PAGE);
    expect(urls).toContain(server.PREFIX + '/input/button.html');
  });
});

test('should attach matching pages', async ({ runCrxTest }) => {
  await runCrxTest(async ({ expect, crxApp, server }) => {
    const { id: windowId } = await chrome.windows.create();
    await Promise.all([
      chrome.tabs.create({ url: server.EMPTY_PAGE }),
      chrome.tabs.create({ url: server.EMPTY_PAGE, windowId }),
      chrome.tabs.create({ url: 'about:blank', windowId }),
    ]);
    const pages = await crxApp.attachAll({
      url: server.EMPTY_PAGE
    });
    expect(pages).toHaveLength(2);
    const [p1, p2] = pages;
    expect(p1).toBeTruthy();
    expect(p2).toBeTruthy();
    expect(crxApp.pages()).toContain(p1);
    expect(crxApp.pages()).toContain(p2);
    expect(p1.url()).toBe(server.EMPTY_PAGE);
    expect(p2.url()).toBe(server.EMPTY_PAGE);
  });
});

test('should attach popup pages', async ({ runCrxTest }) => {
  await runCrxTest(async ({ expect, page, server }) => {
    await page.goto(server.EMPTY_PAGE);
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.evaluate(url => { window.open(url); }, server.EMPTY_PAGE),
    ]);
    expect(popup.url()).toBe(server.EMPTY_PAGE);
  });
});

// if detached manually by the user (with canceled_by_user), it works.
// aparently, a chrome.debugger.onDetached event is not triggered if
// chrome.debugger.detached is called
test.fixme('should remove page if tab is externally detached',async ({ runCrxTest }) => {
  test.skip(true, '');
  await runCrxTest(async ({ expect, crxApp }) => {
    const { id: tabId } = await chrome.tabs.create({ url: 'about:blank' });
    const page = await crxApp.attach(tabId!);
    expect(await page.evaluate(() => 42)).toBe(42);
    await new Promise<void>(x => chrome.debugger.detach({ tabId }, x));
    expect(crxApp.pages()).not.toContain(page);
  });
});

test('should not block on pages with service workers', async ({ runCrxTest }) => {
  await runCrxTest(async ({ expect, page, server }) => {
    await page.goto(`${server.PREFIX}/serviceworkers/empty/sw.html`);
    await expect(page.evaluate(() => window['registrationPromise'])).resolves.toBeTruthy();
  });
});

// https://github.com/ruifigueira/playwright-crx/issues/14
test("should take screenshot", async ({ runCrxTest }) => {
  await runCrxTest(async ({ expect, page }) => {
    await page.goto('about:blank');
    await page.setContent('<h1>Hello World!</h1>');
    const screenshot = await page.screenshot();
    expect(screenshot).not.toBeNull();
  });
});

test('should report oopif frames', async ({ runCrxTest, browserMajorVersion }) => {
  test.skip(browserMajorVersion < 126);

  await runCrxTest(async ({ page, server, expect }) => {
    await page.goto(server.PREFIX + '/dynamic-oopif.html');
    expect(page.frames().length).toBe(2);
    expect(await page.frames()[1].evaluate(() => '' + location.href)).toBe(server.CROSS_PROCESS_PREFIX + '/grid.html');
  });
});
