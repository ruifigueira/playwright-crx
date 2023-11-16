/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'path';
import fs from 'fs';
import { HttpServer } from '../../../utils/httpServer';
import { createGuid, gracefullyProcessExitDoNotHang, isUnderTest } from '../../../utils';
import { syncLocalStorageWithSettings } from '../../launchApp';
import { serverSideCallMetadata } from '../../instrumentation';
import { createPlaywright } from '../../playwright';
import { ProgressController } from '../../progress';
import { open, wsServer } from '../../../utilsBundle';
import type { Page } from '../../page';
import type { BrowserType } from '../../browserType';
import { launchApp } from '../../launchApp';

export type Transport = {
  sendEvent?: (method: string, params: any) => void;
  dispatch: (method: string, params: any) => Promise<any>;
  close?: () => void;
  onclose: () => void;
};

export type OpenTraceViewerOptions = {
  app?: string;
  headless?: boolean;
  host?: string;
  port?: number;
  isServer?: boolean;
  transport?: Transport;
  persistentContextOptions?: Parameters<BrowserType['launchPersistentContext']>[2];
};

async function startTraceViewerServer(traceUrls: string[], options?: OpenTraceViewerOptions): Promise<{ server: HttpServer, url: string }> {
  for (const traceUrl of traceUrls) {
    let traceFile = traceUrl;
    // If .json is requested, we'll synthesize it.
    if (traceUrl.endsWith('.json'))
      traceFile = traceUrl.substring(0, traceUrl.length - '.json'.length);

    if (!traceUrl.startsWith('http://') && !traceUrl.startsWith('https://') && !fs.existsSync(traceFile) && !fs.existsSync(traceFile + '.trace')) {
      // eslint-disable-next-line no-console
      console.error(`Trace file ${traceUrl} does not exist!`);
      gracefullyProcessExitDoNotHang(1);
    }
  }

  const server = new HttpServer();
  server.routePrefix('/trace', (request, response) => {
    const url = new URL('http://localhost' + request.url!);
    const relativePath = url.pathname.slice('/trace'.length);
    if (relativePath.endsWith('/stall.js'))
      return true;
    if (relativePath.startsWith('/file')) {
      try {
        const filePath = url.searchParams.get('path')!;
        if (fs.existsSync(filePath))
          return server.serveFile(request, response, url.searchParams.get('path')!);

        // If .json is requested, we'll synthesize it for zip-less operation.
        if (filePath.endsWith('.json')) {
          const traceName = filePath.substring(0, filePath.length - '.json'.length);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(traceDescriptor(traceName)));
          return true;
        }
      } catch (e) {
      }
      response.statusCode = 404;
      response.end();
      return true;
    }
    const absolutePath = path.join(__dirname, '..', '..', '..', 'vite', 'traceViewer', ...relativePath.split('/'));
    return server.serveFile(request, response, absolutePath);
  });

  const params = traceUrls.map(t => `trace=${encodeURIComponent(t)}`);
  const transport = options?.transport || (options?.isServer ? new StdinServer() : undefined);

  if (transport) {
    const guid = createGuid();
    params.push('ws=' + guid);
    const wss = new wsServer({ server: server.server(), path: '/' + guid });
    wss.on('connection', ws => {
      transport.sendEvent = (method, params)  => ws.send(JSON.stringify({ method, params }));
      transport.close = () => ws.close();
      ws.on('message', async (message: string) => {
        const { id, method, params } = JSON.parse(message);
        const result = await transport.dispatch(method, params);
        ws.send(JSON.stringify({ id, result }));
      });
      ws.on('close', () => transport.onclose());
      ws.on('error', () => transport.onclose());
    });
  }

  if (options?.isServer)
    params.push('isServer');
  if (isUnderTest())
    params.push('isUnderTest=true');

  const { host, port } = options || {};
  const url = await server.start({ preferredPort: port, host });
  const { app } = options || {};
  const searchQuery = params.length ? '?' + params.join('&') : '';
  const urlPath  = `/trace/${app || 'index.html'}${searchQuery}`;

  server.routePath('/', (request, response) => {
    response.statusCode = 302;
    response.setHeader('Location', urlPath + request.url!.substring(1));
    response.end();
    return true;
  });

  return { server, url };
}

