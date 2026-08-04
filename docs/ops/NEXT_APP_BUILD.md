# NEXT APP BUILD — pending client work (deploy as an UPDATE)

> **Why this file exists.** Since ~3am on 2026‑06‑09 an app build is in **Google Play
> production review**. To avoid disrupting that review, all subsequent work has been
> **backend‑only** (Cloud Run + Cloud Functions + Firestore). Several features are now
> **live on the backend but have NO app‑side surface yet**. This file is the single
> source of truth for what must land in the **next app build**, shipped as a normal
> **update once the first review clears**. Do not trust memory — trust this list.

**Rule:** nothing here goes into the build currently under review. These are for the
*next* AAB. Bump `versionCode` when building it.

---

## 1. Push notification client shim  (backend = DONE, app = TODO)

Backend already deployed: `notificationDispatch` (1‑min cron), FCM `sender`, durable
`notifications` outbox, `onLiveStreamCreate` / `onLiveStreamGoLive` fan‑out, owner‑only
`users/{uid}/devices/{deviceId}` rules + `notifications` rules + composite index.
**Until the app registers a device token, the dispatcher just records `no_device` and
rests** — zero effect on the live app.

App‑side status:
- [x] Dependency added: `expo-notifications@~0.32.17` (in `package.json` + lockfile + `node_modules`).
      NB: local `npm install` is broken by an npm 10.9.3 arborist `rollbackMoveBackRetiredUnchanged`
      bug (`from = undefined`) — worked around by cleaning retired dirs + `npm install --package-lock-only`.
- [x] `src/services/PushService.js` — JS client: permission prompt, **native device token**
      (`getDevicePushTokenAsync` → FCM, matches the `admin.messaging()` sender), writes
      `users/{uid}/devices/{deviceId}` `{ pushToken, tokenType, platform, appVersion, disabled, updatedAt }`,
      Android **`default`** channel, foreground presentation handler, **tap‑routing**
      (`live`→stream, `streak`→Home), cold‑start handling. Fully guarded (no‑ops without the module).
- [x] Wired into `App.js` (guarded effect, registers on auth‑ready, routes via `navigationRef`).
- [x] `expo-notifications` config plugin added to `app.config.js` (`color: #00D2BE`).
- [x] **NATIVE FCM WIRING — DONE.** `android/app/google-services.json` fetched from the existing
      `blyp-master` Android app (`1:929105034040:android:…`, `com.blyp.mobile`) and committed.
      `com.google.gms.google-services` plugin applied (classpath in `android/build.gradle` + apply
      in `android/app/build.gradle`). No EAS FCM creds needed — sending is via Cloud Functions
      `admin.messaging()`. Still needs an on‑device build to verify token registration + delivery.
- [ ] Permission prompt UX polish (iOS opt‑in funnel).
- [ ] Logout cleanup: call `PushService.unregisterPush(uid)` from the logout path (sender also prunes
      invalid tokens; re‑registers on next login). Deferred to keep the logout path untouched.
- [ ] Optional: in‑app inbox + catch‑up reconciliation over the user's own `notifications` docs.

## 2. "Blyp it" — premium AI compose & send  (backend = DONE, app = TODO)

Backend already deployed: `blypAssistantCompose` (https) — auth → premium gate
(`entitlements/{uid}`, fails closed) → rate limit → Gemini draft (self‑moderated) →
Imagen image (best‑effort) → durable `assistantDrafts/{id}`. **Never auto‑sends.**

Endpoint: `POST https://us-central1-blyp-master.cloudfunctions.net/blypAssistantCompose`
Auth: `Authorization: Bearer <Firebase ID token>` (uid == Cognito sub via `mintFirebaseCustomToken`).
Body: `{ command }` **or** `{ recipient, gist, tone }`.
Responses: `200 { ok, draftId, recipientName, messages[], imageUrl, channels:['dm','share'], tone }`,
`401 unauthenticated`, `402 subscription_required`, `429 rate_limited`,
`422 unsafe { detail }`, `503 ai_unavailable`/`no_draft`, `400 empty_request`.

App‑side status (v1 shipped):
- [x] `src/services/blypItService.js` — `composeBlyp` (maps every status → stable code),
      `markDraftStatus` (owner‑only `status` write), `shareMessageText`, `shareImage`
      (downloads signed URL → `expo-sharing`, falls back to URL text).
- [x] `src/components/BlypItModal.js` — themed (dark + teal) sheet: command input → compose →
      **draft preview** (selectable message options + AI image) → **Share message / Share image /
      Tweak (regenerate) / Cancel**. NEVER sends without preview. Handles **402 → "See plans"
      upsell** (routes to `Plans`), **422 → kind refusal**, `429`, `503`, `401`.
- [x] Launcher wired into **`BlypScreen`** (the "blyp it" surface): a "Blyp it — compose & send"
      card in the empty state opens the modal; shows a Plus hint when `useHasAI()` is false.
