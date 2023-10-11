# Playwrigh CRX

This package contains the [Chrome Extensions](https://developer.chrome.com/docs/extensions/) flavor of the [Playwright](http://github.com/microsoft/playwright) library. If you want to write end-to-end tests, we recommend [@playwright/test](https://playwright.dev/docs/intro).

## Build

To build `playwright-crx`:

```bash
npm ci
npm run build
```

## Updating Playwright

Playwright is nested as a git subtree.

To update it, just run the following command (replace `v1.38.1` with the desired release tag):

```bash
git subtree pull --prefix=playwright git@github.com:microsoft/playwright.git v1.38.1 --squash
```
