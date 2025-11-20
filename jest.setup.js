// Mock AsyncStorage for Jest
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Basic mocks for React Native/Expo modules that may load in App
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));

// Provide factory mock to avoid Jest attempting to load RN internals not present in test env
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper', () => ({
  default: {},
}));
jest.mock('react-native-screens', () => ({ enableScreens: jest.fn() }));
jest.mock('react-native', () => {
  // Provide a trimmed react-native surface avoiding TurboModules (DevMenu) resolution.
  const safeExports = {
    AccessibilityInfo: {},
    Appearance: {},
    AppRegistry: { registerComponent: jest.fn(), runApplication: jest.fn() },
    AppState: { addEventListener: jest.fn(), removeEventListener: jest.fn(), currentState: 'active' },
    Dimensions: { get: () => ({ width: 360, height: 640, scale: 2 }) },
    Easing: {},
    I18nManager: { isRTL: false },
    InteractionManager: { runAfterInteractions: cb => cb && cb() },
    Keyboard: { addListener: jest.fn() },
    Linking: { addEventListener: jest.fn(), openURL: jest.fn() },
    LogBox: { ignoreLogs: jest.fn(), ignoreAllLogs: jest.fn() },
    NativeModules: {},
    PixelRatio: { get: () => 2 },
    Platform: { OS: 'ios', select: obj => obj.ios },
    StyleSheet: { create: obj => obj },
    UIManager: { getViewManagerConfig: jest.fn() },
    View: 'View',
    Text: 'Text',
    FlatList: 'FlatList',
    ScrollView: 'ScrollView',
  };
  return safeExports;
});

// Mock NetInfo to avoid TurboModule access in tests needing network type
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ type: 'wifi' }),
  addEventListener: () => ({ remove: () => {} }),
}));

// Mock project-specific side-effect modules to simplify rendering in Jest
jest.mock('./src/config/amplify', () => ({}));
jest.mock('./src/config/preAuthCleanup', () => ({}));
jest.mock('sentry-expo', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('./src/monitoring/sentry', () => ({}));
jest.mock('expo-device', () => ({
  brand: 'test',
  manufacturer: 'test',
  modelName: 'simulator',
  osName: 'TestOS',
  osVersion: '1.0',
  supportedCpuArchitectures: ['x64'],
  totalMemory: 1024 * 1024 * 512,
  isDevice: false,
}));

// Provide minimal env for modules that validate config at import time
process.env.EXPO_PUBLIC_FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'test';
process.env.EXPO_PUBLIC_GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || 'test';
process.env.EXPO_PUBLIC_GEMINI_API_URL = process.env.EXPO_PUBLIC_GEMINI_API_URL || 'https://example.com/gemini?key=test';

// Lightweight mock for Firebase config/module to avoid initialization in tests
jest.mock('./src/config/firebase', () => ({
  firebaseConfig: { apiKey: 'test' },
  auth: { onAuthStateChanged: jest.fn() },
  firestore: {},
  storage: {},
  db: { collection: () => ({ doc: () => ({ onSnapshot: () => () => {} }) }) },
  geminiApiKey: '',
  geminiApiUrl: '',
}));
