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

test('should fire', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, expect }) => {
    page.on('dialog', dialog => {
      expect(dialog.type()).toBe('alert');
      expect(dialog.defaultValue()).toBe('');
      expect(dialog.message()).toBe('yo');
      void dialog.accept();
    });
    await page.evaluate(() => alert('yo'));
  });
});

test('should allow accepting prompts @smoke', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, expect }) => {
    page.on('dialog', dialog => {
      expect(dialog.type()).toBe('prompt');
      expect(dialog.defaultValue()).toBe('yes.');
      expect(dialog.message()).toBe('question?');
      void dialog.accept('answer!');
    });
    const result = await page.evaluate(() => prompt('question?', 'yes.'));
    expect(result).toBe('answer!');
  });
});

test('should dismiss the prompt', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, expect }) => {
    page.on('dialog', dialog => dialog.dismiss());
    const result = await page.evaluate(() => prompt('question?'));
    expect(result).toBe(null);
  });
});

test('should accept the confirm prompt', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, expect }) => {
    page.on('dialog', dialog => {
      void dialog.accept();
    });
    const result = await page.evaluate(() => confirm('boolean?'));
    expect(result).toBe(true);
  });
});

test('should dismiss the confirm prompt', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, expect }) => {
    page.on('dialog', dialog => {
      void dialog.dismiss();
    });
    const result = await page.evaluate(() => confirm('boolean?'));
    expect(result).toBe(false);
  });
});

test('should be able to close context with open alert', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page }) => {
    const alertPromise = page.waitForEvent('dialog');
    await page.evaluate(() => {
      window.setTimeout(() => alert('hello'), 0);
    });
    await alertPromise;
  });
});

test('should handle multiple alerts', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, expect, server }) => {
    await page.goto(server.EMPTY_PAGE);
    page.on('dialog', dialog => {
      void dialog.accept().catch(e => {});
    });
    await page.setContent(`
      <p>Hello World</p>
      <script>
        alert('Please dismiss this dialog');
        alert('Please dismiss this dialog');
        alert('Please dismiss this dialog');
      </script>
    `);
    expect(await page.textContent('p')).toBe('Hello World');
  });
});

test('should handle multiple confirms', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, expect, server }) => {
    await page.goto(server.EMPTY_PAGE);
    page.on('dialog', dialog => {
      void dialog.accept().catch(e => {});
    });
    await page.setContent(`
      <p>Hello World</p>
      <script>
        confirm('Please confirm me?');
        confirm('Please confirm me?');
        confirm('Please confirm me?');
      </script>
    `);
    expect(await page.textContent('p')).toBe('Hello World');
  });
});

test('should auto-dismiss the prompt without listeners', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, expect }) => {
    const result = await page.evaluate(() => prompt('question?'));
    expect(result).toBe(null);
  });
});

test('should auto-dismiss the alert without listeners', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page, expect, server }) => {
    await page.goto(server.EMPTY_PAGE);
    await page.setContent(`<div onclick="window.alert(123); window._clicked=true">Click me</div>`);
    await page.click('div');
    expect(await page.evaluate('window._clicked')).toBe(true);
  });
});
