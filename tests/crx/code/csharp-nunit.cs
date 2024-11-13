using Microsoft.Playwright.NUnit;
using Microsoft.Playwright;

[Parallelizable(ParallelScope.Self)]
[TestFixture]
public class Tests : PageTest
{
    [Test]
    public async Task MyTest()
    {
        await Page.GotoAsync("http://127.0.0.1:3000/input/textarea.html");
        await Page.Locator("textarea").ClickAsync();
        await Page.Locator("textarea").FillAsync("test");
    }
}
