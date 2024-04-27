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

import path from 'path';
import sourcemaps from 'rollup-plugin-sourcemaps';
import { defineConfig } from 'vite';
import requireTransform from 'vite-plugin-require-transform';

// we exclude some files with require, otherwise we can get out-of-order dependencies
const requireTransformFiles = [
  'playwright/packages/playwright-core/bundles/utils/src/utilsBundleImpl.ts',
  'playwright/packages/playwright-core/src/server/dispatchers/localUtilsDispatcher.ts',
  'playwright/packages/playwright-core/src/server/recorder/csharp.ts',
  'playwright/packages/playwright-core/src/server/recorder/java.ts',
  'playwright/packages/playwright-core/src/server/recorder/javascript.ts',
  'playwright/packages/playwright-core/src/server/recorder/python.ts',
  'playwright/packages/playwright-core/src/server/registry/dependencies.ts',
  'playwright/packages/playwright-core/src/server/registry/index.ts',
  'playwright/packages/playwright-core/src/utils/comparators.ts',
  'playwright/packages/playwright-core/src/utils/userAgent.ts',
  'playwright/packages/playwright-core/src/utilsBundle.ts',
  'playwright/packages/playwright-core/src/zipBundle.ts',
  // tests
  'playwright/packages/playwright/bundles/babel/src/babelBundleImpl.ts',
  'playwright/packages/playwright/src/common/config.ts',
  'playwright/packages/playwright/src/common/expectBundle.ts',
  'playwright/packages/playwright/src/index.ts',
  'playwright/packages/playwright/src/transform/babelBundle.ts',
  'playwright/packages/playwright/src/transform/transform.ts',
  'playwright/packages/playwright/src/utilsBundle.ts',
];

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    requireTransform({ fileRegex: new RegExp('(' + requireTransformFiles.map(s => s.replace(/\//g, '\\/').replace(/\./g, '\.')).join('|') + ')$') }),
  ],
  resolve: {
    alias: {
      'playwright-core/lib': path.resolve(__dirname, './playwright/packages/playwright-core/src'),
      '@playwright/test/lib': path.resolve(__dirname, './playwright/packages/playwright/src'),
      'playwright-core': path.resolve(__dirname, './src/index'),

      // for bundles, we use relative paths because different utilsBundleImpl exists in both playwright-core and playwright
      './utilsBundleImpl': '../bundles/utils/src/utilsBundleImpl',
      './zipBundleImpl': '../bundles/zip/src/zipBundleImpl',
      './babelBundleImpl': '../../bundles/babel/src/babelBundleImpl',
      './expectBundleImpl': '../../bundles/expect/src/expectBundleImpl',

      // shims
      '_url': path.resolve(__dirname, './node_modules/url'),
      '_util': path.resolve(__dirname, './node_modules/util'),
      'async_hooks': path.resolve(__dirname, './src/shims/async_hooks'),
      'assert': path.resolve(__dirname, './node_modules/assert'),
      'buffer': path.resolve(__dirname, './node_modules/buffer'),
      'child_process': path.resolve(__dirname, './src/shims/child_process'),
      'chokidar': path.resolve(__dirname, './src/shims/chokidar'),
      'constants': path.resolve(__dirname, './node_modules/constants-browserify'),
      'crypto': path.resolve(__dirname, './node_modules/crypto-browserify'),
      'debug': path.resolve(__dirname, './node_modules/debug'),
      'dns': path.resolve(__dirname, './src/shims/dns'),
      'events': path.resolve(__dirname, './node_modules/events'),
      'fs': path.resolve(__dirname, './src/shims/fs'),
      'graceful-fs': path.resolve(__dirname, './src/shims/fs'),
      'http': path.resolve(__dirname, './node_modules/stream-http'),
      'https': path.resolve(__dirname, './node_modules/https-browserify'),
      'module': path.resolve(__dirname, './src/shims/module'),
      'net': path.resolve(__dirname, './src/shims/net'),
      'os': path.resolve(__dirname, './node_modules/os-browserify/browser'),
      'path': path.resolve(__dirname, './node_modules/path'),
      'process': path.resolve(__dirname, './node_modules/process'),
      'readline': path.resolve(__dirname, './src/shims/readline'),
      'setimmediate': path.resolve(__dirname, './node_modules/setimmediate'),
      'stream': path.resolve(__dirname, './node_modules/readable-stream'),
      'tls': path.resolve(__dirname, './src/shims/tls'),
      'url': path.resolve(__dirname, './src/shims/url'),
      'util': path.resolve(__dirname, './src/shims/util'),
      'zlib': path.resolve(__dirname, './node_modules/browserify-zlib'),

      'node:events': path.resolve(__dirname, './node_modules/events'),
      'node:stream': path.resolve(__dirname, './node_modules/readable-stream'),
      'node:string_decoder': path.resolve(__dirname, './node_modules/string_decoder'),
    },
  },
  define: {
    'require.resolve': 'Boolean',
  },
  build: {
    outDir: path.resolve(__dirname, './lib/'),
    // skip code obfuscation
    minify: false,
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        test: path.resolve(__dirname, 'src/test.ts'),
      },
    },
    sourcemap: true,
    rollupOptions: {
      // @ts-ignore
      plugins: [sourcemaps()],
    },
    commonjsOptions: {
      include: [
        path.resolve(__dirname, './playwright/packages/playwright-core/src/**/*.js'),
        path.resolve(__dirname, './playwright/packages/playwright-core/bundles/utils/src/third_party/**/*.js'),
        /node_modules/,
      ],
    }
  },
});
