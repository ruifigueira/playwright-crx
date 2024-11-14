import { test } from './crxTest';

test('should return no cookies in pristine browser context', async ({ runCrxTest }) => {
  await runCrxTest(async ({ context, expect }) => {
    expect(await context.cookies()).toEqual([]);
  });
});

test('should get a cookie @smoke', async ({ runCrxTest, server }) => {
  await runCrxTest(async ({ page, context, expect, server }) => {
    await page.goto(server.EMPTY_PAGE);
    const documentCookie = await page.evaluate(() => {
      document.cookie = 'username=John Doe';
      return document.cookie;
    });
    expect(documentCookie).toBe('username=John Doe');
    const domain = new URL(server.PREFIX).hostname;
    expect(await context.cookies()).toEqual([{
      name: 'username',
      value: 'John Doe',
      domain,
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    }]);
  });
});
