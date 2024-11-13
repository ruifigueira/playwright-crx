import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/input/textarea.html');
  await page.locator('textarea').click();
  await page.locator('textarea').fill('test');
});