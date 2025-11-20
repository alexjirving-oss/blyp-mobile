# 🚀 Blyp Mobile - Production Build & Deployment Guide

## 📋 Pre-Build Checklist

### ✅ Step 1: Download Assets
Run the asset download script to get placeholder icons:
```powershell
.\download-assets.ps1
```

OR create your own custom assets in `/assets/`:
- `icon.png` (1024x1024)
- `adaptive-icon.png` (1024x1024) 
- `splash.png` (1284x2778)
- `favicon.png` (32x32)

### ✅ Step 2: Test Locally
```bash
npm start
# Scan QR code with Expo Go to test all features
```

### ✅ Step 3: Install EAS CLI
```bash
npm install -g @expo/eas-cli
```

### ✅ Step 4: Login to Expo
```bash
eas login
# Enter your Expo account credentials
```

## 🔨 Building for Android

### Development Build (for testing)
```bash
eas build --profile development --platform android
```

### Production Build (for Google Play Store)
```bash
# Create production APK for testing
eas build --profile preview --platform android

# Create production AAB for Play Store
eas build --profile production --platform android
```

## 📱 Google Play Store Deployment

### Option 1: Automatic Submission (Recommended)
```bash
# Submit directly to Google Play Store
eas submit --platform android

# Follow prompts to upload your Google Play service account key
```

### Option 2: Manual Upload
1. Download the `.aab` file from your EAS build
2. Go to [Google Play Console](https://play.google.com/console)
3. Upload the AAB file to your app
4. Complete the store listing and publish

## 🍎 iOS App Store (Optional)

### Build for iOS
```bash
eas build --profile production --platform ios
```

### Submit to App Store
```bash
eas submit --platform ios
```

## 🔧 Troubleshooting

### Build Errors
- **Asset errors**: Make sure all assets exist in `/assets/` folder
- **Firebase errors**: Verify Firebase config in `src/config/firebase.js`
- **Permission errors**: Check that all permissions are listed in `app.json`

### Common Solutions
```bash
# Clear cache and rebuild
expo r -c
eas build --clear-cache --platform android

# Update dependencies
npm install
npx expo install --fix

# Check build logs
eas build:list
```

## 📊 Build Status

You can monitor your builds at:
- EAS Dashboard: https://expo.dev/accounts/[your-username]/projects/blyp-mobile/builds
- Or run: `eas build:list`

## 🎯 Production Checklist

Before submitting to Google Play:

- [ ] Test app thoroughly on real device
- [ ] Replace placeholder assets with custom designs
- [ ] Update app version in `app.json`
- [ ] Set proper app name and description
- [ ] Configure store listing (screenshots, descriptions)
- [ ] Test Firebase functionality (auth, posts, media upload)
- [ ] Verify all permissions work correctly
- [ ] Test camera, voice recording, and media features

## 🚀 Launch Commands

```bash
# Complete production workflow:

# 1. Download assets (if using placeholders)
.\download-assets.ps1

# 2. Test locally
npm start

# 3. Build for production
eas build --platform android

# 4. Submit to Google Play
eas submit --platform android
```

## 📞 Support

If you encounter issues:
- Check [Expo EAS documentation](https://docs.expo.dev/build/introduction/)
- Review [Google Play Console help](https://support.google.com/googleplay/android-developer/)
- Check Firebase setup at [Firebase Console](https://console.firebase.google.com/)

Your Blyp mobile app is ready for the world! 🌟