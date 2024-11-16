import type { Language } from '@isomorphic/locatorGenerators';
import { TestServerConnection, type TestServerTransport } from '@testIsomorphic/testServerConnection';

export interface CrxTestServerExtension {
  saveScript(params: { code: string, language: Language; suggestedName: string }): Promise<void>;
  saveStorageState(): Promise<void>;
}

export class CrxTestServerConnection extends TestServerConnection implements CrxTestServerExtension {
  constructor() {
    const port = chrome.runtime.connect({ name: 'crx-test-server' });
    super(new CrxTestServerTransport(port));
  }

  async saveScript(params: { code: string; language: Language; suggestedName: string; }) {
    await this._sendMessage('saveScript', params);
  }

  async saveStorageState() {
    await this._sendMessage('saveStorageState');
  }
}

export class CrxTestServerTransport implements TestServerTransport {
  private _port: chrome.runtime.Port;

  constructor(port: chrome.runtime.Port) {
    this._port = port;
  }

  onmessage(listener: (message: string) => void) {
    this._port.onMessage.addListener(msg => listener(JSON.stringify(msg)));
  }

  onopen(listener: () => void) {
    Promise.resolve().then(() => listener());
  }

  onerror() {
    // nothing to do
  }

  onclose(listener: () => void) {
    this._port.onDisconnect.addListener(listener);
  }

  send(data: string) {
    this._port.postMessage(JSON.parse(data));
  }

  close() {
    this._port.disconnect();
  }
}
