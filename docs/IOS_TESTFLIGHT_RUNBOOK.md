# Blyp iOS → TestFlight runbook

Bundle ID: `com.blyp.mobile`  
EAS project: `@alexjirving/blyp-mobile` (`5a294a13-3ebd-417a-860f-3229f97f4faf`)  
EAS profile for TestFlight-bound builds: **`preview-ios`** (`distribution: store`)  
Android preview/production profiles are unchanged.

Worktree used for this ship branch: `C:\Users\Alex\Blyp26-ios-ship` (branch `ship/ios-eas-preview`).

## Status snapshot (ship path start)

| Area | State |
|------|--------|
| `app.config.js` iOS | Bundle ID, permissions, push background modes, `ITSAppUsesNonExemptEncryption: false`, `buildNumber` |
| `eas.json` | `development` / `preview` / `preview-ios` / `production` iOS sections |
| Native `ios/` | Not committed (Expo prebuild on EAS) |
| Prior EAS iOS builds | None |
| Apple / ASC credentials on EAS | Not configured locally — first interactive login required |
| Client coin SKUs | Platform-aware; iOS mirrors `IOS_IAP_CATALOG` |
| StoreKit purchase UI | Still Android-only checkout (SKUs aligned for next StoreKit client) |
| Server Apple verify | Implemented; needs `APPLE_*` secrets on live-service |

---

## A. Apple Developer + App Store Connect (Alex, interactive)

Do these once before a successful cloud build/submit.

1. **Apple Developer Program** membership active for the team that will own `com.blyp.mobile`.
2. **Identifiers → App IDs**  
   - Register `com.blyp.mobile` if missing.  
   - Capabilities: Push Notifications, In-App Purchase (and Associated Domains if used).
3. **App Store Connect → My Apps → +**  
   - Bundle ID: `com.blyp.mobile`  
   - Name / primary language / SKU (e.g. `blyp-mobile`)  
   - Note the numeric **Apple ID** (ASC App ID) from App Information.
4. **Users and Access → Integrations → App Store Connect API** (recommended for non-interactive submit)  
   - Create a key with App Manager (or Admin).  
   - Download `.p8` once; note **Issuer ID** + **Key ID**.
5. **In-App Purchases** (Consumable) — must match server catalog:

| Product ID | Coins granted | Suggested price |
|------------|---------------|-----------------|
| `blyp.ios.proof.coinpack.100` | 100 | $0.99 |
| `blyp.ios.coinpack.550` | 550 | $4.99 |
| `blyp.ios.coinpack.1150` | 1150 | $9.99 |
| `blyp.ios.coinpack.3000` | 3000 | $19.99 |
| `blyp.ios.coinpack.6500` | 6500 | $39.99 |

6. **Subscriptions** (later; still Play-shaped on client):  
   - `blyp.plus.monthly` / `blyp.plus.coins.monthly` — create iOS equivalents when StoreKit subscriptions ship.
7. **Push**  
   - EAS can manage the APNs key, or upload an APNs Auth Key (`.p8`) in Expo credentials.  
   - Firebase: add an iOS app for `com.blyp.mobile` and supply `GoogleService-Info.plist` (or EAS secret) when enabling native FCM on iOS.
8. **Live-service Apple IAP verify** (production economy): set on the backend  
   - `APPLE_BUNDLE_ID=com.blyp.mobile`  
   - `APPLE_ISSUER_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY_P8` (App Store Server API key)

---

## B. Wire EAS Apple credentials (Alex, once)

From the iOS ship worktree:

```powershell
cd C:\Users\Alex\Blyp26-ios-ship
npx eas-cli login
npx eas-cli credentials -p ios
```

Prefer letting EAS manage the distribution cert + provisioning profile for `preview-ios` / production.

Update `eas.json` → `submit.preview-ios.ios` and `submit.production.ios`:
- `ascAppId`: numeric ASC App ID  
- `appleTeamId`: 10-character Team ID  

---

## C. Build (approved script — bypasses casual `eas build` hook deny)

Hooks deny bare `eas build`. Use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_IOS_PREVIEW.ps1
```

Or wait for completion:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_IOS_PREVIEW.ps1 -Wait
```

Equivalent raw command (may be hook-blocked in Cursor):

```powershell
npx eas-cli build --platform ios --profile preview-ios --non-interactive --no-wait
```

If non-interactive fails on credentials, re-run **without** `--non-interactive` once so Apple login can complete, then future builds can stay non-interactive.

Do **not** use `BUILD_RELEASE_CANDIDATE.ps1` (Android AAB only).

---

## D. Submit to TestFlight

After build status is **finished**:

```powershell
# Set real IDs in eas.json submit.preview-ios first, then:
npx eas-cli submit --platform ios --profile preview-ios --latest --non-interactive
```

Interactive fallback:

```powershell
npx eas-cli submit --platform ios --latest
```

In App Store Connect:
1. **TestFlight** → wait for processing.  
2. Add **Internal Testing** group (App Store Connect Users) — no Beta App Review.  
3. For **External** testers: complete export compliance (already `ITSAppUsesNonExemptEncryption: false`), answer encryption questions if asked, submit for Beta App Review.

---

## E. Install / verify

1. Invite Apple ID on TestFlight (internal).  
2. Install via TestFlight app.  
3. Smoke: launch, auth, feed, go-live camera/mic prompts, push permission.  
4. Coin store: SKUs resolve as `blyp.ios.*` in logs; purchase button remains Android-gated until StoreKit client ships.

---

## F. Quick command cheat sheet

```powershell
cd C:\Users\Alex\Blyp26-ios-ship

npx eas-cli whoami
npx eas-cli credentials -p ios

powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_IOS_PREVIEW.ps1

npx eas-cli build:list --platform ios --limit 5 --non-interactive --json

npx eas-cli submit --platform ios --profile preview-ios --latest
```
