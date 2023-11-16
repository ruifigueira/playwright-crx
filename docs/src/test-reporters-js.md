---
id: test-reporters
title: "Reporters"
---

## Introduction

Playwright Test comes with a few built-in reporters for different needs and ability to provide custom reporters. The easiest way to try out built-in reporters is to pass `--reporter` [command line option](./test-cli.md).


```bash
npx playwright test --reporter=line
```

For more control, you can specify reporters programmatically in the [configuration file](./test-configuration.md).

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'line',
});
```

### Multiple reporters

You can use multiple reporters at the same time. For example  you can use `'list'` for nice terminal output and `'json'` to get a comprehensive json file with the test results.

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['json', {  outputFile: 'test-results.json' }]
  ],
});
```

### Reporters on CI

You can use different reporters locally and on CI. For example, using concise `'dot'` reporter avoids too much output. This is the default on CI.

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Concise 'dot' for CI, default 'list' when running locally
  reporter: process.env.CI ? 'dot' : 'list',
});
```

## Built-in reporters

All built-in reporters show detailed information about failures, and mostly differ in verbosity for successful runs.

### List reporter

List reporter is default (except on CI where the `dot` reporter is default). It prints a line for each test being run.

```bash
npx playwright test --reporter=list
```

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
});
```

Here is an example output in the middle of a test run. Failures will be listed at the end.
```bash
npx playwright test --reporter=list
Running 124 tests using 6 workers

 1  ✓ should access error in env (438ms)
 2  ✓ handle long test names (515ms)
 3  x 1) render expected (691ms)
 4  ✓ should timeout (932ms)
 5    should repeat each:
 6  ✓ should respect enclosing .gitignore (569ms)
 7    should teardown env after timeout:
 8    should respect excluded tests:
 9  ✓ should handle env beforeEach error (638ms)
10    should respect enclosing .gitignore:
```

You can opt into the step rendering via passing the following config option:

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['list', { printSteps: true }]],
});
```

### Line reporter

Line reporter is more concise than the list reporter. It uses a single line to report last finished test, and prints failures when they occur. Line reporter is useful for large test suites where it shows the progress but does not spam the output by listing all the tests.

```bash
npx playwright test --reporter=line
```

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'line',
});
```

Here is an example output in the middle of a test run. Failures are reported inline.
```bash
npx playwright test --reporter=line
Running 124 tests using 6 workers
  1) dot-reporter.spec.ts:20:1 › render expected ===================================================

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: 1
    Received: 0

[23/124] gitignore.spec.ts - should respect nested .gitignore
```

### Dot reporter

Dot reporter is very concise - it only produces a single character per successful test run. It is the default on CI and useful where you don't want a lot of output.

```bash
npx playwright test --reporter=dot
```

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'dot',
});
```

Here is an example output in the middle of a test run. Failures will be listed at the end.
```bash
npx playwright test --reporter=dot
Running 124 tests using 6 workers
······F·············································
```

### HTML reporter

HTML reporter produces a self-contained folder that contains report for the test run that can be served as a web page.

```bash
npx playwright test --reporter=html
```

By default, HTML report is opened automatically if some of the tests failed. You can control this behavior via the
`open` property in the Playwright config or the `PW_TEST_HTML_REPORT_OPEN` environmental variable. The possible values for that property are `always`, `never` and `on-failure`
(default).

You can also configure `host` and `port` that are used to serve the HTML report.

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['html', { open: 'never' }]],
});
```

By default, report is written into the `playwright-report` folder in the current working directory. One can override
that location using the `PLAYWRIGHT_HTML_REPORT` environment variable or a reporter configuration.

In configuration file, pass options directly:

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['html', { outputFolder: 'my-report' }]],
});
```

If you are uploading attachments from data folder to other location, you can use `attachmentsBaseURL` option to let html report where to look for them.

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['html', { attachmentsBaseURL: 'https://external-storage.com/' }]],
});
```

A quick way of opening the last test run report is:

```bash
npx playwright show-report
```

Or if there is a custom folder name:

```bash
npx playwright show-report my-report
```

