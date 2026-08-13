const eslint = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const globals = require('globals');

module.exports = [
  eslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react': reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off',
      'react/react-in-jsx-scope': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/web-build/**',
      '**/server_dist/**',
      '**/.expo/**',
      '**/node_modules/**',
      '**/ios/**',
      '**/android/**',
      'test-*.js',
      'scripts/**',
      'tests/**',
      'plan-to-ship',
      '*.js',
      '*.mjs',
      '*.config.js',
      '**/docs-site/**',
      '**/static-build/**',
      '**/test-results/**',
      '**/.worktrees/**'
    ],
  }
];
