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

export class AsyncLocalStorage<T extends { type: string; previous?: T }> {

  lastZoneId = 0;
  private _zones = new Map<number, T>();
  private _current: T | undefined;

  constructor() {}

  getStore() {
    return this._current;
  }

  run<R>(store: T, func: () => R): R  {
    let id: number | undefined;
    if (store) {
      id = this.lastZoneId++;
      this._zones.set(id, store);
      this._current = store;
      Object.defineProperty(func, 'name', { value: `__PWZONE__[${id}]-${store.type}` });
    }

    return runWithFinally(() => func(), () => {
      if (id) this._zones.delete(id);
      if (store) this._current = store.previous;
    });
  }
}

function runWithFinally<R>(func: () => R, finallyFunc: Function): R {
  try {
    const result = func();
    if (result instanceof Promise) {
      return result.then(r => {
        finallyFunc();
        return r;
      }).catch(e => {
        finallyFunc();
        throw e;
      }) as any;
    }
    finallyFunc();
    return result;
  } catch (e) {
    finallyFunc();
    throw e;
  }
}
