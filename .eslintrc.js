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
    'react/jsx-uses-vars': 'error',
    'react/jsx-uses-react': 'error',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-dupe-keys': 'error',
    'no-redeclare': 'error',
    'react-hooks/rules-of-hooks': 'warn',
  },
  // 精确兼容尚未整文件改造的旧页面。仅忽略当前已知名称；不是全文件/全局关闭。
  // 对应页面完成运行时主题与名字唤醒改造后，应删除这些 overrides。
  overrides: [
    {
      files: ['src/screens/TimeCapsuleScreen.js'],
      rules: {
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^(_|Pressable|formatLocalTime)$' }],
      },
    },
    {
      files: ['src/screens/CheckinListScreen.js'],
      rules: {
        'no-unused-vars': ['warn', { argsIgnorePattern: '^(_|userId)$', varsIgnorePattern: '^_' }],
      },
    },
    {
      files: ['src/screens/CheckinDetailScreen.js'],
      rules: {
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^(_|todayKey|getTodayRange)$' }],
      },
    },
    {
      files: ['src/screens/CheckinCalendarScreen.js'],
      rules: {
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^(_|formatLocalDate)$' }],
      },
    },
    {
      files: ['src/screens/ChatScreen.js'],
      rules: {
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^(_|memo|Platform|isInitialLoadRef|sendingPhoto)$' }],
      },
    },
    {
      files: ['src/screens/TravelDiaryScreen.js'],
      rules: {
        'no-unused-vars': ['warn', { argsIgnorePattern: '^(_|index)$', varsIgnorePattern: '^(_|AppInput|formatLocalTime|partnerId)$' }],
      },
    },
  ],
};
