// Single source of truth for Expo config.
// Load a deterministic env file so local Android release and EAS production
// builds resolve the same repo-controlled production inputs.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const buildProfile = String(
  process.env.BLYP_BUILD_PROFILE ||
    process.env.EAS_BUILD_PROFILE ||
    ''
).trim().toLowerCase();
// Canonical local Play AAB sets BLYP_CANONICAL_RELEASE=1 + NODE_ENV=production
// (not always EAS_BUILD_PROFILE=production). Always load .env.production then.
const isProductionProfile =
  buildProfile === 'production' ||
  process.env.BLYP_RELEASE_BUILD === '1' ||
  process.env.BLYP_CANONICAL_RELEASE === '1' ||
  String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const envFiles = isProductionProfile
  ? ['.env.production', '.env']
  : ['.env'];

for (const envFile of envFiles) {
  const envPath = path.join(__dirname, envFile);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

module.exports = () => {
  // Prefer dynamic config only (avoid static app.json conflicts)
  const fromJson = {};

  const enableStreamingRaw = process.env.EXPO_PUBLIC_ENABLE_STREAMING;
  const enableStreamingNormalized = typeof enableStreamingRaw === 'string' ? enableStreamingRaw.trim().toLowerCase() : '';
  const enableStreaming = enableStreamingNormalized === '0' || enableStreamingNormalized === 'false' ? '0' : '1';

  // Matchday Live is OFF by default; opt in for staged rollout.
  const enableMatchdayRaw = process.env.EXPO_PUBLIC_ENABLE_MATCHDAY_LIVE;
  const enableMatchdayNormalized = typeof enableMatchdayRaw === 'string' ? enableMatchdayRaw.trim().toLowerCase() : '';
  const enableMatchdayLive = enableMatchdayNormalized === '1' || enableMatchdayNormalized === 'true' ? '1' : '0';

  const guestPublishRaw = process.env.EXPO_PUBLIC_ENABLE_GUEST_PUBLISH;
  const guestPublishNormalized = typeof guestPublishRaw === 'string' ? guestPublishRaw.trim().toLowerCase() : '';
  const enableGuestPublish =
    guestPublishNormalized === '0' || guestPublishNormalized === 'false' ? '0' : '1';

  // P7.4: the Gemini API key is NO LONGER embedded in the client bundle. All
  // client Gemini traffic is proxied through the authenticated server function
  // (functions/geminiProxy), which holds the key server-side. We deliberately do
  // not inject EXPO_PUBLIC_GEMINI_API_KEY into expo.extra any more.
  const extra = {
    ...(fromJson.extra || {}),
    eas: { projectId: '5a294a13-3ebd-417a-860f-3229f97f4faf' },
    // P7.4: Gemini key intentionally NOT injected — client uses the server proxy.
    EXPO_PUBLIC_GEMINI_API_KEY: '',
    // Release-safe default: streaming is ON unless explicitly disabled.
    EXPO_PUBLIC_ENABLE_STREAMING: enableStreaming,
    // Matchday Live: OFF unless explicitly enabled (staged rollout flag).
    EXPO_PUBLIC_ENABLE_MATCHDAY_LIVE: enableMatchdayLive,
    EXPO_PUBLIC_ENABLE_GUEST_PUBLISH: enableGuestPublish,
    EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'blyp-master.firebaseapp.com',
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'blyp-master',
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'blyp-master.firebasestorage.app',
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '929105034040',
    EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:929105034040:web:3f725bb93e50e9d8bb9fcd',
    EXPO_PUBLIC_FIREBASE_BRIDGE_BASE_URL:
      process.env.EXPO_PUBLIC_FIREBASE_BRIDGE_BASE_URL ||
      process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ||
      'https://us-central1-blyp-master.cloudfunctions.net',
    EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET:
      process.env.EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET === '0' ||
      String(process.env.EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET || '').toLowerCase() === 'false'
        ? '0'
        : '1',
    EXPO_PUBLIC_LIVE_SERVICE_URL:
      process.env.EXPO_PUBLIC_LIVE_SERVICE_URL ||
      'https://blyp-live-service-innn3d7yqq-uc.a.run.app',
    // Default OFF — matches live-service withdrawal kill-switch. Opt in with =1.
    EXPO_PUBLIC_ENABLE_WITHDRAWALS:
      process.env.EXPO_PUBLIC_ENABLE_WITHDRAWALS === '1' ||
      String(process.env.EXPO_PUBLIC_ENABLE_WITHDRAWALS || '').toLowerCase() === 'true'
        ? '1'
        : '0',
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
      backgroundColor: '#0A0A0C',
      image: './assets/splash.png',
      resizeMode: 'contain',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.blyp.mobile',
      buildNumber: process.env.EXPO_IOS_BUILD_NUMBER || '1',
      // Push: expo-notifications plugin + EAS credentials supply the aps entitlement.
      infoPlist: {
        NSCameraUsageDescription:
          'Blyp needs camera access to take photos, record videos, and go live.',
        NSMicrophoneUsageDescription:
          'Blyp needs microphone access for voice calls, voice memos, and live audio.',
        NSPhotoLibraryUsageDescription:
          'Blyp needs photo library access to save and select media.',
        NSPhotoLibraryAddUsageDescription:
          'Blyp needs permission to save photos and videos to your library.',
        NSLocationWhenInUseUsageDescription:
          'Blyp uses your location to find shops, restaurants, and takeaways near you.',
        NSBluetoothAlwaysUsageDescription:
          'Blyp uses Bluetooth to connect to nearby audio devices during calls and live streams.',
        NSBluetoothPeripheralUsageDescription:
          'Blyp uses Bluetooth to connect to nearby audio devices during calls and live streams.',
        UIBackgroundModes: ['audio', 'voip', 'remote-notification'],
        // Standard HTTPS / OS crypto only — speeds App Store Connect export compliance.
        ITSAppUsesNonExemptEncryption: false,
      },
      entitlements: {
        'aps-environment':
          buildProfile === 'production' || buildProfile === 'preview-ios'
            ? 'production'
            : 'development',
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0A0A0C',
      },
      package: 'com.blyp.mobile',
      softwareKeyboardLayoutMode: 'pan',
      permissions: [
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.BLUETOOTH',
        'android.permission.BLUETOOTH_CONNECT',
        'android.permission.ACCESS_WIFI_STATE',
        'android.permission.INTERNET',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.WAKE_LOCK',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.POST_NOTIFICATIONS',
        // Incoming voice/video calls: full-screen ringing UI when the phone is locked.
        'android.permission.USE_FULL_SCREEN_INTENT',
        'android.permission.FOREGROUND_SERVICE',
        // Incoming-call ringtone FGS (IncomingCallForegroundService) — mediaPlayback only.
        // Do NOT declare FOREGROUND_SERVICE_MICROPHONE: no service uses type=microphone;
        // mic-typed FGS is also killed on API 34+ when the mic is not actively captured.
        'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        // Reminders use local notifications. Do NOT declare USE_EXACT_ALARM —
        // Play only allows that for calendar/alarm-clock core apps (Blyp is neither).
        'android.permission.SCHEDULE_EXACT_ALARM',
        'android.permission.VIBRATE',
      ],
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
    },
    plugins: [
      'react-native-compressor',
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
          microphonePermission: 'Allow Blyp to access your microphone for phone calls and voice memos.',
        },
      ],
      'expo-font',
      [
        'expo-notifications',
        {
          color: '#00D2BE',
          sounds: ['./assets/sounds/blyp_notify.wav'],
          defaultChannel: 'blyp',
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Allow Blyp to use your location to find places near you.',
        },
      ],
      // Integrates the Amazon IVS iOS SDKs (Stages + Player) and Blyp's native
      // Swift/ObjC bridge so live streaming works on iOS at parity with Android.
      './plugins/withIVSiOS',
      // In-app audio calls (LiveKit + WebRTC). Requires a native rebuild / new AAB.
      '@livekit/react-native-expo-plugin',
      '@config-plugins/react-native-webrtc',
    ],
    extra,
    androidNavigationBar: {
      visible: 'immersive',
    },
    androidStatusBar: {
      backgroundColor: '#0A0A0C',
      barStyle: 'light-content',
      translucent: true,
    },
    owner: 'alexjirving',
  };

  // Fallback: return our static config when app.json is missing
  return { ...resolved };
};
