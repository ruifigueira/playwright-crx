import type { Language } from "@isomorphic/locatorGenerators";
import { TestServerInterface } from "@testIsomorphic/testServerInterface";
import type { CrxApplication } from "playwright-crx/test";
import { filterCookies } from "../utils/network";
import { readReport } from "../utils/project";
import { requestVirtualFs, saveFile, VirtualFs } from "../utils/virtualFs";
import { CrxTestServerExtension } from "./crxTestServerTransport";

export class CrxTestServerDispatcher implements Partial<TestServerInterface>, CrxTestServerExtension {
  private _crxAppPromise: Promise<CrxApplication>;
  private _virtualFsPromise: Promise<VirtualFs> | undefined;

  constructor(crxAppPromise: Promise<CrxApplication>, port: chrome.runtime.Port) {
    this._crxAppPromise = crxAppPromise;
    port.onMessage.addListener(async ({ id, method, params }) => {
      try {
        const result = await (this as any)[method]?.(params);
        port.postMessage({ id, method, params, result });
      } catch (error) {
        port.postMessage({ id, method, params, error });
      }
    });
  }

  async initialize() {
    this._virtualFsPromise = requestVirtualFs(await this._crxAppPromise, 'ui-mode.project-dir', 'readwrite');
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

    await saveFile(await this._crxAppPromise, {
      params: {
        types: acceptTypes,
        body: params.code,
        suggestedName: params.suggestedName,
      }
    });
  }
  
  async saveStorageState() {
    const crxApp = await this._crxAppPromise;
    const { cookies: allCookies, origins } = await crxApp.context().storageState();
    const urls = Array.from(new Set(crxApp.pages().flatMap(p => [p.url(), ...p.frames().map(f => f.url())])));
    const cookies = filterCookies(allCookies, urls);
    const storageState = { cookies, origins };
  
    await saveFile(crxApp, {
      params: {
        types: [{
          accept: { 'application/json': ['.json'] },
        }],
        body: JSON.stringify(storageState, undefined, 2),
        suggestedName: 'storageState.json',
      }
    });
  }

  async openUiMode() {
    await chrome.windows.create({ url: chrome.runtime.getURL('uiMode.html') });
  }
}
