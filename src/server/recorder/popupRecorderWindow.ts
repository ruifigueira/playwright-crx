/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { RecorderEventData, RecorderMessage, RecorderWindow } from "./crxRecorderApp";

export class PopupRecorderWindow implements RecorderWindow {
  private _recorderUrl: string;
  private _window?: chrome.windows.Window;
  private id?: number;
  private _portPromise?: Promise<chrome.runtime.Port>;
  onMessage?: ({ type, event, params }: RecorderEventData) => void; 
  hideApp?: () => any;

  constructor(recorderUrl?: string) {
    this._recorderUrl = recorderUrl ?? 'index.html';
    chrome.windows.onRemoved.addListener(window => {
      if (this._window?.id === window)
        this.close().catch(() => {});
    });
  }
  
  isClosed() {
    return !this._window;
  }

  postMessage(msg: RecorderMessage) {
    this._portPromise?.then(port => port.postMessage({ ...msg })).catch(() => {});
  }

  async open() {
    if (this._window)
      return;
    this._portPromise = new Promise<chrome.runtime.Port>(resolve => {
      const onConnect = (port: chrome.runtime.Port) => {
        chrome.runtime.onConnect.removeListener(onConnect);
        port.onDisconnect.addListener(this.close.bind(this));
        if (this.onMessage)
          port.onMessage.addListener(this.onMessage);
        resolve(port);
      };
      chrome.runtime.onConnect.addListener(onConnect);
    });
    const [wnd] = await Promise.all([
      chrome.windows.create({ type: 'popup', url: this._recorderUrl }),
      this._portPromise,
    ]);
    this._window = wnd;
  }
  
  async focus() {
    await chrome.windows.update(this.id!, { drawAttention: true, focused: true });
  }

  async close() {
    if (!this._portPromise)
      return;
    
    this.hideApp?.();
    
    if (this._window?.id) chrome.windows.remove(this._window.id).catch(() => {});
    this._portPromise?.then(port => port.disconnect()).catch(() => {});
    this._window = undefined;
    this._portPromise = undefined;
  };
}
