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

import { test as base, expect } from './crxTest';
import type { Source } from '../../../playwright/packages/recorder/src/recorderTypes';
import type { ActionInContext } from '../../../playwright/packages/recorder/src/actions';

const test = base.extend<{ testParse: (code: string) => Promise<{ actions: ActionInContext[]}> }>({
  testParse: async ({ runCrxTest }, use) => {
    await use(async code => {
      const { source, code: resultCode } = await runCrxTest(async ({ crxApp }, code) => {
        const crxAppImpl = await (crxApp as any)._toImpl();
        return crxAppImpl.parseForTest(code) as { code: string, source: Source };
      }, code);
      expect.soft(code).toEqual(resultCode);
      return { actions: source.actions?.map(action => JSON.parse(action)) ?? [] };
    });
  },
});

test('should parse code', async ({ testParse }) => {
  const code = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://demo.playwright.dev/todomvc/#/');
  await page.getByPlaceholder('What needs to be done?').click();
  await page.getByPlaceholder('What needs to be done?').fill('Hello, World!');
  await page.getByPlaceholder('What needs to be done?').press('Enter');
  await expect(page.getByTestId('todo-title')).toContainText('Hello, World!');
  await expect(page.locator('body')).toMatchAriaSnapshot(\`
    - strong: 1
    - text: item left
    - list:
      - listitem:
        - link "All"
      - listitem:
        - link "Active"
      - listitem:
        - link "Completed"
    \`);
  await page.getByLabel('Toggle Todo').check();
  await page.getByRole('button', { name: 'Clear completed' }).click();
});`;
  const { actions } = await testParse(code);
  expect(actions).toMatchObject([
    { name: 'navigate' },
    { name: 'click', selector: 'internal:attr=[placeholder="What needs to be done?"i]' },
    { name: 'fill', selector: 'internal:attr=[placeholder="What needs to be done?"i]' },
    { name: 'press', selector: 'internal:attr=[placeholder="What needs to be done?"i]' },
    { name: 'assertText', selector: 'internal:testid=[data-testid="todo-title"s]' },
    { name: 'assertSnapshot', selector: 'body' },
    { name: 'check', selector: 'internal:label="Toggle Todo"i' },
    { name: 'click', selector: 'internal:role=button[name="Clear completed"i]' },
  ]);
});

test('should not parse incorrect code', async ({ testParse }) => {
  const code = `import { test, expect } from '@playwright/test';

  await page.goto('https://demo.playwright.dev/todomvc/#/');`;
  await expect(() => testParse(code)).rejects.toThrow();
});

test('should not parse action without await', async ({ testParse }) => {
  const code = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  page.goto('https://demo.playwright.dev/todomvc/#/');
});`;
  await expect(() => testParse(code)).rejects.toThrow();
});

test('should not parse wrong action', async ({ testParse }) => {
  const code = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.navigate('https://demo.playwright.dev/todomvc/#/');
});`;
  await expect(() => testParse(code)).rejects.toThrow();
});

test('should not parse non-locator assertion', async ({ testParse }) => {
  const code = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await expect('hello').toContainText('hello');
});`;
  await expect(() => testParse(code)).rejects.toThrow();
});
