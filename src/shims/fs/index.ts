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

import FS from '@isomorphic-git/lightning-fs';

const fs = new FS('crx');
const noop = () => ({});;

export default fs;
export const { promises, readFile, readlink, rename, readdir, stat, lstat } = fs;

export const chmodSync = noop;
export const createWriteStream = noop;
export const existsSync = noop;
export const lstatSync = noop;
export const mkdirSync = noop;
export const readdirSync = noop;
export const readFileSync = noop;
export const readlinkSync = noop;
export const realpathSync = noop;
export const renameSync = noop;
export const rmdirSync = noop;
export const rmSync = noop;
export const statSync = noop;
export const unlinkSync = noop;
export const writeFileSync = noop;
