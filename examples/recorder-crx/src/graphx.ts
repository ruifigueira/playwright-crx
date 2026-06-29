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

// Real GraphX integration via the Contineo recorder bridge.
//
// All operations go through a single endpoint:
//   POST https://test-automation.contineonx.com/api/recorder
// The body shape determines the operation:
//   - list suites: { graphxUrl, username, password }
//   - save existing: { graphxUrl, username, password, serverId, serverName,
//                      suiteId, testcaseName, language, codePreview }
//   - save new:     { graphxUrl, username, password, serverId, serverName,
//                      suiteName, testcaseName, language, codePreview }
//
// `codePreview` carries the FULL recorded script (the name is historical;
// the wire field is misleadingly singular).
//
// host_permissions for this origin is declared in manifest.json — required
// for the extension popup to POST here under MV3.

export type PlaywrightServer = {
  id: string;
  name: string;
  url: string;
};

export type GraphxSuite = {
  id: number;
  name: string;
};

export type SaveScriptParams = {
  serverId: string;
  username: string;
  password: string;
  suiteId?: number;
  newSuiteName?: string;
  testcaseName: string;
  code: string;
  language: string;
};

export type SaveScriptResult = {
  scriptId: string;
  serverId: string;
  serverName: string;
  suiteId: number | null;
  suiteName: string;
};

const RECORDER_API_URL = 'https://test-automation.contineonx.com/api/recorder';
// const RECORDER_API_URL = 'http://localhost:3000/api/recorder';

// GraphX environments the user can target. The recorder bridge accepts an
// arbitrary `graphxUrl`, so this list is a UX convenience — extend it or
// load it from preferences if needed.
const SERVERS: PlaywrightServer[] = [
  { id: 'local', name: 'Local', url: 'http://localhost:3000' },
  { id: 'dev', name: 'Dev', url: 'https://dev.graphx.world' },
  { id: 'test', name: 'Test', url: 'https://test.graphx.world' },
  { id: 'production', name: 'Production', url: 'https://graphx.world' },
];

function resolveServer(serverId: string): PlaywrightServer {
  const server = SERVERS.find(s => s.id === serverId);
  if (!server)
    throw new Error(`Unknown Playwright server: ${serverId}`);
  return server;
}

async function callRecorder(body: Record<string, unknown>): Promise<any> {
  // eslint-disable-next-line no-console
  console.log('[GraphX] POST', RECORDER_API_URL, { ...body, password: body.password ? '***' : undefined });
  const response = await fetch(RECORDER_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Recorder API ${response.status}${detail ? `: ${detail}` : ` ${response.statusText}`}`);
  }
  return response.json();
}

export async function listServers(): Promise<PlaywrightServer[]> {
  return SERVERS.slice();
}

export async function listSuites(serverId: string, credentials: { username: string; password: string }): Promise<GraphxSuite[]> {
  if (!credentials.username || !credentials.password)
    throw new Error('Credentials are required to list suites.');

  const server = resolveServer(serverId);
  const data = await callRecorder({
    graphxUrl: server.url,
    username: credentials.username,
    password: credentials.password,
  });

  // The recorder bridge's response shape isn't pinned down — be defensive.
  const raw: any[] = Array.isArray(data) ? data : (data?.data?.graphxResponse?.result?.data ?? data?.data?.graphxResponse?.result?.data ?? []);
  return raw
      .map(s => ({ id: Number(s.id), name: String(s.label ?? s.label ?? '') }))
      .filter(s => Number.isFinite(s.id) && s.name);
}

export async function saveScript(params: SaveScriptParams): Promise<SaveScriptResult> {
  if (params.suiteId === undefined && !params.newSuiteName)
    throw new Error('Either suiteId or newSuiteName must be provided.');
  if (!params.testcaseName)
    throw new Error('Testcase name is required.');
  if (!params.username || !params.password)
    throw new Error('GraphX username and password are required.');

  const server = resolveServer(params.serverId);
  const baseBody: Record<string, unknown> = {
    graphxUrl: server.url,
    username: params.username,
    password: params.password,
    serverId: server.id,
    serverName: server.name,
    testcaseName: params.testcaseName,
    language: params.language,
    codePreview: params.code,
  };
  const body = params.suiteId !== undefined
    ? { ...baseBody, suiteId: params.suiteId }
    : { ...baseBody, suiteName: params.newSuiteName };

  const data = await callRecorder(body);

  const returnedSuiteId = Number(data?.suiteId ?? params.suiteId ?? NaN);
  return {
    scriptId: String(data?.scriptId ?? data?.id ?? ''),
    serverId: server.id,
    serverName: server.name,
    suiteId: Number.isFinite(returnedSuiteId) ? returnedSuiteId : null,
    suiteName: String(data?.suiteName ?? params.newSuiteName ?? ''),
  };
}
