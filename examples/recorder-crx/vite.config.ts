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
  build: {
    // recorder assets are copied to devtools output dir, so this will prevent those assets from being deleted.
    emptyOutDir: false,
    // skip code obfuscation
    minify: false,
    // chunk limit is not an issue, this is a browser extension
    chunkSizeWarningLimit: 10240,
    sourcemap: true,
    rollupOptions: {
      // @ts-ignore
      plugins: [sourcemaps()],
      input: {
        'background': path.resolve(__dirname, 'src/background.ts'),
        'options': path.resolve(__dirname, 'options.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
});
