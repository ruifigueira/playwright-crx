import re
from playwright.sync_api import Page, expect


def test_example(page: Page) -> None:
    page.goto("http://127.0.0.1:3000/input/textarea.html")
    page.locator("textarea").click()
    page.locator("textarea").fill("test")
