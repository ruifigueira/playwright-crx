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

import { Connection } from 'playwright-core/lib/client/connection';
import { Crx, CrxApplication } from './crx';
import { CrxPlaywright } from './crxPlaywright';
import { findValidator } from 'playwright-core/lib/protocol/validatorPrimitives';

export class CrxConnection extends Connection {
  constructor() {
    super(undefined, undefined);
    this.useRawBuffers();
  }

  dispatch(message: object): void {
    const { guid: parentGuid, method, params } = message as any;

    if (method === '__create__') {
      const { type, guid } = params;
      let initializer = params.initializer;

      const parent = this._objects.get(parentGuid)!;
      const validator = findValidator(type, '', 'Initializer');
      initializer = validator(initializer, '', { tChannelImpl: (this as any)._tChannelImplFromWire.bind(this), binary: 'buffer' });

      switch (type) {
        case 'Playwright':
          new CrxPlaywright(parent, type, guid, initializer);
          return;
        case 'Crx':
          new Crx(parent, type, guid, initializer);
          return;
        case 'CrxApplication':
          new CrxApplication(parent, type, guid, initializer);
          return;
      }
    }

    return super.dispatch(message);
  }
}
