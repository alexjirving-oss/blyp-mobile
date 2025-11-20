# Blyp Mobile – Full-folder Audit (TikTok-style app)

Date: 2025-10-28

This audit reviews structure, correctness, clumsy areas, and actionable cleanups for a short‑video (TikTok-like) React Native + Expo app.

## Executive summary

- Overall architecture is sound: Expo + React Navigation, Firebase backend, modular screens/services/components.
- The biggest risk was mixed Firebase SDKs (Web vs React Native) causing uploads to fail and media not to load. Migration to React Native Firebase has started; scope remains across many files.
- Media fallbacks pointed at sample-videos.com caused timeouts and black screens; removed in critical paths.
- Logging is excessively verbose and sometimes duplicated; consider reducing noisy logs in production.
- Many one-off scripts exist in project root. Good for maintenance, but should be grouped under a scripts/ folder and documented.

## What is correct

- Expo 51 / RN 0.74 stack with dev client, EAS config, plugins configured.
- Navigation and screen separation for Home, Profile, Messenger, Live stream, Review flow.
- EnhancedVideo component centralizes expo-av video behavior and caching.
- Feature flags (e.g., streaming), environment docs, and automation scripts show strong operational maturity.

## What’s clumsy

- Mixed Firebase SDK usage. Files import from `firebase/*` alongside React Native Firebase. Leads to binary upload issues and inconsistent auth/storage behavior.
- Fallback media URLs to external sample sites in Home screen and mock data trigger device timeouts and black screens.
- Frequent console logs (including heavy object dumps) clutter runtime and may degrade performance.
- Duplicate/legacy variants under `#1/` and `blyp-multiplayer-games/` increase cognitive load.

## What’s likely wrong

- Firestore writes with `undefined` fields (e.g., `thumbnail`) cause errors. Must set null or omit.
- Storage upload using Web SDK `uploadBytes` with Blobs on React Native fails. Must use RNFirebase `putFile(uri)`.
- Many screens/services still import from `firebase/*` and need migration to RNFirebase chain APIs.

## High‑impact fixes (done now)

- ReviewScreen: migrate upload path to React Native Firebase, guard `thumbnail: null`.
- HomeScreen: removed `sample-videos.com` fallbacks that caused timeouts.
- mockData: removed external sample video URLs to avoid unexpected network calls.

## Migration plan: Firebase Web -> React Native Firebase

1. Create a thin adapter (`src/config/firebaseAdapter.ts`) that maps common operations used across the app to RNFirebase APIs, so screens can import from one place.
   - Auth: `currentUser`, `signInAnonymously`, `signOut`.
   - Firestore: `collection(name)`, `doc(name,id)`, read/write helpers, `serverTimestamp`.
   - Storage: `ref(path)`, `getDownloadURL`, `putFile(uri)`, `delete()`, `listAll()`.
2. Replace imports of `firebase/*` with adapter across src/ (97 matches found). Do in batches by feature area to keep changes safe.
3. Remove direct Web SDK dependency from package.json once migration is complete.

## Media pipeline recommendations

- Keep EnhancedVideo simple. Avoid background downloads on unreliable networks or gate with a short timeout.
- Ensure all video URIs are real Storage HTTP URLs (no token? handle 403/412 with a retry/refresh strategy if needed).
- Thumbnails: generate client-side for videos when posting (already present) and store under `users/{uid}/thumbnails/`.

## Cleanups & structure

- Group maintenance scripts under `scripts/` with READMEs.
- Create `src/adapters/` for Firebase adapter and any platform shims.
- Add ESLint + Prettier to enforce consistent style and catch undefined fields.
- Reduce `console.log` noise; add debug flag/toggle.
- Remove or archive `#1/` legacy folder once parity is confirmed.

## Prioritized next steps

1. Complete Firebase migration in Chat, Followers, LiveStream, Profile screens and services (see list from search).
2. Add a small `useStorageUrl` helper that normalizes Storage URLs and optionally HEAD-checks with quick timeout.
3. Introduce a `Post` type and validation before write (strip undefineds).
4. Add smoke tests: open Home, scroll 5 videos, open Profile, post Photo -> assert Firestore write and Storage URLs exist.

## Appendix: Files still using Web SDK (sampling)

- src/screens/ChatListScreen.js, CommentsScreen.js, ProfileScreen.js, MediaViewerScreen.js
- src/services/HLSLiveStreamService.js, ScalableHLSService.js, LiveStreamService.js, EnterpriseStorageService.js
- src/utils/activityTracker.js, followUtils.js, searchService.js, firebaseStorageFix.js

Use grep: `from 'firebase/` (97 matches) to migrate.
