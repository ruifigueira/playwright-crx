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

import './shims/global';

import './protocol/validator';

import { DispatcherConnection, RootDispatcher } from 'playwright-core/lib/server';
import { CrxConnection } from './client/crxConnection';
import type { CrxPlaywright as CrxPlaywrightAPI } from './client/crxPlaywright';
import { CrxPlaywright } from './server/crxPlaywright';
import { CrxPlaywrightDispatcher } from './server/dispatchers/crxPlaywrightDispatcher';

export { debug as _debug } from 'debug';
export { setUnderTest as _setUnderTest } from 'playwright-core/lib/utils';

const playwright = new CrxPlaywright();

const clientConnection = new CrxConnection();
const dispatcherConnection = new DispatcherConnection(true /* local */);

// Dispatch synchronously at first.
dispatcherConnection.onmessage = message => clientConnection.dispatch(message);
clientConnection.onmessage = message => dispatcherConnection.dispatch(message);

const rootScope = new RootDispatcher(dispatcherConnection);

// Initialize Playwright channel.
new CrxPlaywrightDispatcher(rootScope, playwright);
const playwrightAPI = clientConnection.getObjectWithKnownName('Playwright') as CrxPlaywrightAPI;

// Switch to async dispatch after we got Playwright object.
dispatcherConnection.onmessage = message => setImmediate(() => clientConnection.dispatch(message));
clientConnection.onmessage = message => setImmediate(() => dispatcherConnection.dispatch(message));

clientConnection.toImpl = (x: any) => x ? dispatcherConnection._dispatchers.get(x._guid)!._object : dispatcherConnection._dispatchers.get('');
(playwrightAPI as any)._toImpl = clientConnection.toImpl;

export const { _crx: crx } = playwrightAPI;
export default playwrightAPI;
