# Blyp Mobile - React Native Social Media App

A modern social media app built with React Native and Expo, featuring camera capture, voice memos, Firebase integration, and cross-platform social sharing.

## Features

- 🎥 **Camera & Video Recording** - Take photos and record videos with front/back camera switching
- 🎙️ **Voice Memos** - Record and playback voice notes with audio visualization
- 📱 **Social Media Integration** - Share to Facebook, Instagram, TikTok, and YouTube
- 🔥 **Firebase Backend** - Real-time database, authentication, and cloud storage
- 🎨 **Modern UI** - Dark theme with gradient animations and smooth transitions
- 👥 **Chat & Games** - Social features including chat rooms and mini-games
- 📬 **Messenger** - Direct messaging and notifications system

## Technology Stack

- **React Native** with Expo SDK 50
- **Firebase** (Auth, Firestore, Storage)
- **Expo Camera** for media capture
- **Expo AV** for audio recording and playback
- **React Navigation** for screen navigation
- **Linear Gradient** for modern UI effects

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
4. Enable Storage for media uploads
5. Update the configuration in `src/config/firebase.js`

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

1. **Install EAS CLI**
   ```bash
   npm install -g @expo/eas-cli
   ```

2. **Configure EAS**
   ```bash
   eas build:configure
   ```

3. **Update app.json**
   - Set your unique `android.package` name
   - Update version codes and app metadata
   - Add proper icons and splash screens

4. **Build APK/AAB**
   ```bash
   eas build --platform android
   ```

5. **Submit to Google Play**
   ```bash
   eas submit --platform android
   ```

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
- `eas build --platform android` - Build Android APK/AAB
- `eas build --platform ios` - Build iOS IPA

## Environment Variables

Create a `.env` file with:

```
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com  
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
GEMINI_API_KEY=your_gemini_api_key (optional)
```

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