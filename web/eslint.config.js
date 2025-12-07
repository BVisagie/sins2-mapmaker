import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    rules: {
      // Keep the existing behavior while React hooks lint rules tightened in v7
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      // Allow empty blocks for placeholders and try/catch patterns
      'no-empty': 'off',
      // Relax TypeScript strictness to match the current codebase
      '@typescript-eslint/no-explicit-any': 'off',
      // Keep legacy patterns without forcing refactors
      'prefer-const': 'off',
      'no-constant-binary-expression': 'off',
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