export async function openTraceViewerApp(traceUrls: string[], browserName: string, options?: OpenTraceViewerOptions): Promise<Page> {
  const { url } = await startTraceViewerServer(traceUrls, options);
  const traceViewerPlaywright = createPlaywright({ sdkLanguage: 'javascript', isInternalPlaywright: true });
  const traceViewerBrowser = isUnderTest() ? 'chromium' : browserName;

  const { context, page } = await launchApp(traceViewerPlaywright[traceViewerBrowser as 'chromium'], {
    // TODO: store language in the trace.
    sdkLanguage: traceViewerPlaywright.options.sdkLanguage,
    windowSize: { width: 1280, height: 800 },
    persistentContextOptions: {
      ...options?.persistentContextOptions,
      useWebSocket: isUnderTest(),
      headless: options?.headless,
    },
  });

  const controller = new ProgressController(serverSideCallMetadata(), context._browser);
  await controller.run(async progress => {
    await context._browser._defaultContext!._loadDefaultContextAsIs(progress);
  });

  if (process.env.PWTEST_PRINT_WS_ENDPOINT)
    process.stderr.write('DevTools listening on: ' + context._browser.options.wsEndpoint + '\n');

  if (!isUnderTest())
    await syncLocalStorageWithSettings(page, 'traceviewer');

  if (isUnderTest())
    page.on('close', () => context.close({ reason: 'Trace viewer closed' }).catch(() => {}));

  await page.mainFrame().goto(serverSideCallMetadata(), url);
  return page;
}

export async function openTraceInBrowser(traceUrls: string[], options?: OpenTraceViewerOptions) {
  const { url } = await startTraceViewerServer(traceUrls, options);
  // eslint-disable-next-line no-console
  console.log('\nListening on ' + url);
  if (!isUnderTest())
    await open(url).catch(() => {});
}

class StdinServer implements Transport {
  private _pollTimer: NodeJS.Timeout | undefined;
  private _traceUrl: string | undefined;

  constructor() {
    process.stdin.on('data', data => {
      const url = data.toString().trim();
      if (url === this._traceUrl)
        return;
      if (url.endsWith('.json'))
        this._pollLoadTrace(url);
      else
        this._loadTrace(url);
    });
    process.stdin.on('close', () => gracefullyProcessExitDoNotHang(0));
  }

  async dispatch(method: string, params: any) {
    if (method === 'ready') {
      if (this._traceUrl)
        this._loadTrace(this._traceUrl);
    }
  }

  onclose() {
    gracefullyProcessExitDoNotHang(0);
  }

  sendEvent?: (method: string, params: any) => void;
  close?: () => void;

  private _loadTrace(url: string) {
    this._traceUrl = url;
    clearTimeout(this._pollTimer);
    this.sendEvent?.('loadTrace', { url });
  }

  private _pollLoadTrace(url: string) {
    this._loadTrace(url);
    this._pollTimer = setTimeout(() => {
      this._pollLoadTrace(url);
    }, 500);
  }
}

function traceDescriptor(traceName: string) {
  const result: { entries: { name: string, path: string }[] } = {
    entries: []
  };

  const traceDir = path.dirname(traceName);
  const traceFile = path.basename(traceName);
  for (const name of fs.readdirSync(traceDir)) {
    if (name.startsWith(traceFile))
      result.entries.push({ name, path: path.join(traceDir, name) });
  }

  const resourcesDir = path.join(traceDir, 'resources');
  if (fs.existsSync(resourcesDir)) {
    for (const name of fs.readdirSync(resourcesDir))
      result.entries.push({ name: 'resources/' + name, path: path.join(resourcesDir, name) });
  }
  return result;
}
