<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# Blyp Mobile - React Native Expo App

This is a React Native social media app built with Expo that converts the original HTML/JavaScript Blyp web app into a native mobile application suitable for Google Play Store deployment.

## Project Status: ✅ COMPLETE

All core features have been successfully implemented:

- ✅ **Project Structure**: Expo React Native app with proper navigation
- ✅ **Authentication**: Firebase Auth with login/signup screens  
- ✅ **Main Features**: Home feed, Camera capture, Voice memos, Profile screen
- ✅ **Firebase Integration**: Firestore database, Storage for media uploads
- ✅ **UI Components**: Modern dark theme with gradient animations
- ✅ **Navigation**: Bottom tabs with stack navigation for screens
- ✅ **Media Capture**: Camera photos/videos and audio recording
- ✅ **Social Features**: Post creation with platform sharing options
- ✅ **Build Configuration**: EAS build setup for Google Play Store

## Next Steps for Production

1. **Add Firebase Config**: Update `src/config/firebase.js` with your Firebase project credentials
2. **Add Assets**: Create app icons and splash screens in `/assets` folder
3. **Test Features**: Run `npm start` and test on device with Expo Go
4. **Build APK**: Use `eas build --platform android` to create production build
5. **Deploy**: Submit to Google Play Store using `eas submit --platform android`

## Development Commands

- `npm start` - Start development server
- `npm run android` - Run on Android
- `npm install` - Install dependencies
- `eas build --platform android` - Build for production

The app is ready for testing and deployment!