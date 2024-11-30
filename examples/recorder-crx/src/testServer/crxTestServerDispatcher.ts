import type { Language } from "@isomorphic/locatorGenerators";
import type { ReportEntry, TestServerInterface, TestServerInterfaceEventEmitters } from "@testIsomorphic/testServerInterface";
import type { CrxApplication, Page } from "playwright-crx/test";
import { filterCookies } from "../utils/network";
import { ExtendedProjectVirtualFs, readReport, TeleReporter } from "../utils/project";
import { releaseVirtualFs, requestVirtualFs, saveFile, VirtualFs } from "../utils/virtualFs";
import { CrxTestServerExtension } from "./crxTestServerTransport";
import { SourceLocation } from "@trace-viewer/ui/modelUtil";
import { JsonTestCase } from "@testIsomorphic/teleReceiver";
import { TestRunner } from "../utils/testRunner";

export class CrxTestServerDispatcher implements Partial<TestServerInterface>, TestServerInterfaceEventEmitters, CrxTestServerExtension {
  private _crxAppPromise: Promise<CrxApplication>;
  private _virtualFsPromise: Promise<VirtualFs> | undefined;
  private _ports: Set<chrome.runtime.Port> = new Set();
  private _currentSourceLocation?: SourceLocation;

  constructor(crxAppPromise: Promise<CrxApplication>) {
    this._crxAppPromise = crxAppPromise;
  }

  addPort(port: chrome.runtime.Port) {
    this._ports.add(port);
    port.onMessage.addListener(async ({ id, method, params }) => {
      try {
        const result = await (this as any)[method]?.(params);
        port.postMessage({ id, method, params, result });
      } catch (error) {
        if (error instanceof Error)
          error = { message: error.message, stack: error.stack };
        port.postMessage({ id, method, params, error });
      }
    });
    port.onDisconnect.addListener(() => this._ports.delete(port));
  }

  dispatchEvent(event: 'report', params: ReportEntry): void;
  dispatchEvent(event: 'stdio', params: { type: 'stdout' | 'stderr'; text?: string; buffer?: string; }): void;
  dispatchEvent(event: 'testFilesChanged', params: { testFiles: string[]; }): void;
  dispatchEvent(event: 'loadTraceRequested', params: { traceUrl: string; }): void;
  dispatchEvent(event: string, params: any): void {
    for (const port of this._ports)
      port.postMessage({ method: event, params });
  }

  async initialize() {
    this._virtualFsPromise = requestVirtualFs('ui-mode.project-dir', 'readwrite').then(fs => new ExtendedProjectVirtualFs(fs));
    await this._virtualFsPromise;
  }

  async ping() { }

  async checkBrowsers(_: Parameters<TestServerInterface['checkBrowsers']>[0]): ReturnType<TestServerInterface['checkBrowsers']> { return { hasBrowsers: true } }
  async runGlobalSetup(_: Parameters<TestServerInterface['runGlobalSetup']>[0]): ReturnType<TestServerInterface['runGlobalSetup']> { return { report: [], status: 'passed' } }
  async runGlobalTeardown(_: Parameters<TestServerInterface['runGlobalTeardown']>[0]): ReturnType<TestServerInterface['runGlobalTeardown']> { return { report: [], status: 'passed' } }
  
  async listTests(_: Parameters<TestServerInterface['listTests']>[0]): ReturnType<TestServerInterface['listTests']> {
    const [crxApp, fs] = await Promise.all([this._crxAppPromise, this._virtualFsPromise]);
    const report = fs ? [
      ...await readReport(crxApp, fs),
      { method: 'onBegin', params: {} },
      { method: 'onEnd', params: { result: { status: 'passed', startTime: new Date().getTime(), duration: 0 } } },
    ] : [];
    return { report, status: 'passed' };
  }

  async runTests({ testIds }: Parameters<TestServerInterface['runTests']>[0]): ReturnType<TestServerInterface['runTests']> {
    const [crxApp, fs] = await Promise.all([this._crxAppPromise, this._virtualFsPromise]);
    if (!fs || !crxApp)
      return { status: 'failed' };

    const report = await readReport(crxApp, fs);
    const project = report?.find(e => e.method === 'onProject')?.params.project;
    if (!project)
      return { status: 'passed' }; 

    const testsCases = project.suites.flatMap(s => s.entries)
      .filter(e => testIds?.includes((e as JsonTestCase).testId) && e.location)
      .map(e => e as JsonTestCase);

    for (const reportEntry of report)
      this.dispatchEvent('report', reportEntry);

    const testRunner = new TestRunner(crxApp, fs, reportEntry => this.dispatchEvent('report', reportEntry));     
    await testRunner.runTests(testsCases);

    return { status: 'passed' };
  }

  async changeProject(): Promise<void> {
    await releaseVirtualFs('ui-mode.project-dir');
    this._virtualFsPromise = undefined;
    await this.initialize();
  }

  async saveScript(params: { code: string, language: Language, suggestedName?: string, path?: string }) {
    const fs = await this._virtualFsPromise;
    if (!fs)
      return;
    const path = params.path ?? this._currentSourceLocation?.file;
    if (!path)
      return;
    await fs.writeFile(path, params.code);
  }
  
  async saveStorageState() {
    const crxApp = await this._crxAppPromise;
    const { cookies: allCookies, origins } = await crxApp.context().storageState();
    const urls = Array.from(new Set(crxApp.pages().flatMap(p => [p.url(), ...p.frames().map(f => f.url())])));
    const cookies = filterCookies(allCookies, urls);
    const storageState = { cookies, origins };
  
    const handle = await saveFile({
      params: {
        types: [{
          accept: { 'application/json': ['.json'] },
        }],
        suggestedName: 'storageState.json',
      }
    });
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(storageState));
      await writable.close();
    }
  }

  async openUiMode() {
    await chrome.windows.create({ url: chrome.runtime.getURL('uiMode.html'), type: 'popup', focused: false });
  }

  async sourceLocationChanged(params: { sourceLocation?: SourceLocation }) {
    this._currentSourceLocation = params.sourceLocation;
    
    const file = params.sourceLocation?.file;
    if (!file || !this._virtualFsPromise)
      return;

    const [crxApp, fs] = await Promise.all([this._crxAppPromise, this._virtualFsPromise]);
    const content = await fs.readFile(file, { encoding: 'utf-8' });
    await crxApp.recorder.load(content);
  }
}
