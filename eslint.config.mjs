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

import { fixupConfigRules } from '@eslint/compat';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import notice from 'eslint-plugin-notice';
import path from 'path';
import { fileURLToPath } from 'url';
import stylistic from '@stylistic/eslint-plugin';
import { baseRules } from './playwright/eslint.config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

const baseConfig = fixupConfigRules(compat.extends('plugin:react/recommended', 'plugin:react-hooks/recommended'));

const plugins = {
  '@stylistic': stylistic,
  '@typescript-eslint': typescriptEslint,
  notice,
};

const ignores = [
  '/playwright/',
  '/lib',
  'node_modules/',
  'dist/',
  'test-results/',
  'playwright-report/',
  '/src/types/',
  '**/*.json',
  '**/*.wasm',
  '/tests/crx/code/',
  '**/*.d.ts',
  '**/*.js',
  '**/*.mjs',
];

export default [
  { ignores },
  { 
    plugins,
    settings: {
      react: { version: 'detect' },
    }
  },
  ...baseConfig,
  {
    files: [ 'src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 9,
      sourceType: 'module',
      parserOptions: {
        project: path.join(__dirname, 'tsconfig.json'),
      },
    },
    rules: {
      ...baseRules,
      // copyright
      'notice/notice': [2, {
        'mustMatch': 'Copyright',
        'templateFile': path.join(__dirname, 'utils', 'copyright.js'),
      }],
      'no-console': 2,
    }
  },
  // TODO lint tests
  projectSection('examples/recorder-crx'),
  projectSection('examples/todomvc-crx'),
];

function projectSection(projDir) {
  return {
    files: [
      `${projDir}/src/**/*.ts`,
      `${projDir}/src/**/*.tsx`,
    ],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 9,
      sourceType: 'module',
      parserOptions: {
        project: path.join(__dirname, projDir, 'tsconfig.json'),
      },
    },
    rules: {
      ...baseRules,
      'no-console': 2,
    }
  };
}