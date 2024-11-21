import type { Language } from "@isomorphic/locatorGenerators";
import type { TestServerInterface } from "@testIsomorphic/testServerInterface";
import type { CrxApplication } from "playwright-crx/test";
import { filterCookies } from "../utils/network";
import { ExtendedProjectVirtualFs, readReport } from "../utils/project";
import { requestVirtualFs, saveFile, VirtualFs } from "../utils/virtualFs";
import { CrxTestServerExtension } from "./crxTestServerTransport";
import { SourceLocation } from "@trace-viewer/ui/modelUtil";

export class CrxTestServerDispatcher implements Partial<TestServerInterface>, CrxTestServerExtension {
  private _crxAppPromise: Promise<CrxApplication>;
  private _virtualFsPromise: Promise<VirtualFs> | undefined;

  private _ports: Set<chrome.runtime.Port> = new Set();

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
        port.postMessage({ id, method, params, error });
      }
    });
    port.onDisconnect.addListener(() => this._ports.delete(port));
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
    const virtualFs = await this._virtualFsPromise;
    const report = virtualFs ? await readReport(virtualFs) : [];
    return { report, status: 'passed' };
  }

  async saveScript(params: { code: string, language: Language, suggestedName: string }) {
    let acceptTypes: FilePickerAcceptType[] = []; 
    switch (params.language) {
      case 'javascript': acceptTypes = [
        { description: 'Typescript file', accept: { 'text/x-typescript': ['.ts'] } },
        { description: 'Javascript file', accept: { 'application/javascript': ['.js'] } },
      ]; break;
      case 'java': acceptTypes = [{ description: 'Java file', accept: { 'text/x-java-source': ['.java'] } }]; break;
      case 'python': acceptTypes = [{ description: 'Python file', accept: { 'text/x-python': ['.py'] } }]; break;
      case 'csharp': acceptTypes = [{ description: 'C# file', accept: { 'text/x-csharp': ['.cs'] } }]; break;
      case 'jsonl': acceptTypes = [{ description: 'JSON Lines file', accept: { 'text/jsonl': ['.jsonl'] } }]; break;
    };

    const handle = await saveFile({
      params: {
        types: acceptTypes,
        suggestedName: params.suggestedName,
      }
    });
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(params.code);
      await writable.close();
    }
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
    await chrome.windows.create({ url: chrome.runtime.getURL('uiMode.html') });
  }

  async sourceLocationChanged(params: { sourceLocation: SourceLocation }) {
    const file = params.sourceLocation.file;
    if (!file || !this._virtualFsPromise)
      return;

    const [crxApp, fs] = await Promise.all([this._crxAppPromise, this._virtualFsPromise]);
    const content = await fs.readFile(file, { encoding: 'utf-8' });
    await crxApp.recorder.reset(content);
  }
}
