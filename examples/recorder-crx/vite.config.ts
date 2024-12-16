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
import webExtension, { readJsonFile } from 'vite-plugin-web-extension';
import recorderBuildConfig from './vite.build.config';
import crxConfig from '../../vite.config.mjs';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    webExtension({
      manifest: () => {
        const template = readJsonFile(path.resolve(__dirname, 'manifest.json'));
        return {
          ...template,
          background: {
            service_worker: 'src/background.ts',
            type: 'module',
          },
        };
      },
    }),
  ],
  resolve: {
    alias: {
      ...crxConfig.resolve?.alias,
      ...recorderBuildConfig.resolve?.alias,

      'playwright-crx': path.resolve(__dirname, '../../src'),
    },
  },
  define: {
    ...crxConfig.define,
    'process.env.CI': 'false',
  },
  build: {
    minify: false,
    sourcemap: true,
    commonjsOptions: {
      ...crxConfig.build?.commonjsOptions,
      ...recorderBuildConfig.build?.commonjsOptions,
    },
  },
});
