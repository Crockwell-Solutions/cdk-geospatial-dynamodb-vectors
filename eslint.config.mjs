/**
 * ESLint configuration for the root project (CDK infrastructure, Lambda code and scripts).
 *
 * - TypeScript: typescript-eslint recommended rules, plus Prettier formatting as lint errors.
 * - JSON and Markdown: their recommended rule sets.
 *
 * Formatting options live in .prettierrc.json. The frontend has its own configuration.
 */

import json from '@eslint/json';
import markdown from '@eslint/markdown';
import tsparser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: ['package-lock.json', '**/cdk.out', '**/node_modules/**/*', 'frontend', 'data'],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parser: tsparser,
      sourceType: 'module',
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      ...prettierConfig.rules,
      '@typescript-eslint/no-unused-vars': 'error',
      'no-console': 'warn',
      'prettier/prettier': 'error',
    },
  },
  {
    // Command-line scripts report progress on the console
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.json'],
    plugins: { json },
    language: 'json/json',
    extends: ['json/recommended'],
  },
  {
    files: ['**/*.md'],
    plugins: { markdown },
    language: 'markdown/gfm',
    extends: ['markdown/recommended'],
    rules: { 'markdown/no-missing-label-refs': 'off' },
  },
]);
