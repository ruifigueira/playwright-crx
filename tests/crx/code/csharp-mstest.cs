using Microsoft.Playwright.MSTest;
using Microsoft.Playwright;

[TestClass]
public class Tests : PageTest
{
    [TestMethod]
    public async Task MyTest()
    {
        await Page.GotoAsync("http://127.0.0.1:3000/input/textarea.html");
        await Page.Locator("textarea").ClickAsync();
        await Page.Locator("textarea").FillAsync("test");
    }
}
