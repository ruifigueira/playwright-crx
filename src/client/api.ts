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

// some types are commented out because they are not used in the extension
import {
  Accessibility,
  Browser,
  BrowserContext,
  BrowserType,
  Clock,
  ConsoleMessage,
  Coverage,
  Dialog,
  Download,
  // Electron,
  // ElectronApplication,
  Locator,
  FrameLocator,
  ElementHandle,
  FileChooser,
  TimeoutError,
  Frame,
  Keyboard,
  Mouse,
  Touchscreen,
  JSHandle,
  Route,
  WebSocket,
  WebSocketRoute,
  // APIRequest,
  // APIRequestContext,
  // APIResponse,
  Page,
  Selectors,
  Tracing,
  Video,
  Worker,
  CDPSession,
  Playwright,
  WebError,
} from 'playwright-core/lib/client/api';

import { zones } from 'playwright-core/lib/utils';

type ApiTypeMap = {
  'accessibility': Accessibility,
  // 'android': Android,
  // 'androidDevice': AndroidDevice,
  // 'androidWebView': AndroidWebView,
  // 'androidInput': AndroidInput,
  // 'androidSocket': AndroidSocket,
  'browser': Browser,
  'browserContext': BrowserContext,
  'browserType': BrowserType,
  'clock': Clock,
  'consoleMessage': ConsoleMessage,
  'coverage': Coverage,
  'dialog': Dialog,
  'download': Download,
  // 'electron': Electron,
  // 'electronApplication': ElectronApplication,
  'locator': Locator,
  'frameLocator': FrameLocator,
  'elementHandle': ElementHandle,
  'fileChooser': FileChooser,
  'timeoutError': TimeoutError,
  'frame': Frame,
  'keyboard': Keyboard,
  'mouse': Mouse,
  'touchscreen': Touchscreen,
  'jSHandle': JSHandle,
  'route': Route,
  'webSocket': WebSocket,
  'webSocketRoute': WebSocketRoute,
  // 'request': APIRequest,
  // 'requestContext': APIRequestContext,
  // 'response': APIResponse,
  'page': Page,
  'selectors': Selectors,
  'tracing': Tracing,
  'video': Video,
  'worker': Worker,
  'session': CDPSession,
  'playwright': Playwright,
  'webError': WebError,
};

type KeysOfAsyncMethods<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => Promise<any> ? (K extends `_${string}` ? never : K) : never;
}[Extract<keyof T, string>];

