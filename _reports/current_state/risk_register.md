# Risk Register

| Rank | Risk | Impact | Prob. | Evidence | Mitigation | Owner |
|------|------|--------|-------|----------|------------|-------|
| 1 | ESLint failing (exit 2) | Medium dev friction/bug slip | High | findings/probe5_eslint.log | Fix config/rules; resolve top 20 errors; add CI | Eng |
| 2 | Formatting debt (399 files) | High merge conflicts | High | findings/probe5_prettier.log | Run Prettier, add pre-commit | Eng |
| 3 | Expo config duplication | Medium build inconsistency | Medium | findings/probe7_expo_doctor.log | Remove app.json or unify with app.config.js | Eng |
| 4 | Android SDK env not set | Blocks local Android tasks | Medium | findings/probe1_snapshot_env.log | Configure ANDROID_HOME/SDK; install platform 34 | DevOps |
| 5 | Tests failing | Low confidence; regressions slip | High | findings/probe11_jest.log | Fix jest setup; add smoke tests | Eng |
| 6 | Dependency health unknown | Potential security/upgrade lag | Medium | findings/probe6_* | Run outdated/audit/depcheck; plan updates | Eng |
| 7 | Bundle size unknown | Potential perf/store issues | Medium | findings/probe12_bundle.log | Produce bundle and analyze | Eng |
| 8 | Secret patterns in repo | Misinterpretation/accidental leak | Low | findings/probe9_secrets_scan.log | Confirm public-only; move private keys to env | Eng |
| 9 | HLS cleanup unverified | Storage cost growth | Medium | probe10_media_hls.log | Add cleanup verification job/test | Eng |
|10 | Missing firebase app configs | Blocks native features | Low | probe8_firebase_configs.log | Ensure google-services.json for release builds | DevOps |