### Blob reporter

Blob reports contain all the details about the test run and can be used later to produce any other report. Their primary function is to facilitate the merging of reports from [sharded tests](./test-sharding.md).

```bash
npx playwright test --reporter=blob
```

By default, the report is written into the `blob-report` directory in the package.json directory or current working directory (if no package.json is found). The output directory can be overridden in the configuration file:

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['blob', { outputDir: 'my-report' }]],
});
```

### JSON reporter

JSON reporter produces an object with all information about the test run.

Most likely you want to write the JSON to a file. When running with `--reporter=json`, use `PLAYWRIGHT_JSON_OUTPUT_NAME` environment variable:

```bash tab=bash-bash
PLAYWRIGHT_JSON_OUTPUT_NAME=results.json npx playwright test --reporter=json
```

```batch tab=bash-batch
set PLAYWRIGHT_JSON_OUTPUT_NAME=results.json
npx playwright test --reporter=json
```

```powershell tab=bash-powershell
$env:PLAYWRIGHT_JSON_OUTPUT_NAME="results.json"
npx playwright test --reporter=json
```

In configuration file, pass options directly:

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['json', { outputFile: 'results.json' }]],
});
```

### JUnit reporter

JUnit reporter produces a JUnit-style xml report.

Most likely you want to write the report to an xml file. When running with `--reporter=junit`, use `PLAYWRIGHT_JUNIT_OUTPUT_NAME` environment variable:

```bash tab=bash-bash
PLAYWRIGHT_JUNIT_OUTPUT_NAME=results.xml npx playwright test --reporter=junit
```

```batch tab=bash-batch
set PLAYWRIGHT_JUNIT_OUTPUT_NAME=results.xml
npx playwright test --reporter=junit
```

```powershell tab=bash-powershell
$env:PLAYWRIGHT_JUNIT_OUTPUT_NAME="results.xml"
npx playwright test --reporter=junit
```

In configuration file, pass options directly:

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['junit', { outputFile: 'results.xml' }]],
});
```

### GitHub Actions annotations

You can use the built in `github` reporter to get automatic failure annotations when running in GitHub actions.

Note that all other reporters work on GitHub Actions as well, but do not provide annotations.

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // 'github' for GitHub Actions CI to generate annotations, plus a concise 'dot'
  // default 'list' when running locally
  reporter: process.env.CI ? 'github' : 'list',
});
```

## Custom reporters

You can create a custom reporter by implementing a class with some of the reporter methods. Learn more about the [Reporter] API.

```js title="my-awesome-reporter.ts"
import type {
  FullConfig, FullResult, Reporter, Suite, TestCase, TestResult
} from '@playwright/test/reporter';

class MyReporter implements Reporter {
  onBegin(config: FullConfig, suite: Suite) {
    console.log(`Starting the run with ${suite.allTests().length} tests`);
  }

  onTestBegin(test: TestCase, result: TestResult) {
    console.log(`Starting test ${test.title}`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    console.log(`Finished test ${test.title}: ${result.status}`);
  }

  onEnd(result: FullResult) {
    console.log(`Finished the run: ${result.status}`);
  }
}

export default MyReporter;
```

Now use this reporter with [`property: TestConfig.reporter`].

```js title="playwright.config.ts"
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: './my-awesome-reporter.ts',
});
```
## Third party reporter showcase

* [Allure](https://www.npmjs.com/package/allure-playwright)
* [Argos Visual Testing](https://argos-ci.com/docs/playwright)
* [Currents](https://www.npmjs.com/package/@currents/playwright)
* [Monocart](https://github.com/cenfun/monocart-reporter)
* [ReportPortal](https://github.com/reportportal/agent-js-playwright)
* [Serenity/JS](https://serenity-js.org/handbook/test-runners/playwright-test)
* [Testmo](https://github.com/jonasclaes/playwright-testmo-reporter)
* [Testomat.io](https://github.com/testomatio/reporter/blob/master/docs/frameworks.md#playwright)
* [Tesults](https://www.tesults.com/docs/playwright)
