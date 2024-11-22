import { ReportEntry } from '@testIsomorphic/testServerInterface';
import { crx, CrxApplication, type Page } from 'playwright-crx';
import { TestCode } from './parser';
import { VirtualFs } from './virtualFs';


function createGuid(): string {
  let guid = '';
  for (let i = 0; i < 16; i++) {
    guid += ('00' + Math.floor(Math.random() * 255).toString(16)).slice(-2);
  }
  return guid;
}

export class TestRunner {
  private _fs: VirtualFs;
  private _reportEventDispatcher: (params: ReportEntry) => void;
  
  constructor(fs: VirtualFs, reportEventDispatcher: (params: ReportEntry) => void) {
    this._fs = fs;
    this._reportEventDispatcher = reportEventDispatcher;
  }

  async runTests(tests: { testId: string, test: TestCode }[]) {
    const startTime = new Date().getTime();

    this._reportEventDispatcher({ method: 'onBegin', params: {} });

    for (const test of tests) {
      await this._runTest(test);
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

  async _runTest({ testId, test }: { testId: string, test: TestCode }) {
    const testRunId = createGuid();
    const startTime = new Date().getTime();
    let status = 'passed';

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
    const crxApp = await crx.start({ incognito: true });
    const [page] = crxApp.pages();
    try {
      const tracingImpl = (crx as any)._toImpl(crxApp.context().tracing);
      await tracingImpl.start({
        name: testId,
        screenshots: true,
        snapshots: true,
        live: true,
      });
      await tracingImpl.startChunk();
      await crxApp.recorder.playActions(test.actions, page);
      await crxApp.context().tracing.stop({ path: `/tmp/traces/${testId}.zip` });
      const trace = new Blob([await crx.fs.promises.readFile(`/tmp/traces/${testId}.zip`)]);
      await this._fs.writeFile(`test-results/${testId}/trace.zip`, trace);
    } catch (e) {
      // TODO handle errors
      status = 'failed';
    }
    await page.close();
    await crxApp.close();
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
  }
}