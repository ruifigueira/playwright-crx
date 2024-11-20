import type { Language } from '@isomorphic/locatorGenerators';
import { TestServerConnection, type TestServerTransport } from '@testIsomorphic/testServerConnection';
import * as events from '@testIsomorphic/events';
import { SourceLocation } from '@trace-viewer/ui/modelUtil';

export interface CrxTestServerExtension {
  saveScript(params: { code: string, language: Language; suggestedName: string }): Promise<void>;
  saveStorageState(): Promise<void>;
  openUiMode(): Promise<void>;
}

export class CrxTestServerConnection extends TestServerConnection implements CrxTestServerExtension {
  readonly onItemSelected: events.Event<SourceLocation>;

  private _onItemSelectedEmitter = new events.EventEmitter<SourceLocation>();

  constructor() {
    const port = chrome.runtime.connect({ name: 'crx-test-server' });
    super(new CrxTestServerTransport(port));
    this.onItemSelected = this._onItemSelectedEmitter.event;
  }

  protected _dispatchEvent(method: string, params?: any) {
    if (method === 'itemSelected')
      this._onItemSelectedEmitter.fire(params);
    else
      super._dispatchEvent(method, params);
  }

  async saveScript(params: { code: string; language: Language; suggestedName: string; }) {
    await this._sendMessage('saveScript', params);
  }

  async saveStorageState() {
    await this._sendMessage('saveStorageState');
  }

  async openUiMode() {
    await this._sendMessage('openUiMode');
  }

  itemSelectedNoReply(location?: SourceLocation) {
    this._sendMessageNoReply('itemSelected', { location});
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
