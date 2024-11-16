import type { CrxApplication } from "playwright-crx/test";
import { CrxTestServerExtension } from "./crxTestServerTransport";
import type { NetworkCookie } from "@protocol/channels";
import { saveFile } from "./virtualFs";
import type { Language } from "@isomorphic/locatorGenerators";

export class CrxTestServerDispatcher implements CrxTestServerExtension {
  private _crxApp: CrxApplication;

  constructor(crxApp: CrxApplication) {
    this._crxApp = crxApp;
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
    };

    await saveFile(this._crxApp, {
      params: {
        types: acceptTypes,
        body: params.code,
        suggestedName: params.suggestedName,
      }
    });
  }
  
  async saveStorageState() {
    const crxApp = this._crxApp;
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
}

// borrowed from playwright/packages/playwright-core/src/server/network.ts
function filterCookies(cookies: NetworkCookie[], urls: string[]): NetworkCookie[] {
  const parsedURLs = urls.map(s => new URL(s));
  // Chromiums's cookies are missing sameSite when it is 'None'
  return cookies.filter(c => {
    if (!parsedURLs.length)
      return true;
    for (const parsedURL of parsedURLs) {
      let domain = c.domain;
      if (!domain.startsWith('.'))
        domain = '.' + domain;
      if (!('.' + parsedURL.hostname).endsWith(domain))
        continue;
      if (!parsedURL.pathname.startsWith(c.path))
        continue;
      if (parsedURL.protocol !== 'https:' && parsedURL.hostname !== 'localhost' && c.secure)
        continue;
      return true;
    }
    return false;
  });
}