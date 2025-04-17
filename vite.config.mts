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
      'http2': path.resolve(__dirname, './node_modules/stream-http'),
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
      'zlib': path.resolve(__dirname, './node_modules/browserify-zlib'),

      'fs/promises': path.resolve(__dirname, './src/shims/fs/promises'),

      'node:events': path.resolve(__dirname, './node_modules/events'),
      'node:module': path.resolve(__dirname, './src/shims/module'),
      'node:stream': path.resolve(__dirname, './node_modules/readable-stream'),
      'node:string_decoder': path.resolve(__dirname, './node_modules/string_decoder'),
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
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      extensions: ['.ts', '.js'],
      exclude: [
        path.resolve(__dirname, './playwright/packages/playwright/src/index.ts'),
        path.resolve(__dirname, './playwright/packages/playwright-core/src/cli/**/*.ts'),
        // prevent from resolving require('../playwright')
        path.resolve(__dirname, './playwright/packages/playwright-core/src/server/recorder/recorderApp.ts'),
        // prevent from resolving require('./bidiOverCdp')
        path.resolve(__dirname, './playwright/packages/playwright-core/src/server/bidi/bidiChromium.ts'),
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
