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

import { ConnectionTransport, ProtocolRequest, ProtocolResponse } from '../../transport';
import { chunksToMessage, messageToChunks } from './chunking';
import type { Fetcher } from '@cloudflare/workers-types';

interface AcquireResponse {
  sessionId: string;
}

type BrowserWorker = Fetcher;

interface WorkersLaunchOptions {
  keepAlive?: number; // milliseconds to keep browser alive even if it has no activity (from 10_000ms to 600_000ms, default is 60_000)
  sessionId?: string;
}

declare global {
  interface Response {
    readonly webSocket: WebSocket | null;
  }
  interface WebSocket {
    accept(): void;
  }
}

const FAKE_HOST = 'https://fake.host';

export class WorkersWebSocketTransport implements ConnectionTransport {
  ws: WebSocket;
  pingInterval: NodeJS.Timer;
  chunks: Uint8Array[] = [];
  onmessage?: (message: ProtocolResponse) => void;
  onclose?: () => void;
  sessionId: string;

  static async create(
    endpoint: BrowserWorker,
    options?: WorkersLaunchOptions
  ): Promise<WorkersWebSocketTransport> {
    const sessionId = options?.sessionId ?? await connect(endpoint, options);
    const path = `${FAKE_HOST}/v1/connectDevtools?browser_session=${sessionId}`;
    const response = await endpoint.fetch(path, {
      headers: {
        Upgrade: 'websocket'
      },
    });
    response.webSocket!.accept();
    return new WorkersWebSocketTransport(response.webSocket!, sessionId);
  }

  constructor(ws: WebSocket, sessionId: string) {
    this.pingInterval = setInterval(() => {
      return this.ws.send('ping');
    }, 1000); // TODO more investigation
    this.ws = ws;
    this.sessionId = sessionId;
    this.ws.addEventListener('message', event => {
      this.chunks.push(new Uint8Array(event.data as ArrayBuffer));
      const message = chunksToMessage(this.chunks, sessionId);
      if (message && this.onmessage)
        this.onmessage!(JSON.parse(message) as ProtocolResponse);
    });
    this.ws.addEventListener('close', () => {
      clearInterval(this.pingInterval as NodeJS.Timeout);
      if (this.onclose)
        this.onclose();
    });
    this.ws.addEventListener('error', e => {
      // eslint-disable-next-line no-console
      console.error(`Websocket error: SessionID: ${sessionId}`, e);
      clearInterval(this.pingInterval as NodeJS.Timeout);
    });
  }

  send(message: ProtocolRequest): void {
    for (const chunk of messageToChunks(JSON.stringify(message)))
      this.ws.send(chunk);
  }

  close(): void {
    clearInterval(this.pingInterval as NodeJS.Timeout);
    this.ws.close();
    this.onclose?.();
  }

  async closeAndWait() {
    if (this.ws.readyState === WebSocket.CLOSED)
      return;
    const promise = new Promise((f: any) => this.ws.onclose?.(f));
    this.close();
    await promise; // Make sure to await the actual disconnect.
  }

  toString(): string {
    return this.sessionId;
  }
}

async function connect(endpoint: BrowserWorker, options?: WorkersLaunchOptions) {
  let acquireUrl = `${FAKE_HOST}/v1/acquire`;
  if (options?.keepAlive) {
    acquireUrl = `${acquireUrl}?keep_alive=${options.keepAlive}`;
  }
  const res = await endpoint.fetch(acquireUrl);
  const status = res.status;
  const text = await res.text();
  if (status !== 200) {
    throw new Error(
      `Unable to create new browser: code: ${status}: message: ${text}`
    );
  }
  // Got a 200, so response text is actually an AcquireResponse
  const response: AcquireResponse = JSON.parse(text);
  return response.sessionId;
}
