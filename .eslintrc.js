module.exports = {
  root: true,
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2022,
    ecmaFeatures: { jsx: true },
  },
  env: {
    es2022: true,
    node: true,
    jest: true,
  },
  plugins: ['react', 'react-hooks'],
  globals: {
    __DEV__: 'readonly',
  },
  ignorePatterns: [
    'node_modules/',
    'android/',
    'dist/',
    'supabase/functions/',
    '.expo/',
  ],
  rules: {
    // 把 JSX 中的组件引用计为“已使用”
    'react/jsx-uses-vars': 'error',
    'react/jsx-uses-react': 'error',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-dupe-keys': 'error',
    'no-redeclare': 'error',
    'react-hooks/rules-of-hooks': 'warn',
  },
};
