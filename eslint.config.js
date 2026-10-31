import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', '.netlify/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        indexedDB: 'readonly',
        Response: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
