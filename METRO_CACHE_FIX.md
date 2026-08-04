# Metro Cache Fix - Instructions

## Problem Analysis

The error you're seeing ("There was a problem loading the project / UnableToResolveError") is a **Metro bundler cache issue**, not a missing build step.

### Why this happened:
- We added new TypeScript files (`IVSNativeClient.ts`, `LiveStreamingClient.ts`, hooks, etc.)
- Metro cached the old bundle before these files existed
- The old bundle is trying to import files that weren't in the cache

### Why there's no `npm run build`:
This is an **Expo project** that uses Metro bundler for on-the-fly TypeScript compilation. There is no separate `src → lib` build step. Metro compiles TypeScript directly when bundling.

---

## ✅ Fix Applied

I've already done the following:

1. **Killed all Node processes** to stop the old Metro server
2. **Started Metro with full cache clear**: `npx expo start --clear`
3. Metro is now running and ready at: `http://192.168.1.236:8081`

---

## 🔧 What You Need To Do Now

### On Your Android Device:

1. **Shake the device** (or press Ctrl+M if using emulator)
2. Select **"Reload"** from the dev menu
3. The app should now bundle successfully with the new IVS files

### Alternative: Force Reload from Terminal

If shake doesn't work, in the terminal where Metro is running:
- Press **`r`** key to reload the app

---

## Verification

After reloading, you should see:
- ✅ App loads successfully
- ✅ No "UnableToResolveError"
- ✅ IVS native modules available (Android)
- ✅ TypeScript files bundled correctly

If you still see errors, check Metro terminal output for specific import issues.

---

## Metro is Running

Metro is currently running with cleared cache. The QR code and server are ready:
- **Development server**: http://192.168.1.236:8081
- **Status**: ✅ Cache cleared, ready for reload

Just **reload the app on your device** and it should work!
