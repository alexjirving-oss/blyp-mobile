# Blyp Mobile - Android Release Build Guide

## Status

HISTORICAL EAS AND LEGACY ANDROID BUILD ROUTES ARE NON-CANONICAL.

The only authorized Android release creation path is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <versionCode>
```

Do not use `eas build --platform android`, old diagnostics helper scripts, or direct Gradle release commands to create the Play upload artifact.

## Pre-Build Checklist

1. Ensure the repo is clean and on a named branch.
2. Ensure signing environment variables are set for the upload keystore.
3. Ensure `.env.production` and `eas.json` production env contain no loopback values.
4. Decide the exact Android `versionCode` to pass into the canonical script.

## Canonical Android Release Build

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <versionCode>
```

Expected outcome:

1. The script performs release-governance prechecks.
2. The build is produced only if those prechecks pass.
3. The upload artifact is frozen under `diagnostics\release_aab\CANONICAL_PLAY_AAB_<timestamp>\app-release.aab`.

## Google Play Upload

1. Upload the frozen `app-release.aab` from the canonical diagnostics packet.
2. After validation, optional submission tooling can still be used for Play delivery:

```bash
eas submit --platform android --profile production
```

## Non-Canonical Android Paths

These routes are intentionally not valid release creation paths for Blyp:

1. Historical route: `eas build --platform android`
2. Historical route: `eas build --profile production --platform android`
3. Historical route: direct `gradlew bundleRelease`
4. Historical scripts under `scripts/` and `diagnostics/release_aab/`

## Troubleshooting

1. If the canonical script fails prechecks, fix the reported governance issue and rerun.
2. If the repo is dirty, commit or isolate unrelated changes before attempting a release build.
3. If signing env vars are missing, set them first; do not edit the script to bypass the check.

## Support References

1. `PRODUCTION_DEPLOYMENT_CHECKLIST.md`
2. `PRODUCTION_PLAY_STORE_CHECKLIST.md`
3. `PLAY_AUTOSUBMIT_GOOGLE_PLAY.md`
