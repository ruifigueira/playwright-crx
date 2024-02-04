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

import { crx, expect } from 'playwright-crx/test';
import Sval from 'sval';
import { UserScript, add, getAll, getById } from './userScripts';
import { matchesUrlPattern } from './utils';

async function doRunUserScript(userScript: UserScript, context: Record<string, any>) {
  // Create a interpreter
  const interpreter = new Sval({ sandBox: true });
  interpreter.import(context);
  interpreter.run(`
    exports.ret = (async () => {
      // ensure there's no access to exports
      const exports = undefined;

      await (${userScript.code})({ ${Object.keys(context).join(', ')} });
    })();
  `);

  await (interpreter.exports.ret as Promise<void>).catch(e => console.error(e));
}

async function runUserScript({ id }: { id: number }) {
  const userScript = await getById(id);

  if (!userScript.newWindow) {
    if (!currentTabInfo?.tabId) return;
    const { url } = await chrome.tabs.get(currentTabInfo.tabId) ?? {};
    if (!url || !url.startsWith('http')) return;
    const urlPatterns = userScript.urlPatterns ?? [];
    if (urlPatterns.length > 0 && !urlPatterns.some(up => matchesUrlPattern(up, url))) return;
  }

  const crxApp = await crx.start({ slowMo: 250 });
  const page = userScript.newWindow ? await crxApp.newPage() : await crxApp.attach(currentTabInfo!.tabId!);

  try {
    await doRunUserScript(userScript, { page, context: page.context(), crxApp, expect });
  } finally {
    await crxApp.detach(page);
  }
}

chrome.action.onClicked.addListener(async ({ windowId }) => {
  chrome.sidePanel.open({ windowId });
});

type TabInfo = {
  tabId?: number;
  windowId?: number;
  url?: string;
}

let currentTabInfo: TabInfo | undefined;
function updateCurrentTab(newCurrentTabInfo?: TabInfo) {
  currentTabInfo = newCurrentTabInfo;
  chrome.runtime.sendMessage({ type: 'currentTabUpdated', currentTabInfo });
}

chrome.tabs.onUpdated.addListener((tabId, { url }) => {
  if (currentTabInfo?.tabId === tabId) {
    updateCurrentTab({ ...currentTabInfo, url });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const { url } = await chrome.tabs.get(tabId) ?? {};
  updateCurrentTab({ tabId, windowId, url });
});

chrome.runtime.onMessage.addListener(async (request) => {
  switch (request.type) {
    case 'runUserScript':
      await runUserScript(request).finally(() => chrome.runtime.sendMessage({ type: 'runUserScriptCompleted' }));
      break;
    case 'getCurrentTab':
      updateCurrentTab(currentTabInfo);
      break;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const scripts = await getAll();
  if (Object.values(scripts).length > 0) return;

  await add({
    name: 'todo',
    code: `async function run({ page }) {
  const TODO_ITEMS = [
    'buy some cheese',
    'feed the cat',
    'book a doctors appointment'
  ];

  await page.goto('https://demo.playwright.dev/todomvc');

  // delete all todos
  await page.evaluate(() => {
    if (localStorage?.length) {
      localStorage.clear();
      location.reload();
    }
  });

  // create a new todo locator
  const newTodo = page.getByPlaceholder('What needs to be done?');

  for (const item of TODO_ITEMS) {
    await newTodo.fill(item);
    await newTodo.press('Enter');
  }
}
`,
    newWindow: true,
  })
});
