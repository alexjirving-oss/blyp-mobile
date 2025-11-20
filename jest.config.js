module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|expo|@expo|expo-.*|@expo/.*|sentry-expo|react-native-toast-message)/)'
  ],
  testPathIgnorePatterns: ['/node_modules/', '/#1/', '/backup/', '/App.test.js'],
  modulePathIgnorePatterns: ['<rootDir>/#1/', '<rootDir>/backup/'],
};