const apis: { [K in keyof ApiTypeMap]: [ApiTypeMap[K], ...Array<KeysOfAsyncMethods<ApiTypeMap[K]>>] } = {
  accessibility: [Accessibility.prototype, 'snapshot'],
  // android: [Android.prototype],
  // androidDevice: [AndroidDevice.prototype],
  // androidWebView: [AndroidWebView.prototype],
  // androidInput: [AndroidInput.prototype],
  // androidSocket: [AndroidSocket.prototype],
  browser: [Browser.prototype, 'newContext', 'newPage', 'newBrowserCDPSession', 'startTracing', 'stopTracing', 'close'],
  browserContext: [BrowserContext.prototype, 'newPage', 'cookies', 'addCookies', 'clearCookies', 'grantPermissions', 'clearPermissions', 'setGeolocation', 'setExtraHTTPHeaders', 'setOffline', 'setHTTPCredentials', 'addInitScript', 'exposeBinding', 'exposeFunction', 'route', 'routeWebSocket', 'routeFromHAR', 'unrouteAll', 'unroute', 'waitForEvent', 'storageState', 'newCDPSession', 'close'],
  browserType: [BrowserType.prototype, 'launch', 'launchServer', 'launchPersistentContext', 'connect', 'connectOverCDP', 'removeAllListeners'],
  clock: [Clock.prototype, 'install', 'fastForward', 'pauseAt', 'resume', 'runFor', 'setFixedTime', 'setSystemTime'],
  consoleMessage: [ConsoleMessage.prototype],
  coverage: [Coverage.prototype, 'startCSSCoverage', 'stopCSSCoverage', 'startJSCoverage', 'stopJSCoverage'],
  dialog: [Dialog.prototype, 'accept', 'dismiss'],
  download: [Download.prototype, 'path', 'failure', 'delete', 'saveAs'],
  // electron: [Electron.prototype],
  // electronApplication: [ElectronApplication.prototype],
  locator: [Locator.prototype, 'setInputFiles', 'inputValue', 'click', 'hover', 'check', 'uncheck', 'selectOption', 'fill', 'press', 'focus', 'type', 'press', 'scrollIntoViewIfNeeded', 'boundingBox', 'screenshot', 'textContent', 'innerText', 'innerHTML', 'getAttribute', 'hover', 'click', 'dblclick', 'selectOption', 'fill', 'type', 'press', 'check', 'uncheck', 'scrollIntoViewIfNeeded', 'boundingBox', 'screenshot', 'textContent', 'innerText', 'innerHTML', 'getAttribute'],
  frameLocator: [FrameLocator.prototype],
  elementHandle: [ElementHandle.prototype, 'ownerFrame', 'contentFrame', 'getAttribute', 'inputValue', 'textContent', 'innerText', 'innerHTML', 'isChecked', 'isDisabled', 'isEditable', 'isEnabled', 'isHidden', 'isVisible', 'dispatchEvent', 'scrollIntoViewIfNeeded', 'hover', 'click', 'dblclick', 'tap', 'selectOption', 'fill', 'selectText', 'setInputFiles', 'focus', 'type', 'press', 'check', 'uncheck', 'setChecked', 'boundingBox', 'screenshot', '$', '$$', '$eval', '$$eval', 'waitForElementState', 'waitForSelector'],
  fileChooser: [FileChooser.prototype, 'setFiles'],
  timeoutError: [TimeoutError.prototype],
  frame: [Frame.prototype, 'goto', 'waitForNavigation', 'waitForLoadState', 'waitForURL', 'frameElement', 'evaluateHandle', 'evaluate', '$', 'waitForSelector', 'dispatchEvent', '$eval', '$$', 'content', 'setContent', 'addScriptTag', 'addStyleTag', 'click', 'dblclick', 'dragAndDrop', 'tap', 'fill', 'focus', 'textContent', 'innerText', 'innerHTML', 'getAttribute', 'inputValue', 'isChecked', 'isDisabled', 'isEditable', 'isEnabled', 'isHidden', 'isVisible', 'hover', 'selectOption', 'setInputFiles', 'type', 'press', 'check', 'uncheck', 'setChecked', 'waitForTimeout', 'waitForFunction', 'title'],
  keyboard: [Keyboard.prototype, 'down', 'up', 'insertText', 'type', 'press'],
  mouse: [Mouse.prototype, 'click', 'dblclick', 'down', 'up', 'move', 'wheel'],
  touchscreen: [Touchscreen.prototype, 'tap'],
  jSHandle: [JSHandle.prototype, 'evaluate', 'evaluateHandle', 'getProperty', 'jsonValue', 'getProperties', 'dispose'],
  route: [Route.prototype, 'fallback', 'abort', 'fetch', 'fulfill', 'continue'],
  webSocket: [WebSocket.prototype, 'waitForEvent'],
  webSocketRoute: [WebSocketRoute.prototype, 'close'],
  // request: [APIRequest.prototype],
  // requestContext: [APIRequestContext.prototype],
  // response: [APIResponse.prototype],
  page: [Page.prototype, 'opener', '$', '$$', 'waitForSelector', 'dispatchEvent', 'evaluateHandle', '$eval', '$$eval', 'addScriptTag', 'addStyleTag', 'exposeFunction', 'exposeBinding', 'setExtraHTTPHeaders', 'content', 'setContent', 'goto', 'reload', 'addLocatorHandler', 'removeLocatorHandler', 'waitForLoadState', 'waitForNavigation', 'waitForURL', 'waitForRequest', 'waitForResponse', 'waitForEvent', 'goBack', 'goForward', 'requestGC', 'emulateMedia', 'setViewportSize', 'evaluate', 'addInitScript', 'route', 'routeFromHAR', 'routeWebSocket', 'unrouteAll', 'unroute', 'screenshot', 'title', 'bringToFront', 'close', 'click', 'dragAndDrop', 'dblclick', 'tap', 'fill', 'focus', 'textContent', 'innerText', 'innerHTML', 'getAttribute', 'inputValue', 'isChecked', 'isDisabled', 'isEditable', 'isEnabled', 'isHidden', 'isVisible', 'hover', 'selectOption', 'setInputFiles', 'type', 'press', 'check', 'uncheck', 'setChecked', 'waitForTimeout', 'waitForFunction', 'pause', 'pdf'],
  selectors: [Selectors.prototype, 'register'],
  tracing: [Tracing.prototype, 'group', 'groupEnd', 'removeAllListeners', 'start', 'startChunk', 'stop', 'stopChunk'],
  video: [Video.prototype, 'delete', 'path', 'saveAs'],
  worker: [Worker.prototype, 'evaluate', 'evaluateHandle'],
  session: [CDPSession.prototype, 'send', 'detach'],
  playwright: [Playwright.prototype],
  webError: [WebError.prototype],
};

for (const [typeName, [proto, ...props]] of Object.entries(apis)) {
  for (const key of props) {
    const originalFn = (proto as any)[key!];
    if (!originalFn || typeof originalFn !== 'function')
      throw new Error(`Method ${key} not found in ${typeName}`);

    (proto as any)[key!] = async function(...args: any[]) {
      const apiName = zones.zoneData<{ apiName: string }>('crxZone');
      if (apiName)
        return await originalFn.apply(this, args);
      return await zones.run('crxZone', { apiName: `${typeName}.${key}` }, async () => await originalFn.apply(this, args));
    };
  }
}