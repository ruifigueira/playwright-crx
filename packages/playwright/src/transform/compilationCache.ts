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

import fs from 'fs';
import os from 'os';
import path from 'path';
import { sourceMapSupport } from '../utilsBundle';
import { isWorkerProcess } from '../common/globals';

export type MemoryCache = {
  codePath: string;
  sourceMapPath: string;
  moduleUrl?: string;
};

// Assumptions for the compilation cache:
// - Files in the temp directory we work with can disappear at any moment, either some of them or all together.
// - Multiple workers can be trying to read from the compilation cache at the same time.
// - There is a single invocation of the test runner at a time.
//
// Therefore, we implement the following logic:
// - Never assume that file is present, always try to read it to determine whether it's actually present.
// - Never write to the cache from worker processes to avoid "multiple writers" races.
// - Since we perform all static imports in the runner beforehand, most of the time
//   workers should be able to read from the cache.
// - For workers-only dynamic imports or some cache problems, we will re-transpile files in
//   each worker anew.

const cacheDir = process.env.PWTEST_CACHE_DIR || (() => {
  if (process.platform === 'win32')
    return path.join(os.tmpdir(), `playwright-transform-cache`);
  // Use `geteuid()` instead of more natural `os.userInfo().username`
  // since `os.userInfo()` is not always available.
  // Note: `process.geteuid()` is not available on windows.
  // See https://github.com/microsoft/playwright/issues/22721
  return path.join(os.tmpdir(), `playwright-transform-cache-` + process.geteuid());
})();

const sourceMaps: Map<string, string> = new Map();
const memoryCache = new Map<string, MemoryCache>();
// Dependencies resolved by the loader.
const fileDependencies = new Map<string, Set<string>>();
// Dependencies resolved by the external bundler.
const externalDependencies = new Map<string, Set<string>>();

let sourceMapSupportInstalled = false;

export function installSourceMapSupportIfNeeded() {
  if (sourceMapSupportInstalled)
    return;
  sourceMapSupportInstalled = true;

  Error.stackTraceLimit = 200;

  sourceMapSupport.install({
    environment: 'node',
    handleUncaughtExceptions: false,
    retrieveSourceMap(source) {
      if (!sourceMaps.has(source))
        return null;
      const sourceMapPath = sourceMaps.get(source)!;
      try {
        return {
          map: JSON.parse(fs.readFileSync(sourceMapPath, 'utf-8')),
          url: source,
        };
      } catch {
        return null;
      }
    }
  });
}

function _innerAddToCompilationCache(filename: string, options: { codePath: string, sourceMapPath: string, moduleUrl?: string }) {
  sourceMaps.set(options.moduleUrl || filename, options.sourceMapPath);
  memoryCache.set(filename, options);
}

export function getFromCompilationCache(filename: string, hash: string, moduleUrl?: string): { cachedCode?: string, addToCache?: (code: string, map?: any) => void } {
  // First check the memory cache by filename, this cache will always work in the worker,
  // because we just compiled this file in the loader.
  const cache = memoryCache.get(filename);
  if (cache?.codePath) {
    try {
      return { cachedCode: fs.readFileSync(cache.codePath, 'utf-8') };
    } catch {
      // Not able to read the file - fall through.
    }
  }

  // Then do the disk cache, this cache works between the Playwright Test runs.
  const cachePath = calculateCachePath(filename, hash);
  const codePath = cachePath + '.js';
  const sourceMapPath = cachePath + '.map';
  try {
    const cachedCode = fs.readFileSync(codePath, 'utf8');
    _innerAddToCompilationCache(filename, { codePath, sourceMapPath, moduleUrl });
    return { cachedCode };
  } catch {
  }

  return {
    addToCache: (code: string, map: any) => {
      if (isWorkerProcess())
        return;
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      if (map)
        fs.writeFileSync(sourceMapPath, JSON.stringify(map), 'utf8');
      fs.writeFileSync(codePath, code, 'utf8');
      _innerAddToCompilationCache(filename, { codePath, sourceMapPath, moduleUrl });
    }
  };
}

export function serializeCompilationCache(): any {
  return {
    sourceMaps: [...sourceMaps.entries()],
    memoryCache: [...memoryCache.entries()],
    fileDependencies: [...fileDependencies.entries()].map(([filename, deps]) => ([filename, [...deps]])),
    externalDependencies: [...externalDependencies.entries()].map(([filename, deps]) => ([filename, [...deps]])),
  };
}

export function clearCompilationCache() {
  sourceMaps.clear();
  memoryCache.clear();
}

export function addToCompilationCache(payload: any) {
  for (const entry of payload.sourceMaps)
    sourceMaps.set(entry[0], entry[1]);
  for (const entry of payload.memoryCache)
    memoryCache.set(entry[0], entry[1]);
  for (const entry of payload.fileDependencies)
    fileDependencies.set(entry[0], new Set(entry[1]));
  for (const entry of payload.externalDependencies)
    externalDependencies.set(entry[0], new Set(entry[1]));
}

function calculateCachePath(filePath: string, hash: string): string {
  const fileName = path.basename(filePath, path.extname(filePath)).replace(/\W/g, '') + '_' + hash;
  return path.join(cacheDir, hash[0] + hash[1], fileName);
}

// Since ESM and CJS collect dependencies differently,
// we go via the global state to collect them.
let depsCollector: Set<string> | undefined;

export function startCollectingFileDeps() {
  depsCollector = new Set();
}

export function stopCollectingFileDeps(filename: string) {
  if (!depsCollector)
    return;
  depsCollector.delete(filename);
  for (const dep of depsCollector) {
    if (belongsToNodeModules(dep))
      depsCollector.delete(dep);
  }
  fileDependencies.set(filename, depsCollector);
  depsCollector = undefined;
}

export function currentFileDepsCollector(): Set<string> | undefined {
  return depsCollector;
}

export function setExternalDependencies(filename: string, deps: string[]) {
  const depsSet = new Set(deps.filter(dep => !belongsToNodeModules(dep) && dep !== filename));
  externalDependencies.set(filename, depsSet);
}

export function fileDependenciesForTest() {
  return fileDependencies;
}

export function collectAffectedTestFiles(dependency: string, testFileCollector: Set<string>) {
  testFileCollector.add(dependency);
  for (const [testFile, deps] of fileDependencies) {
    if (deps.has(dependency))
      testFileCollector.add(testFile);
  }
  for (const [testFile, deps] of externalDependencies) {
    if (deps.has(dependency))
      testFileCollector.add(testFile);
  }
}

export function dependenciesForTestFile(filename: string): Set<string> {
  const result = new Set<string>();
  for (const dep of fileDependencies.get(filename) || [])
    result.add(dep);
  for (const dep of externalDependencies.get(filename) || [])
    result.add(dep);
  return result;
}

// These two are only used in the dev mode, they are specifically excluding
// files from packages/playwright*. In production mode, node_modules covers
// that.
const kPlaywrightInternalPrefix = path.resolve(__dirname, '../../../playwright');
const kPlaywrightCoveragePrefix = path.resolve(__dirname, '../../../../tests/config/coverage.js');

export function belongsToNodeModules(file: string) {
  if (file.includes(`${path.sep}node_modules${path.sep}`))
    return true;
  if (file.startsWith(kPlaywrightInternalPrefix) && file.endsWith('.js'))
    return true;
  if (file.startsWith(kPlaywrightCoveragePrefix) && file.endsWith('.js'))
    return true;
  return false;
}
