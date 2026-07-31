const ignoredTrees = ['[/\\\\]#1[/\\\\]', '[/\\\\]backup[/\\\\]'];

module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|expo|@expo|expo-.*|@expo/.*|sentry-expo|react-native-toast-message)/)'
  ],
  testPathIgnorePatterns: ['/node_modules/', ...ignoredTrees, '[/\\\\]App\\.test\\.js$'],
  modulePathIgnorePatterns: ignoredTrees,
  watchPathIgnorePatterns: ignoredTrees,
};
