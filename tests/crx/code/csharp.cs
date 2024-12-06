using Microsoft.Playwright;
using System;
using System.Threading.Tasks;

using var playwright = await Playwright.CreateAsync();
await using var browser = await playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
{
    Headless = false,
});
var context = await browser.NewContextAsync();

var page = await context.NewPageAsync();
await page.GotoAsync("http://127.0.0.1:3000/input/textarea.html");
await page.Locator("textarea").ClickAsync();
await page.Locator("textarea").FillAsync("test");
