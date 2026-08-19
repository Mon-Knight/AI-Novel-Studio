module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    'build',
    'src-tauri/target',
    'node_modules',
    '*.config.js',
    '*.config.ts',
    '*.config.cjs',
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'no-console': 'error',
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
  },
  overrides: [
    {
      files: ['src/services/observability/appLogger.ts'],
      rules: { 'no-console': 'off' },
    },
    {
      files: ['scripts/e2e/run-e2e.ts'],
      rules: { 'no-console': 'off' },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.mjs'],
      rules: { 'no-console': 'off' },
    },
  ],
};
