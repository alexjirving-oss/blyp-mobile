# Repo State — Executive Summary (Current)

Project: Blyp (slug: blyp-mobile)
Date: 2025-11-05
Git: master @ 45f0e46 (dirty)
Node: v22.20.0 • RN 0.81.5 • Expo ~54.0.22 • JDK 17.0.16

## Traffic-light overview

- TypeScript: GREEN — tsc --noEmit passed (0 errors)
- Lint/Format: RED — ESLint failed (exit 2), 399 files need Prettier
- Dependencies: AMBER — Health checks incomplete (depcheck/outdated/audit skipped/failed)
- Security: AMBER — No secrets found beyond EXPO_PUBLIC values; npm audit skipped
- Build/Config: AMBER — expo-doctor flagged app.json vs app.config.js duplication; ANDROID_HOME not set
- Firebase Rules: GREEN — auth-gated read/write in firestore.rules and storage.rules
- Secrets Hygiene: AMBER — .env.example present; EXPO_PUBLIC Cognito IDs committed in eas.json
- Media Pipeline: GREEN — HLS services present; expo-av used for playback/recording
- Tests: RED — Jest run failed (no output)
- Bundle Size: AMBER — Bundle estimate failed (react-native CLI error)

## Top 10 Risks

1) ESLint failing blocks CI quality gates — Evidence: findings/probe5_eslint.log — Mitigation: Fix ESLint config/run; run npx eslint . locally
2) Formatting debt (399 files) inflates diffs — Evidence: findings/probe5_prettier.log — Mitigation: Prettier pass + pre-commit hook
3) Expo config duplication can cause inconsistent builds — Evidence: findings/probe7_expo_doctor.log — Mitigation: Remove app.json or ensure app.config.js fully mirrors it
4) Android SDK env not configured — Evidence: findings/probe1_snapshot_env.log — Mitigation: Set ANDROID_HOME/ANDROID_SDK_ROOT; ensure SDK platforms installed
5) Test suite failing/no coverage — Evidence: findings/probe11_jest.log — Mitigation: Fix jest setup; run npx jest --ci and stabilize tests
6) Dependency health unknown (audit/outdated skipped) — Evidence: findings/probe6_* — Mitigation: Run npm outdated/audit; triage updates and vulns
7) Bundle size unknown — Evidence: findings/probe12_bundle.log — Mitigation: Use metro/CLI to bundle to _reports/current_state/bundle and record size
8) Secrets visibility in repo (public IDs) — Evidence: findings/probe9_secrets_scan.log — Mitigation: Confirm EXPO_PUBLIC only; move any private keys to env/Secrets
9) Preflight for Dev Client not validated — Evidence: findings/probe7_expo_doctor.log — Mitigation: Run expo prebuild on CI/CD runner for release builds (not required for dev)
10) HLS cleanup job coverage not verified — Evidence: code refs; no runtime proof — Mitigation: Add scheduled cleanup/GC verification tests

## Next 10 Actions

1) Run Prettier write across repo and enable pre-commit
2) Fix ESLint config and address high-priority errors
3) Remove app.json or fully consolidate with app.config.js
4) Set ANDROID_HOME/ANDROID_SDK_ROOT; verify platform 34 installed
5) Run npm outdated/audit; update minors and patch critical vulns
6) Get Jest green on a smoke test; add coverage later
7) Generate JS bundle via metro; track modules and bytes
8) Confirm Firebase emulators or staging keys; check rules tests
9) Create Dev Client APK via EAS development profile and sideload
10) Add basic CI to run formatting/lint/tests on PRs
