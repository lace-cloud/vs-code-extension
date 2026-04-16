import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'out/',
      'generated/',
      'dist/',
      '.vscode/',
      'data/',
      'node_modules/',
      'packages/*/dist/',
      'packages/*/src/generated/',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
  },
  {
    plugins: {
      '@typescript-eslint': typescriptEslint,
      prettier: prettierPlugin,
    },

    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },

    rules: {
      ...typescriptEslint.configs.recommended.rules,
      ...prettierConfig.rules,
      'prettier/prettier': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
      ],

      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      semi: 'warn',
    },
  },

  // ── Workspace boundary: @lace/canvas (browser) ──
  {
    files: ['packages/canvas/src/**/*.ts', 'packages/canvas/src/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['vscode'], message: 'Canvas runs in the browser — cannot import vscode.' },
            {
              group: ['@grpc/grpc-js', '@grpc/*'],
              message: 'Canvas uses Connect-Web, not grpc-js.',
            },
            {
              group: ['node:*', 'fs', 'path', 'child_process', 'os'],
              message: 'Canvas runs in the browser — no Node.js builtins.',
            },
          ],
        },
      ],
    },
  },

  // ── Workspace boundary: @lace/host (Node.js) ──
  {
    files: ['packages/host/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@xyflow/*', '@xyflow/react'],
              message: 'Host runs in Node.js — cannot import @xyflow/react.',
            },
            {
              group: ['react', 'react-dom', 'react/*'],
              message: 'Host runs in Node.js — cannot import React.',
            },
            {
              group: ['@connectrpc/*'],
              message: 'Host uses grpc-js, not Connect-Web.',
            },
          ],
        },
      ],
    },
  },

  // ── Workspace boundary: @lace/chat-sidebar webview (browser) ──
  {
    files: ['packages/chat-sidebar/src/webview/**/*.ts', 'packages/chat-sidebar/src/webview/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['vscode'],
              message: 'Sidebar webview runs in the browser — cannot import vscode.',
            },
            {
              group: ['@grpc/grpc-js', '@grpc/*'],
              message: 'Sidebar webview cannot use grpc-js directly.',
            },
          ],
        },
      ],
    },
  },

  // ── Workspace boundary: @lace/proto (environment-neutral) ──
  {
    files: ['packages/proto/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['vscode'], message: 'Proto package is environment-neutral.' },
            { group: ['@xyflow/*'], message: 'Proto package is environment-neutral.' },
            { group: ['react', 'react-dom'], message: 'Proto package is environment-neutral.' },
            {
              group: ['@grpc/grpc-js', '@grpc/*'],
              message: 'Proto package has no service layer — use @lace/host.',
            },
          ],
        },
      ],
    },
  },
];
