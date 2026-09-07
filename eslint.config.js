import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: { 'import-x': importPlugin, 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'import-x/no-restricted-paths': [
        'error',
        { zones: [{ target: './src/client', from: './src/server' }] },
      ],
      ...reactHooks.configs.recommended.rules,
    },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'eslint.config.js'] },
);
