// Minimal flat config to unblock ESLint v9 without adding new deps.
// Skips TS files (typecheck handled by `npm run typecheck`).

import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';

export default [
  {
    // Migrated from .eslintignore; remove file to silence warning
    ignores: [
      'node_modules',
      'android',
      'ios',
      'dist',
      'build',
      '_reports',
      'amplify',
      'assets',
      'coverage',
      'backup',
      '#1',
      'blyp-multiplayer-games',
      'src/polyfills',
      'src/shims',
      'App.js',
      '**/amplify/**',
      '**/_reports/**',
      '**/coverage/**',
      '**/backup/**',
      '**/#1/**',
      '**/blyp-multiplayer-games/**',
      '**/*.d.ts'
    ]
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      // Keep TS rule disabled since JS files only; plugin present to satisfy disable directives elsewhere
      '@typescript-eslint/no-var-requires': 'off'
    },
    settings: { react: { version: 'detect' } },
  },
];
