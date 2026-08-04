# Blyp Mobile - React Native Social Media App

A modern social media app built with React Native and Expo, featuring camera
capture, voice memos, AI captioning, an in-app economy, and **live streaming**.

Blyp uses a dual-cloud backend: **Firebase** (Firestore, Storage, Cloud
Functions) for social content and metadata, and **AWS** for identity (Cognito),
live video (IVS Real-Time), and the authoritative economy/realtime service
(a Node.js app deployed on Render). Cognito is the primary identity provider and
is bridged to Firebase Auth via a Cloud Function so the same user id works
across both clouds.

## 🚀 Quick Start

**Recommended**: Use the smart startup script:
```powershell
# Expo Go mode (QR code)
.\start-app.ps1

# Dev client mode (custom build / emulator)
.\start-app.ps1 -DevClient
```

Or manually (Expo Go):
```bash
npx expo start --clear
```

### Dev Client Notes (Connection Failures)
If your physical device dev client shows a project pointing at `127.0.0.1:8081` and fails:

1. That loopback address only works on an emulator, not a real device.
2. Restart using one of:
   ```powershell
   # LAN broadcast
   .\start-app.ps1 -DevClient -Lan

   # Tunnel (works across networks / strict Wi-Fi)
   .\start-app.ps1 -DevClient -Tunnel

   # Custom port (example 8090)
   .\start-app.ps1 -DevClient -Lan -Port 8090
   ```
3. If using USB, ensure `adb reverse tcp:<port> tcp:<port>` ran (script does this automatically for default ports 8081/8083).
4. You can manually open using a URL like:
   `exp+blyp-mobile://expo-development-client?url=http://<LAN_IP>:8083`.

**Having issues?** See [`TROUBLESHOOTING_GUIDE.md`](./TROUBLESHOOTING_GUIDE.md) for complete solutions.

## Live Streaming (AWS IVS Real-Time)

Live streaming is built on **AWS IVS Real-Time** (low-latency, multi-guest
co-streaming), driven by native Android modules under
`android/app/src/main/java/com/blyp/mobile/ivs/`. IVS stage management and
participant token minting happen server-side in the Node.js live service
(`backend/blyp-live-service`); the client talks to it via `src/api/ivsLiveApi.ts`.

> Note: the streaming docs listed below (`START-HERE.md`,
> `README-LIVESTREAM.md`, etc.) describe an earlier Firebase/HLS streaming
> approach that has since been replaced by AWS IVS. They are retained for
> historical context only and do not reflect the current implementation.

## 📚 Documentation

- **[START-HERE.md](./START-HERE.md)** - Complete setup and deployment guide
- **[TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md)** - Fix common issues fast
- **[REAL_ISSUES_ANALYSIS.md](./REAL_ISSUES_ANALYSIS.md)** - Understanding what went wrong
- **[BUILD-GUIDE.md](./BUILD-GUIDE.md)** - Production build instructions

## Features

- 🎥 **Camera & Video Recording** - Take photos and record videos with front/back camera switching
- 📡 **LIVE STREAMING** - Real-time video broadcasting with unlimited viewers (NEW!)
- 🎙️ **Voice Memos** - Record and playback voice notes with audio visualization
- 📱 **Social Media Integration** - Share to Facebook, Instagram, TikTok, and YouTube
- 🔥 **Firebase Backend** - Real-time database, authentication, and cloud storage
- 🎨 **Modern UI** - Dark theme with gradient animations and smooth transitions
- 👥 **Chat & Games** - Social features including chat rooms and mini-games
- 📬 **Messenger** - Direct messaging and notifications system

## Technology Stack

- **React Native 0.81** with **Expo SDK 54**
- **AWS Cognito** (via AWS Amplify) - primary identity / auth
- **Firebase** (Firestore, Storage, Cloud Functions) - social content, media, auth bridge
- **AWS IVS Real-Time** - live video broadcasting and multi-guest co-streaming
- **Node.js live service** (`backend/blyp-live-service`, Render) - IVS tokens, economy ledger, realtime
- **Socket.io** - realtime gift / live-game / matchday events
- **Google Gemini** - AI captioning and speech-to-text
- **Expo Camera / Expo AV** for media capture and audio
- **React Navigation** for screen navigation

## Getting Started

### Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- Android Studio (for Android development) or Xcode (for iOS)
- Firebase project with Auth, Firestore, and Storage enabled

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/blyp-mobile.git
   cd blyp-mobile
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Firebase**
   - Update `src/config/firebase.js` with your Firebase configuration
   - Add your Gemini API key for AI features (optional)

4. **Start the development server**
   ```bash
   npm start
   ```

5. **Run on your device**
   - Scan the QR code with Expo Go app
   - Or run `npm run android` / `npm run ios` for emulators

### Firebase Setup

