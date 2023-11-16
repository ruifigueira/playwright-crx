/**
 * Copyright (c) Microsoft Corporation.
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

import { wsServer } from '../utilsBundle';
import type { WebSocketServer } from '../utilsBundle';
import type http from 'http';
import type { Browser } from '../server/browser';
import type { Playwright } from '../server/playwright';
import { createPlaywright } from '../server/playwright';
import { PlaywrightConnection } from './playwrightConnection';
import type { ClientType } from './playwrightConnection';
import type  { LaunchOptions } from '../server/types';
import { ManualPromise } from '../utils/manualPromise';
import type { AndroidDevice } from '../server/android/android';
import type { SocksProxy } from '../common/socksProxy';
import { debugLogger } from '../common/debugLogger';
import { createHttpServer, userAgentVersionMatchesErrorMessage } from '../utils';
import { perMessageDeflate } from '../server/transport';

let lastConnectionId = 0;
const kConnectionSymbol = Symbol('kConnection');

type ServerOptions = {
  path: string;
  maxConnections: number;
  mode: 'default' | 'launchServer' | 'extension';
  preLaunchedBrowser?: Browser;
  preLaunchedAndroidDevice?: AndroidDevice;
  preLaunchedSocksProxy?: SocksProxy;
};

export class PlaywrightServer {
  private _preLaunchedPlaywright: Playwright | undefined;
  private _wsServer: WebSocketServer | undefined;
  private _server: http.Server | undefined;
  private _options: ServerOptions;

  constructor(options: ServerOptions) {
    this._options = options;
    if (options.preLaunchedBrowser)
      this._preLaunchedPlaywright = options.preLaunchedBrowser.attribution.playwright;
    if (options.preLaunchedAndroidDevice)
      this._preLaunchedPlaywright = options.preLaunchedAndroidDevice._android.attribution.playwright;
  }

  async listen(port: number = 0): Promise<string> {
    debugLogger.log('server', `Server started at ${new Date()}`);

    const server = createHttpServer((request: http.IncomingMessage, response: http.ServerResponse) => {
      if (request.method === 'GET' && request.url === '/json') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          wsEndpointPath: this._options.path,
        }));
        return;
      }
      response.end('Running');
    });
    server.on('error', error => debugLogger.log('server', String(error)));
    this._server = server;

    const wsEndpoint = await new Promise<string>((resolve, reject) => {
      server.listen(port, () => {
        const address = server.address();
        if (!address) {
          reject(new Error('Could not bind server socket'));
          return;
        }
        const wsEndpoint = typeof address === 'string' ? `${address}${this._options.path}` : `ws://127.0.0.1:${address.port}${this._options.path}`;
        resolve(wsEndpoint);
      }).on('error', reject);
    });

    debugLogger.log('server', 'Listening at ' + wsEndpoint);
    this._wsServer = new wsServer({
      noServer: true,
      perMessageDeflate,
    });
    const browserSemaphore = new Semaphore(this._options.maxConnections);
    const controllerSemaphore = new Semaphore(1);
    const reuseBrowserSemaphore = new Semaphore(1);
    if (process.env.PWTEST_SERVER_WS_HEADERS) {
      this._wsServer.on('headers', (headers, request) => {
        headers.push(process.env.PWTEST_SERVER_WS_HEADERS!);
      });
    }
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL('http://localhost' + request.url!).pathname;
      if (pathname !== this._options.path) {
        socket.write(`HTTP/${request.httpVersion} 400 Bad Request\r\n\r\n`);
        socket.destroy();
        return;
      }

      const uaError = userAgentVersionMatchesErrorMessage(request.headers['user-agent'] || '');
      if (uaError) {
        socket.write(`HTTP/${request.httpVersion} 428 Precondition Required\r\n\r\n${uaError}`);
        socket.destroy();
        return;
      }

      this._wsServer?.handleUpgrade(request, socket, head, ws => this._wsServer?.emit('connection', ws, request));
    });
    this._wsServer.on('connection', (ws, request) => {
      debugLogger.log('server', 'Connected client ws.extension=' + ws.extensions);
      const url = new URL('http://localhost' + (request.url || ''));
      const browserHeader = request.headers['x-playwright-browser'];
      const browserName = url.searchParams.get('browser') || (Array.isArray(browserHeader) ? browserHeader[0] : browserHeader) || null;
      const proxyHeader = request.headers['x-playwright-proxy'];
      const proxyValue = url.searchParams.get('proxy') || (Array.isArray(proxyHeader) ? proxyHeader[0] : proxyHeader);

      const launchOptionsHeader = request.headers['x-playwright-launch-options'] || '';
      const launchOptionsHeaderValue = Array.isArray(launchOptionsHeader) ? launchOptionsHeader[0] : launchOptionsHeader;
      const launchOptionsParam = url.searchParams.get('launch-options');
      let launchOptions: LaunchOptions = {};
      try {
        launchOptions = JSON.parse(launchOptionsParam || launchOptionsHeaderValue);
      } catch (e) {
      }

      const id = String(++lastConnectionId);
      debugLogger.log('server', `[${id}] serving connection: ${request.url}`);

      // Instantiate playwright for the extension modes.
      const isExtension = this._options.mode === 'extension';
      if (isExtension) {
        if (!this._preLaunchedPlaywright)
          this._preLaunchedPlaywright = createPlaywright({ sdkLanguage: 'javascript', isServer: true });
      }

      let clientType: ClientType = 'launch-browser';
      let semaphore: Semaphore = browserSemaphore;
      if (isExtension && url.searchParams.has('debug-controller')) {
        clientType = 'controller';
        semaphore = controllerSemaphore;
      } else if (isExtension) {
        clientType = 'reuse-browser';
        semaphore = reuseBrowserSemaphore;
      } else if (this._options.mode === 'launchServer') {
        clientType = 'pre-launched-browser-or-android';
        semaphore = browserSemaphore;
      }

      const connection = new PlaywrightConnection(
          semaphore.acquire(),
          clientType, ws,
          { socksProxyPattern: proxyValue, browserName, launchOptions },
          {
            playwright: this._preLaunchedPlaywright,
            browser: this._options.preLaunchedBrowser,
            androidDevice: this._options.preLaunchedAndroidDevice,
            socksProxy: this._options.preLaunchedSocksProxy,
          },
          id, () => semaphore.release());
      (ws as any)[kConnectionSymbol] = connection;
    });

    return wsEndpoint;
  }

  async close() {
    const server = this._wsServer;
    if (!server)
      return;
    debugLogger.log('server', 'closing websocket server');
    const waitForClose = new Promise(f => server.close(f));
    // First disconnect all remaining clients.
    await Promise.all(Array.from(server.clients).map(async ws => {
      const connection = (ws as any)[kConnectionSymbol] as PlaywrightConnection | undefined;
      if (connection)
        await connection.close();
      try {
        ws.terminate();
      } catch (e) {
      }
    }));
    await waitForClose;
    debugLogger.log('server', 'closing http server');
    if (this._server)
      await new Promise(f => this._server!.close(f));
    this._wsServer = undefined;
    this._server = undefined;
    debugLogger.log('server', 'closed server');

    debugLogger.log('server', 'closing browsers');
    if (this._preLaunchedPlaywright)
      await Promise.all(this._preLaunchedPlaywright.allBrowsers().map(browser => browser.close({ reason: 'Playwright Server stopped' })));
    debugLogger.log('server', 'closed browsers');
  }
}

export class Semaphore {
  private _max: number;
  private _acquired = 0;
  private _queue: ManualPromise[] = [];

  constructor(max: number) {
    this._max = max;
  }

  setMax(max: number) {
    this._max = max;
  }

  acquire(): Promise<void> {
    const lock = new ManualPromise();
    this._queue.push(lock);
    this._flush();
    return lock;
  }

  release() {
    --this._acquired;
    this._flush();
  }

  private _flush() {
    while (this._acquired < this._max && this._queue.length) {
      ++this._acquired;
      this._queue.shift()!.resolve();
    }
  }
}
