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

import path from 'path';
import { defineConfig } from 'vite';
import sourcemaps from 'rollup-plugin-sourcemaps';

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@injected': path.resolve(__dirname, '../../playwright/packages/playwright-core/src/server/injected'),
      '@isomorphic': path.resolve(__dirname, '../../playwright/packages/playwright-core/src/utils/isomorphic'),
      '@playwright-core': path.resolve(__dirname, '../../playwright/packages/playwright-core/src'),
      '@protocol': path.resolve(__dirname, '../../playwright/packages/protocol/src'),
      '@web': path.resolve(__dirname, '../../playwright/packages/web/src'),
      '@recorder': path.resolve(__dirname, '../../playwright/packages/recorder/src'),
      '@testIsomorphic': path.resolve(__dirname, '../../playwright/packages/playwright/src/isomorphic'),
      '@testTypes': path.resolve(__dirname, '../../playwright/packages/playwright/types'),
      '@trace': path.resolve(__dirname, '../../playwright/packages/trace/src'),
      '@trace-viewer': path.resolve(__dirname, '../../playwright/packages/trace-viewer/src'),
    },
  },
  build: {
    // skip code obfuscation
    minify: false,
    // chunk limit is not an issue, this is a browser extension
    chunkSizeWarningLimit: 10240,
    sourcemap: true,
    rollupOptions: {
      // @ts-ignore
      plugins: [sourcemaps()],
      input: {
        'index': path.resolve(__dirname, 'index.html'),
        'fs': path.resolve(__dirname, 'fs.html'),
        'preferences': path.resolve(__dirname, 'preferences.html'),
        'background': path.resolve(__dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
});
