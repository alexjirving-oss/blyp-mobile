# LiveStream Feature Rollback Plan

This document outlines how to re-enable or disable the LiveStream feature in the Blyp Mobile app.

## Current Status

The LiveStream feature is currently **DISABLED** to resolve display issues in the HomeScreen.

## How the Feature Flag Works

The app uses a multi-layered feature flag system for LiveStreaming:

1. **Build-time flag** (in `src/config/StreamingFeatureFlag.js`):
   ```javascript
   export const BUILD_ENABLE_LIVE_STREAMING = false; // Currently disabled
   ```

2. **Remote override** (in Firestore):
   - Collection: `appConfig`
   - Document: `streaming`
   - Fields:
     - `enabled`: Boolean (true/false)
     - `reason`: String (optional)
     - `updatedAt`: Timestamp

3. **Local user override** (AsyncStorage):
   - Can be set using `setLocalOverride()` function

## Re-enabling the LiveStream Feature

### Option 1: Build-time Change (Recommended for Testing)

1. Edit `src/config/StreamingFeatureFlag.js`
2. Change `BUILD_ENABLE_LIVE_STREAMING` from `false` to `true`
3. Save the file and restart the app

```javascript
// Change this line
export const BUILD_ENABLE_LIVE_STREAMING = false;

// To this:
export const BUILD_ENABLE_LIVE_STREAMING = true;
```

### Option 2: Remote Toggle (Recommended for Production)

1. Go to Firebase Console
2. Navigate to Firestore Database
3. Create or edit document: `appConfig/streaming`
4. Set fields:
   ```
   enabled: true
   reason: "Feature re-enabled after fixing [issue]"
   updatedAt: [server timestamp]
   ```
5. Within 60 seconds, all users will have the feature re-enabled

## Monitoring After Re-enabling

After re-enabling the feature, monitor for:

1. **Performance Issues**: 
   - Excessive memory usage
   - UI freezing
   - Slow HomeScreen loading

2. **Error Logs**: 
   - Watch Firebase Analytics for crashes
   - Check console logs for LiveStream-related errors

## Emergency Disable

If issues reoccur after re-enabling:

1. **Remote Emergency Disable** (fastest, affects all users):
   - In Firebase Console, set `appConfig/streaming.enabled = false`

2. **Code Rollback** (requires app update):
   - Revert to `BUILD_ENABLE_LIVE_STREAMING = false`
   - Deploy app update

## Technical Notes

- The `LiveStreamsFeed` component in HomeScreen is conditionally rendered based on the feature flag
- When disabled, the component won't mount and no network requests will be made
- User experience is seamless whether enabled or disabled - the flag simply determines whether the LiveStream UI elements appear

## Testing After Changes

Run the included test script to verify configuration:
```
node test-app-loading.js
```