import base from '../backend/eslint.config.js';

export default [
  ...base,
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'Date', 'process', 'performance', 'fetch', 'crypto', 'console', 'setTimeout', 'setInterval'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random' }],
    },
  },
];
