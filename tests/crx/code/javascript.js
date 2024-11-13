const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3000/input/textarea.html');
  await page.locator('textarea').click();
  await page.locator('textarea').fill('test');

  // ---------------------
  await context.close();
  await browser.close();
})();