1. Create a new Firebase project at https://console.firebase.google.com
2. Enable Authentication with Email/Password
3. Create a Firestore database with the following collections:
   - `posts` - For user posts and memories
   - `users` - For user profiles (optional)
   - `liveStreams` - For live streaming (NEW!)
4. Enable Storage for media uploads and live stream segments
5. Update the configuration in `src/config/firebase.js`
6. **Deploy security rules** for live streaming:
   - Copy rules from `firestore-livestream-rules.txt` to Firestore Rules
   - Copy rules from `storage-livestream-rules.txt` to Storage Rules

## 📡 Live Streaming Documentation

Complete documentation for the new live streaming feature:

- **[START-HERE.md](./START-HERE.md)** - Quick start guide (READ THIS FIRST!)
- **[README-LIVESTREAM.md](./README-LIVESTREAM.md)** - Feature overview
- **[LIVESTREAM_IMPLEMENTATION.md](./LIVESTREAM_IMPLEMENTATION.md)** - Technical deep dive
- **[ARCHITECTURE-DIAGRAM.md](./ARCHITECTURE-DIAGRAM.md)** - Visual system diagrams
- **[DEPLOYMENT-CHECKLIST.md](./DEPLOYMENT-CHECKLIST.md)** - Step-by-step deployment
- **[BEFORE-AFTER-COMPARISON.md](./BEFORE-AFTER-COMPARISON.md)** - What changed and why

### Quick Start - Live Streaming

1. Deploy Firebase rules (5 minutes)
2. Add "Go Live" button to your Profile screen
3. Test on device
4. Submit to Google Play Store!

See [`START-HERE.md`](./START-HERE.md) for complete instructions.

## Project Structure

```
src/
├── components/           # Reusable UI components
│   ├── TabBarIcon.js    # Bottom tab navigation icons
│   └── CreatePostButton.js # Floating action button
├── screens/             # App screens
│   ├── HomeScreen.js    # Main feed and timeline
│   ├── AuthScreen.js    # Login and registration
│   ├── CameraScreen.js  # Camera capture interface
│   ├── ReviewScreen.js  # Post creation and editing
│   ├── VoiceMemoScreen.js # Audio recording
│   ├── ChatScreen.js    # Chat and games
│   ├── MessengerScreen.js # Direct messaging
│   └── ProfileScreen.js # User profile
├── services/            # External service integrations
│   └── firebase.js      # Firebase initialization
└── config/              # App configuration
    └── firebase.js      # Firebase config constants
```

## Building for Production

### Android (Google Play Store)

1. **Use the canonical Android release path only**
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <versionCode>
   ```

2. **Upload the frozen artifact from the generated packet**
   - Upload `diagnostics/release_aab/CANONICAL_PLAY_AAB_<timestamp>/app-release.aab` to Google Play.

3. **Optional: submit the completed build after validation**
   ```bash
   eas submit --platform android --profile production
   ```

4. **Do not use legacy Android build routes**
   - `eas build --platform android` is non-canonical for Blyp Android release creation.

### iOS (App Store)

1. **Build for iOS**
   ```bash
   eas build --platform ios
   ```

2. **Submit to App Store**
   ```bash
   eas submit --platform ios
   ```

## Development Commands

- `npm start` - Start Expo development server
- `npm run android` - Run on Android emulator/device
- `npm run ios` - Run on iOS simulator/device
- `npm run web` - Run in web browser
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <versionCode>` - Canonical Android Play AAB build
- `eas build --platform ios` - Build iOS IPA

## Environment Variables

Client-facing variables are read by Expo and must be prefixed with
`EXPO_PUBLIC_`. Per-build values are defined in `eas.json`; for local dev create
a `.env` (gitignored) with the keys you need, e.g.:

```
# AI
EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_api_key

# AWS (Cognito identity + IVS live)
EXPO_PUBLIC_AWS_REGION=eu-west-2
EXPO_PUBLIC_AWS_USER_POOL_ID=...
EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID=...
EXPO_PUBLIC_AWS_IDENTITY_POOL_ID=...

# Backends
EXPO_PUBLIC_LIVE_SERVICE_URL=https://<live-service-host>      # Node live/economy service
EXPO_PUBLIC_FUNCTIONS_BASE_URL=https://<region>-<project>.cloudfunctions.net

# Feature flags
EXPO_PUBLIC_ENABLE_STREAMING=1
```

Firebase web config has safe defaults baked into `src/config/firebase.js` and
can be overridden locally via a gitignored `src/config/firebase.local.js`
(see `src/config/firebase.local.sample.js`).

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues:

1. Check the [Expo documentation](https://docs.expo.dev/)
2. Review [React Native documentation](https://reactnative.dev/docs/getting-started)
3. Check [Firebase documentation](https://firebase.google.com/docs)
4. Create an issue in this repository

## Acknowledgments

- Built with [Expo](https://expo.dev/)
- UI inspired by modern social media platforms
- Icons by [Ionicons](https://ionic.io/ionicons)
- Firebase for backend services