- [x] On send/cancel updates `assistantDrafts/{id}.status` → `'sent'` / `'discarded'`.
- [ ] **Phase 2 — in‑app DM delivery + recipient resolution**: map `recipientName` → a real Blyp
      connection (`users/{uid}/following` + `followers`) and write into the messaging/DM flow.
      v1 deliberately uses the **share‑sheet only** (no recipient guessing — the user picks the app/contact).
- [ ] Phase 2 — voice intent on the Ask Blyp bar to pre‑fill the command (`speechToTextService` exists).

Backend follow‑ups (optional, can do server‑side anytime):
- [ ] Confirm `BLYP_GEMINI_API_KEY` is set in Functions env (drafting returns `ai_unavailable` if absent).
- [ ] Confirm the Gemini key tier has **Imagen** access (else images are skipped, text‑only — by design).

## 3. Daily streak engine surface  (backend = DONE, app = TODO)

Backend deployed: server‑authoritative claim — coins minted via the real ledger,
idempotent per UTC day (`daily:<uid>:<day>`, can never double‑pay). `streaks/{uid}`
holds the streak; owner‑read, server‑write. A daily `streakReminderSweep` (18:00 UTC)
enqueues "keep your N‑day streak alive" via the notification spine.

Endpoint: `https://us-central1-blyp-master.cloudfunctions.net/blypClaimDailyReward`
Auth: `Authorization: Bearer <Firebase ID token>`.
- `GET`  → `{ ok, streak, claimedToday, claimableReward }` (peek, no mutation).
- `POST` → claims: `{ ok, alreadyClaimed, streak, reward, balanceCoins }`.

App‑side status (shipped):
- [x] `src/services/streakService.js` — `peekDailyReward` (GET) + `claimDailyReward` (POST, sends `{}`
      body so it doesn't 411 at Google's frontend). Uses the Firebase ID token.
- [x] `src/components/DailyRewards.js` revived & rewired to the server endpoint (no more client mint);
      headline uses server `claimableReward`; handles `alreadyClaimed` / `unauthenticated`.
- [x] Mounted on **Home** (`HomeScreen`) — floating pill appears only when claimable.
- [x] Push `data.type === 'streak'` tap‑routing → Home (claim pill surfaces there).
- [ ] Optional: also surface the streak count on the profile.

## 4. (Future) Reminders surface (Assistant phase 1)
- [ ] Ask Blyp `reminder` intent → create reminder; home "Assistant" rail; depends on the push shim (item 1).

---

## Backend that is LIVE and safe for the in‑review app (no action needed)
- Real ban enforcement: Cognito disable/enable on ban/unban + `requireNotBanned` guard (economy + go‑live). Fails open.
- `/api/live/me/admin-controls` now returns `isBanned`, `bannedUntil`, `banReason`, `role`.
- Notification spine + live alerts (see item 1).
- "Blyp it" compose service (see item 2).
- Admin dashboard (separate web app under `admin/`), backend admin endpoints.

## Build & release of THIS app update

**Build path = the governed LOCAL canonical release** (the EAS `production` profile is intentionally
BLOCKED by the Gradle guard). It needs the real keystore + a fresh regression‑gate proof, so it's a
"final button press" on the machine that holds the signing secrets.

- [x] `versionCode` bumped to **2026229391** (in `android/app/build.gradle`; prior `2026229086`
      is consumed by the in‑review build).
- [x] FCM wired (item 1); `expo-notifications` installed + plugin added.
- [x] JS gates green locally: `npm run lint` ✅ and `npm run typecheck` ✅.
- [ ] **Clean the working tree** — the build script aborts on any dirty/untracked file.
      Currently untracked: `legal/` (decide: commit or `.gitignore`). Everything else is committed.
- [ ] Set release signing env (machine with the keystore): `BLYP_RELEASE_STORE_FILE`,
      `BLYP_RELEASE_STORE_PASSWORD`, `BLYP_RELEASE_KEY_ALIAS`, `BLYP_RELEASE_KEY_PASSWORD`.
- [ ] Run the gate, then the build (from repo root, PowerShell):
      1. `powershell -ExecutionPolicy Bypass -File tools\release\RUN_PRE_RELEASE_REGRESSION_GATE.ps1 -ExpectedVersionCode 2026229391`
      2. `powershell -ExecutionPolicy Bypass -File tools\release\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode 2026229391`
      → AAB at `diagnostics\release_aab\CANONICAL_PLAY_AAB_<ts>\app-release.aab`.
- [ ] Upload that AAB to the **internal testing** track (NOT production), e.g.
      `eas submit --profile internal` (uses `android-service-account.json`) or upload in Play Console.
- [ ] Verify on a device: streak claim, Blyp it compose→share, and a live‑follow **push + tap‑routing**
      (have one account follow another, go live → the follower should get the notification).
- [ ] Once verified, promote as a production **update** after the first review clears.

_Last updated: 2026‑06‑09 — app‑side session: shipped Streak UI + "Blyp it" v1 (share delivery) +
guarded push client; installed `expo-notifications` (worked around a broken local npm); **wired native
FCM** (google‑services + gms plugin); bumped versionCode → 2026229391; lint + typecheck green.
Remaining: clean `legal/`, then run the governed canonical AAB build with the keystore + upload to
internal testing, and verify on a device._
