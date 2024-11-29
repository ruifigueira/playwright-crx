import { ReportEntry } from '@testIsomorphic/testServerInterface';
import { crx, CrxApplication } from 'playwright-crx';
import { VirtualFs } from './virtualFs';
import { JsonTestCase } from '@testIsomorphic/teleReceiver';

function createGuid(): string {
  let guid = '';
  for (let i = 0; i < 16; i++) {
    guid += ('00' + Math.floor(Math.random() * 255).toString(16)).slice(-2);
  }
  return guid;
}

export class TestRunner {
  private _crxApp: CrxApplication;
  private _fs: VirtualFs;
  private _reportEventDispatcher: (params: ReportEntry) => void;
  
  constructor(crxApp: CrxApplication, fs: VirtualFs, reportEventDispatcher: (params: ReportEntry) => void) {
    this._crxApp = crxApp;
    this._fs = fs;
    this._reportEventDispatcher = reportEventDispatcher;
  }

  async runTests(testCases: JsonTestCase[]) {
    const startTime = new Date().getTime();

    this._reportEventDispatcher({ method: 'onBegin', params: {} });
    let status = 'passed';
    for (const testCase of testCases) {
      const testStatus = await this._runTest(testCase);
      if (testStatus === 'failed')
        status = 'failed';
    }

    this._reportEventDispatcher({
      method: 'onEnd',
      params: {
        result: {
          status,
          startTime,
          duration: new Date().getTime() - startTime,
        }
      }
    });
  }

  async _runTest(testCase: JsonTestCase) {
    const testRunId = createGuid();
    const startTime = new Date().getTime();
    let status = 'passed';

    const testId = testCase.testId;
    const code = await this._fs.readFile(testCase.location.file, { encoding: 'utf-8' });
    const tests = await this._crxApp.recorder.list(code);
    const test = tests.find(t => t.location?.line === testCase.location.line);
    if (!test)
      throw new Error(`Test not found: ${testCase.location.file}:${testCase.location.line}`);

    this._reportEventDispatcher({
      method: 'onTestBegin',
      params: {
        testId: testId,
        result: {
          id: testRunId,
          retry: 0,
          workerIndex: 0,
          parallelIndex: 0,
          startTime,
        }
      }
    });
    const incognitoCrxApp = await crx.start({
      incognito: true,
      deviceName: test.options?.deviceName,
      contextOptions: {
        viewport: { width: 1280, height: 720 },
        ...test.options?.contextOptions
      }
    });
    const [page] = incognitoCrxApp.pages();
    try {
      const tracingImpl = (crx as any)._toImpl(incognitoCrxApp.context().tracing);
      await tracingImpl.start({
        name: testId,
        screenshots: true,
        snapshots: true,
        live: true,
      });
      await tracingImpl.startChunk();
      await incognitoCrxApp.recorder.run(code, page);
      await incognitoCrxApp.context().tracing.stop({ path: `/tmp/traces/${testId}.zip` });
      const trace = new Blob([await crx.fs.promises.readFile(`/tmp/traces/${testId}.zip`)]);
      await this._fs.writeFile(`test-results/${testId}/trace.zip`, trace);
    } catch (e) {
      // TODO handle errors
      status = 'failed';
    }
    await page.close();
    await incognitoCrxApp.close();
    this._reportEventDispatcher({
      method: 'onTestEnd',
      params: {
        test: {
          testId: testId,
          expectedStatus: 'passed',
          annotations: [],
          timeout: 30000
        },
        result: {
          id: testRunId,
          duration: new Date().getTime() - startTime,
          status,
          errors: [],
          attachments: [
            {
              name: 'trace',
              path: `test-results/${testId}/trace.zip`,
              contentType: 'application/zip'
            }
          ]
        }
      }
    });
    return status;
  }
}