module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|expo|@expo|expo-.*|@expo/.*|@sentry/react-native|react-native-toast-message)/)'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/#1/',
    '/backup/',
    '/App.test.js',
    '/diagnostics/',
    '/tools/accountability/',
    '/backend/',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/#1/',
    '<rootDir>/backup/',
    '<rootDir>/diagnostics/',
    '<rootDir>/tools/accountability/',
    '<rootDir>/backend/',
  ],
};
