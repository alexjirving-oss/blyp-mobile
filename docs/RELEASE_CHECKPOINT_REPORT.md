# Release Checkpoint Report

HISTORICAL ONLY - NON-CANONICAL - DO NOT USE FOR RELEASE.
Current canonical Android Play-upload AAB path:
`powershell -NoProfile -ExecutionPolicy Bypass -File .\\tools\\release\\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <versionCode>`

For each packet gate, record:
- Git commit SHA
- Tests/lint/typecheck commands + raw output location
- Build command + raw output location
- Artifact path + size + sha256
- Android: applicationId, versionName, versionCode

## Checkpoint 0 (Baseline)

- Branch: mega/max-success-packets-1-4
- Commit: 44a64ff

## Checkpoint 1 (After Packet 1)

- Status: BLOCKED (Android release signing not configured locally)

- Branch: mega/packet1-session-persist
- Commit: HEAD

### Summary

- What was wrong: After a hard close / cold start, Cognito could intermittently present as logged-out because the synchronous Cognito storage adapter relies on an in-memory mirror, and that mirror was not always hydrated on startup when no malformed keys were found.
- What changed: Startup pre-auth cleanup now always hydrates the Cognito storage mirror (even when no Cognito keys need removal). Auth restore adds one-shot logs to prove restore lifecycle without spamming (since restore polling runs regularly).
- Where persistence lives: AsyncStorage remains the source of truth for Cognito token/session keys; `src/lib/auth/cognitoStorage.js` mirrors into an in-memory cache for synchronous reads.

### Files Touched (Packet 1)

- `src/config/preAuthCleanup.js`
- `src/hooks/useCommon.js`
- `jest.setup.js` (test infra: mock `expo-video-thumbnails` for Jest)

### Manual Verification Steps

1. Sign in successfully.
2. Hard close the app (swipe away / force-stop).
3. Re-open the app.
4. Confirm the app restores auth state (does not flash logged-out UI) and emits a single `[AUTH_RESTORE_START]` followed by `[AUTH_RESTORE_SUCCESS]` (or `[AUTH_RESTORE_FAILED]` if it cannot restore).

### Commands Run (Local)

- `npm run lint` (PASS)
- `npm run typecheck` (PASS)
- `npm test` (PASS)

### Android Build Checkpoint

- Build command (historical/non-canonical): `android/gradlew :app:bundleRelease`
- Build output log: `logs/packet1_bundleRelease.txt`
- Result: FAIL (`Release signing is not configured. Set BLYP_RELEASE_STORE_FILE, BLYP_RELEASE_STORE_PASSWORD, BLYP_RELEASE_KEY_ALIAS, BLYP_RELEASE_KEY_PASSWORD via gradle.properties or environment variables.`)
- Artifact: none generated after cleaning old outputs (`NO_RELEASE_ARTIFACT_FOUND`)

### Notes

- Precondition: `src/screens/UserProfileScreen.js` had syntax issues preventing lint/typecheck; fixed in separate commit `6e0e923` (not part of Packet 1 diff set).

### Android Version Evidence (file:line)

- `android/app/build.gradle:96: applicationId 'com.blyp.mobile'`
- `android/app/build.gradle:99: versionCode 13`
- `android/app/build.gradle:100: versionName "1.0.1"`

## Checkpoint 2 (After Packet 2)

- Status:

## Checkpoint 3 (After Packet 3)

- Status:

## Checkpoint 4 (After Packet 4)

- Status:
