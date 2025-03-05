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
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import replace from '@rollup/plugin-replace';

const baseDir = __dirname.replace(/\\/g, '/');

// https://vitejs.dev/config/
export default defineConfig({
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
      '_stack-utils': path.resolve(__dirname, './node_modules/stack-utils'),

      // https://workers-nodejs-compat-matrix.pages.dev/
      'async_hooks': 'node:async_hooks',
      'assert': 'node:assert',
      'buffer': 'node:buffer',
      'child_process': 'node:child_process',
      'chokidar': path.resolve(__dirname, './src/shims/chokidar'),
      'constants': 'node:constants',
      'crypto': 'node:crypto',
      'debug': path.resolve(__dirname, './node_modules/debug'),
      'dns': 'node:dns',
      'events': 'node:events',
      // node:fs still missing some required functions like fs.mkdtemp
      'fs': path.resolve(__dirname, './src/shims/fs'),
      'graceful-fs': path.resolve(__dirname, './src/shims/fs'),
      'http': 'node:http',
      'http2': 'node:http2',
      'https': 'node:https',
      'module': 'node:module',
      'net': 'node:net',
      'os': 'node:os',
      'path': 'node:path',
      'process': 'node:process',
      'readline': 'node:readline',
      'stream': 'node:stream',
      'tls': 'node:tls',
      'url': 'node:url',
      'zlib': 'node:zlib',

      'node:module': path.resolve(__dirname, './src/shims/module'),

      '../playwright': path.resolve(__dirname, './src/shims/noop'),
      './bidiOverCdp': path.resolve(__dirname, './src/shims/noop'),
      'electron/index.js': path.resolve(__dirname, './src/shims/noop'),

    },
  },
  define: {
    'require.resolve': 'Boolean',
  },
  plugins: [
    replace({
      'preventAssignment': true,
      '__dirname': id => {
        const relativePath = path.posix.relative(baseDir, path.posix.dirname(id));
        return [
          'src',
          'playwright/packages/playwright-core/src',
          'playwright/packages/playwright/src',
        ].some(p => relativePath.startsWith(p)) ? JSON.stringify(relativePath) : '__dirname';
      },
    }) as Plugin<any>,
  ],
  build: {
    outDir: path.resolve(__dirname, './lib/'),
    assetsInlineLimit: 0,
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
      output: {
        exports: 'named',
      },
      external: [
        'node:async_hooks',
        'node:assert',
        'node:browser',
        'node:buffer',
        'node:child_process',
        'node:constants',
        'node:crypto',
        'node:dns',
        'node:events',
        'node:fs',
        'node:http',
        'node:http2',
        'node:https',
        'node:module',
        'node:net',
        'node:os',
        'node:path',
        'node:process',
        'node:readline',
        'node:stream',
        'node:timers',
        'node:tls',
        'node:url',
        'node:zlib',
      ]
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      extensions: ['.ts', '.js'],
      exclude: [
        path.resolve(__dirname, './playwright/packages/playwright/src/index.ts'),
        path.resolve(__dirname, './playwright/packages/playwright-core/src/cli/**/*.ts'),
      ],
      include: [
        path.resolve(__dirname, './playwright/packages/playwright/src/**/*'),
        path.resolve(__dirname, './playwright/packages/playwright/bundles/*/src/**/*'),
        path.resolve(__dirname, './playwright/packages/playwright-core/src/**/*'),
        path.resolve(__dirname, './playwright/packages/playwright-core/bundles/*/src/**/*'),
        /node_modules/,
      ],
    }
  },
});
