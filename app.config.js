// Single source of truth for Expo config.
// This replaces app.json to avoid duplication and Expo Doctor warnings.

module.exports = () => {
  // Prefer dynamic config only (avoid static app.json conflicts)
  const fromJson = {};

  // Gemini key must NEVER be hard-coded. It is sourced from env/EAS secrets.
  // If absent, downstream Gemini features must degrade safely (disabled mode).
  const resolvedGeminiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || (fromJson.extra && fromJson.extra.EXPO_PUBLIC_GEMINI_API_KEY) || '';
  if (!resolvedGeminiKey) {
    // eslint-disable-next-line no-console
    console.warn('[BLYP][SECURITY] Gemini key not provided via env. Gemini features will be disabled.');
  }
  const extra = {
    ...(fromJson.extra || {}),
    eas: { projectId: '5a294a13-3ebd-417a-860f-3229f97f4faf' },
    // Key value is injected at build/runtime from env; blank string in code ensures no committed secret.
    EXPO_PUBLIC_GEMINI_API_KEY: resolvedGeminiKey,
    EXPO_PUBLIC_ENABLE_STREAMING: process.env.EXPO_PUBLIC_ENABLE_STREAMING === '1' ? '1' : '0',
    EXPO_PUBLIC_STREAMING_BACKEND: process.env.EXPO_PUBLIC_STREAMING_BACKEND || 'HLS',
    features: {
      manifestEnabled: process.env.EXPO_PUBLIC_MANIFEST_ENABLED === '1' || false,
    },
  };
  if (process.env.EXPO_PUBLIC_GIT_SHA) extra.gitSha = process.env.EXPO_PUBLIC_GIT_SHA;

  const resolved = {
    name: 'Blyp',
    slug: 'blyp-mobile',
    scheme: 'blyp',
    version: '1.0.1',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    splash: {
      backgroundColor: '#0f172a',
      image: './assets/splash.png',
      resizeMode: 'contain',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.blyp.mobile',
      infoPlist: {
        NSCameraUsageDescription: 'This app needs access to camera to take photos and videos',
        NSMicrophoneUsageDescription: 'This app needs access to microphone to record audio',
        NSPhotoLibraryUsageDescription: 'This app needs access to photo library to save and select media',
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0f172a',
      },
      package: 'com.blyp.mobile',
      softwareKeyboardLayoutMode: 'pan',
      permissions: [
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.INTERNET',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.WAKE_LOCK',
      ],
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
    },
    plugins: [
      'sentry-expo',
      [
        'expo-camera',
        {
          cameraPermission: 'Allow Blyp to access your camera to take photos and videos.',
          microphonePermission: 'Allow Blyp to access your microphone to record audio.',
        },
      ],
      [
        'expo-media-library',
        {
          photosPermission: 'Allow Blyp to access your photos to save and share your memories.',
          savePhotosPermission: 'Allow Blyp to save photos to your device.',
          isAccessMediaLocationEnabled: true,
        },
      ],
      [
        'expo-av',
        {
          microphonePermission: 'Allow Blyp to access your microphone to record voice memos.',
        },
      ],
      'expo-font',
    ],
    extra,
    androidNavigationBar: {
      visible: 'immersive',
    },
    androidStatusBar: {
      backgroundColor: '#0f172a',
      translucent: true,
    },
    owner: 'alexjirving',
  };

  // Fallback: return our static config when app.json is missing
  return { ...resolved };
};
