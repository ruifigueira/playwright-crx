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

import type { BrowserType, Crx, CrxPlaywright } from './src/types/types';

export * from './src/types/types';

export const chromium: BrowserType;
export const crx: Crx;
export function _setUnderTest(): void;
export function _isUnderTest(): boolean;
export const _debug: {
  enable(namespaces: string): void;
  enabled(namespaces: string): boolean;
  disable(): void;
};
export const launch: CrxPlaywright['launch'];
