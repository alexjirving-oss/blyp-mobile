# Blyp IVS Android Dev Build Guide

## Prerequisites
- Expo account and EAS CLI installed (`npm i -g eas-cli`).
- Android device or emulator. Physical device preferred for camera/mic.
- Backend reachable from device (set `EXPO_PUBLIC_API_BASE_URL` to your LAN IP).
- Dev client built with IVS native modules (Expo Go will NOT work).

## Build the dev client (Android)
```bash
# From repo root
# Ensure .env/.env.development includes EXPO_PUBLIC_API_BASE_URL and EXPO_PUBLIC_STREAMING_BACKEND=ivs
eas build -p android --profile development
```
- Wait for build to finish; download/install APK via QR or link from Expo.

## Run with the dev client
```bash
# From repo root
npx expo start --clear
# In the dev client on device, scan the QR (exp+ scheme) to connect to Metro.
```

## Expected runtime checks
- App logs `[IVS_API][CONFIG] { API_BASE_URL: ... }` from `ivsLiveApi.ts`.
- App logs `[IVS_NATIVE][CONFIG]` with backend and native module availability.
- If native modules are missing (Expo Go), `IVS native modules not found...` will throw immediately.

## Go Live flow (host)
1. Open Live screen (mode host).
2. Tap Go Live → app calls backend `/ivs/host/start` with Cognito auth.
3. On success, native IVS broadcast starts; events flow via `IVSBroadcastModule`.

## Viewer flow
1. Navigate as viewer.
2. App calls `/ivs/viewer/join` and passes playback URL to `IVSPlayerModule`.

## Troubleshooting
- **Native modules missing**: Ensure you installed the EAS dev client build; Expo Go cannot load IVS.
- **Network errors**: Verify `EXPO_PUBLIC_API_BASE_URL` uses device-reachable IP/port and backend is running.
- **Permissions**: Camera/mic must be granted on device.
