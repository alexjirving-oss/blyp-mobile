<!-- Workspace-specific rules for AI coding agents working on Blyp Mobile -->

# Blyp Mobile — Copilot instructions (React Native + Expo)

Purpose: give AI agents the minimal, code-backed context to ship changes safely. Keep edits small, reuse utilities, and reference files by path.

## Big picture
- Entry: `App.js` wires Bottom Tabs + Stack. Heavy routes are lazy via `React.lazy` with `<Stack.Screen name="X" children={() => <Suspense>…</Suspense>}/>` (see Camera/Review/MediaViewer/LiveStream/Games).
- Auth: Cognito via `src/hooks/useCommon.js` (`useAuth()`); token cleanup in `src/config/preAuthCleanup.js`; Amplify boot in `src/config/amplify.js`. UI uses a short “sticky” auth window to avoid post-login bounce.
- Firebase: single wrapper `src/config/firebase.js` exposes compat-style `db.collection(...).doc(...).onSnapshot(...)` plus modular exports `{firestore, storage, auth, firebaseEnabled}`. If `EXPO_PUBLIC_DISABLE_FIREBASE=1` or missing `apiKey` → stub mode; code must tolerate `firebaseEnabled === false`.
- Live streaming: segment upload/indexing in `src/services/HLSLiveStreamService.js`; presence/chat in `src/services/LiveService.js`; viewing in `src/components/LiveStreamViewer.js` which preloads next segments for seamless playback.

## Source layout (what to touch)
- Screens: `src/screens/*` (e.g., `HomeScreen.js`, `CameraScreen.js`, `LiveStreamScreen.js`).
- Components: `src/components/*` (e.g., `CreatePostButton.js`, `LiveStreamViewer.js`).
- Services: `src/services/*` (`HLSLiveStreamService.js`, `LiveService.js`, `FirestoreLiveService.ts`).
- Config/flags: `src/config/firebase.js`, `src/config/StreamingFeatureFlag.js`, {ENTER} `src/config/amplify.js`, `src/config/preAuthCleanup.js`.
- Monitoring: `src/monitoring/sentry.js` initializes only if `EXPO_PUBLIC_SENTRY_DSN` is set.

## Conventions that matter
- Never import Amplify/Firebase SDKs directly in screens; go through hooks/services. For Firestore, prefer the compat wrapper shown in `src/config/firebase.js` within a given file.
- Live model: `liveStreams/{streamId}` with `segments.{n}.url`, `currentSegment`, `lastSegmentUploadedAt`, `likes`, and subcollections `comments/` and `likes/`. Comments stream via `.../comments` ordered by `timestamp`.
- Streaming flag: `src/config/StreamingFeatureFlag.js` provides `primeStreamingFlag()`, `isLiveStreamingEnabled()` (optimistic) and `isLiveStreamingEnabledAsync()`. Remote toggle lives at `appConfig/streaming.enabled`.
- Navigation: add routes in `App.js` and follow the lazy `<Suspense>` pattern for heavy screens.
- Auth gating: use `useAuth()`; when a Firebase UID is needed, read `auth.currentUser` from the Firebase wrapper.

## Developer workflows (Windows)
- Fast start: `./start-app.ps1` (cleans cache, ADB reverse, sets LAN/Tunnel and port). Health check: `./check-status.ps1`.
- Manual: Expo Go → `npx expo start --clear`; Dev Client → `npx expo start --dev-client --port 8083 --host lan|--tunnel` (avoid 127.0.0.1 on physical devices; prefer LAN/Tunnel).
- Build/submit: `eas build --platform android` then `eas submit --platform android`. Dev client builds: `--profile development` (see `eas.json`).
- Lint/type/tests: `npm run lint`, `npm run typecheck`, `npm test`, and Firestore/Storage rules `npm run test:rules`.
- Perf/bundle: `npm run bundle:android` then `npm run perf:analyze` (reports in `_reports`).

## Streaming notes (copy these patterns)
- Write segments via `HLSLiveStreamService.uploadSegment(streamId, uri, n)`; it updates `liveStreams/{id}`: `currentSegment` and `segments.{n}`. Old segments are cleaned proactively.
- View with `<LiveStreamViewer streamId={id} />`; the component preloads next chunks and tracks `viewCount` via `HLSLiveStreamService.updateViewCount()` on mount/unmount.
- Presence/chat: use `LiveService` helpers (e.g., `subscribeToComments`, `sendMessage`), not direct Firestore writes from components.

## Env & switches
- Keys via `EXPO_PUBLIC_*` (Firebase, Gemini, Sentry). If Firebase is stubbed, listeners still fire with empty snapshots—UI must handle no data paths.

If anything above conflicts with code, prefer the referenced files and update this doc accordingly.

## Quick examples (use these exact patterns)
- Add a lazy screen in `App.js`:
	- `const XScreen = React.lazy(() => import('./src/screens/XScreen'));`
	- `<Stack.Screen name="X" children={() => (<Suspense fallback={null}><XScreen/></Suspense>)} />`
- Prime streaming flag on app start (in `App.js` top-level module scope):
	- `import { primeStreamingFlag } from './src/config/StreamingFeatureFlag'; primeStreamingFlag();`
- Firestore access in screens/components: use the compat wrapper:
	- Do: `db.collection('liveStreams').doc(id).onSnapshot(...)`
	- Don’t: import Firestore SDK directly in screens.

[start-app.ps1](http://_vscodecontentref_/11) -DevClient -Tunnel