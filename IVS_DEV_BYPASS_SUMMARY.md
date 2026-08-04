# IVS Dev Bypass Implementation

## Problem
The app was throwing an authentication error when trying to start a live stream:
```
[IVS_HOST][START_ERROR] [TypeError: this.jwtToken.split is not a function (it is undefined)]
```

Root cause: The backend API server at `http://192.168.1.236:3001` is not running, and the app couldn't get a JWT token from Cognito for the API call.

## Solution
Implemented a development bypass mode that generates mock IVS tokens locally without needing a backend server.

## Changes Made

### 1. Enhanced JWT Token Handling (`src/hooks/useCommon.js`)
- Added defensive checks for `getIdToken()` and `getJwtToken()` return values
- Added validation that JWT token is a string and has correct structure (3 dot-separated parts)
- Added better error logging with specific failure points
- Prevents the "undefined.split is not a function" error

### 2. API Client Dev Bypass (`src/api/ivsLiveApi.ts`)
- Added `EXPO_PUBLIC_IVS_DEV_BYPASS` environment flag
- Implemented `generateMockToken()` function to create mock JWT tokens with proper structure
- Implemented `generateMockResponse()` to create complete IVS join responses
- Updated `ivsHostStart()`, `ivsGuestJoin()`, and `ivsViewerJoin()` to check dev bypass flag first
- If dev bypass is enabled, returns mock response without calling backend
- Uses React Native compatible base64 encoding (btoa or Buffer fallback)

### 3. Environment Configuration (`.env`)
- Commented out `EXPO_PUBLIC_API_BASE_URL` (backend not running)
- Added `EXPO_PUBLIC_IVS_DEV_BYPASS=1` to enable mock token generation
- Kept `EXPO_PUBLIC_STREAMING_BACKEND=ivs` to force IVS backend selection

## Testing
The dev bypass allows you to:
1. Navigate to Go Live screen
2. Press "Start Broadcast"
3. Get a mock IVS stage ARN and participant token
4. Proceed to native IVS module calls (which will reject with IVS_NOT_IMPLEMENTED since they're stubs)

## Next Steps

### When You Have a Real Backend:
```env
# Disable dev bypass
# EXPO_PUBLIC_IVS_DEV_BYPASS=1

# Configure backend URL
EXPO_PUBLIC_API_BASE_URL=http://your-backend-server:3001
```

### To Implement Real IVS SDK:
1. Replace stub methods in `android/app/src/main/java/com/blyp/mobile/ivs/` with actual IVS SDK calls
2. Implement proper token validation and error handling
3. Connect to real AWS IVS stages

## Mock Token Structure
Generated tokens are valid JWTs with:
- Header: `{ alg: 'HS256', typ: 'JWT' }`
- Payload: `{ sub: 'dev-user', iat, exp, streamId, role }`
- Signature: mock (not verified in dev mode)
- Expiration: 24 hours from generation

These are sufficient for passing through the native module layer but won't work with real AWS IVS services.
