# TODO

**Current product backlog:** [`docs/ops/PRODUCT_TODO.md`](docs/ops/PRODUCT_TODO.md) — live bugs, teams, admin, onboarding (Open / Parked / Done).

---

## Legacy baseline (Automated)

Generated: 2025-10-31

## Types
- FAIL: TypeScript check found 9 errors:
  - blyp-multiplayer-games/src/types/gameTypes.js uses TypeScript `interface` syntax in .js (3 errors)
  - Duplicate copies under `#1/` and `backup/` also reported (6 errors)
- Action:
  - Exclude `#1/` and `backup/` from tsconfig and tooling.
  - Convert `blyp-multiplayer-games/src/types/gameTypes.js` to `.ts` or refactor to JSDoc typedefs.

## Lint/Format
- FAIL: Prettier check errored due to syntax in `gameTypes.js` and flagged formatting in many files.
- Action:
  - Add a `.prettierignore` to exclude `#1/`, `backup/`, `android/app/google-services.json`, and other generated/secret files.
  - Run Prettier after excluding noise.

## RN/Expo
- WARN: Expo Doctor — project has native folders; some app.json fields won’t sync in EAS (generic workflow).
- Action:
  - Confirm prebuild/bare workflow assumptions; ensure android/ios settings managed directly in native if needed.

## Android
- PASS: Gradle wrapper validated — Gradle 8.8, Kotlin 1.9.22, Java 17 OK.
- Action:
  - Review AndroidManifest permissions and network security config for Play Store readiness.

## iOS
- N/A (Android primary). No baseline checks run.

## Auth (Cognito)
- INFO: Auth flow fixes in hooks/screens pending validation in runtime. No static errors yet.
- Action:
  - Centralize Amplify Auth adapter and add minimal tests.

## Firebase
- INFO: Single init present under `src/config/firebase.js`. Rules and indexes files present.
- Action:
  - Add guard by `EXPO_PUBLIC_DISABLE_FIREBASE`; stage rules review.

## Streaming
- INFO: Multiple viewer/broadcaster components; HLS pipeline present.
- Action:
  - Add low-latency HLS options and retry/metrics hooks.

## Config/Security
- WARN: `android/app/google-services.json` committed; treat as secret.
- Action:
  - Prevent printing or uploading; document env-driven setup.

---

## Next (Config normalization)
- Add/normalize scripts: typecheck, lint, lint:fix, format, test, build:eas:android, submit:eas:android, clean.
- Harden tsconfig (strict) with excludes to avoid noise.
- Create ESLint + Prettier configs and ignore files.
- Add `.env.example` and docs for EXPO_PUBLIC_*.
