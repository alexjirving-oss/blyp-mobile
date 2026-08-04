# Blyp — Master Remediation Plan

**Status:** v4 — re-verified June 2026 via seven parallel read-only subsystem deep-dives (security, money, live streaming, feed/media, messaging/data-integrity, compliance/first-run, iOS/resilience/CI). Folds in fixes shipped this session and items independently confirmed *already fixed* since v3. No code changes were made while producing this document; it is a planning artifact.

**Scope:** Whole product — React Native (Expo) client, Firebase (Firestore/Functions/Storage), `backend/blyp-live-service` (Cloud Run + Postgres + Redis), AWS IVS, Cognito auth.

**Goal:** Ship a TikTok-style live + video app that is flawless on **both iOS and Android**, secure, legally compliant, data-efficient, and fluid.

---

## How to use this document

- Findings are grouped into **phases** ordered by urgency. Each item has a stable ID (e.g. `P1.1`, `E-A.2`) so we can track remediation. IDs are carried over from v3 where the finding persists.
- Severity legend: **CRITICAL** (exploitable / data loss / legal / crash) · **HIGH** (broken core feature / strong abuse) · **MEDIUM** · **LOW**.
- File references use `path:line` re-verified in this pass; still spot-check at edit time (the tree moves).
- **§A "Fixed / verified-good since v3"** lists things that were open in v3 and are now resolved — do **not** re-spend effort there.
- **"Confirmed non-issues"** at the end are claims that looked wrong but are actually fine.

---

## Methodology

Seven parallel read-only deep-dives this pass, each re-verifying v3 claims against current code and hunting new issues:

1. **Security** — Firestore/Storage rules, live-service route authz, legacy Functions JWT, CORS, blocks, secrets.
2. **Money** — subscription coin grants, token binding, entitlement gating, gifting validation, gem settlement, IAP, wallet source-of-truth.
3. **Live streaming** — IVS lifecycle, partial-failure rollback, viewer auto-exit, stage teardown, guest flow, battle scoring, audio bleed, stale-live.
4. **Feed/media** — VOD/data usage, render fluidity, follow/comment/like correctness, post-publish navigation.
5. **Messaging/integrity** — DM optimism, full-collection listeners, N+1, block-on-compose, dead controls, listener leaks, push, counters/cascades.
6. **Compliance/first-run** — moderation/CSAM, profanity, report auto-action, account deletion, minor safety, EULA, accessibility, offline, onboarding, email.
7. **iOS/resilience/CI** — iOS IAP/StoreKit, IVS crash path, EAS iOS, APNS, backups/DR, migrations, devReset, admin sessions, config, deps, CI, Sentry, deploy drift.

> **Meta-finding (unchanged and central):** regressions keep shipping because the automated safety net is still thin. The good news from this pass: **client CI gates (lint + typecheck + `npm test`) are now blocking**, and **Firestore-rules tests now fail the build** (both were broken in v3). The remaining gap is the **backend live-service economy (~1900 LOC) has zero tests** and Sentry is still unwired. Stand up backend tests + Sentry DSN early (Phase 8) — they protect every fix below.

---

## §A — Fixed / verified-good since v3 (do not re-spend effort)

These were open findings in v3 that this pass confirmed resolved in current code:

| v3 ID | Item | Evidence it's now fixed |
|-------|------|--------------------------|
| P1.1 | Self-grant admin via `users/{uid}` write | `firestore.rules:151-154` freezes `isAdmin`/`roles` on owner create/update; only `request.auth.token.admin` bypasses. `isAdmin()` reads are safe given the freeze. |
| P2.1 | Subscription coins split-brain (Firestore vs Postgres) | Now credits Postgres: `handlers.ts:113-126` → `coinGrant.ts:35-52` → `internalRoutes.ts:58-66` → `economyService.ts` `SUBSCRIPTION_COINS` ledger. Spend/gift/IAP all read Postgres. |
| P2.3 (part) | Entitlement "perpetual Plus on falsy period" / "ignores status" | **Refuted** — `entitlementService.js:56-60` fail-closes to `free` without a live period; `STATUS_BLOCKS_PAID` honored. (Read-error synthetic-trial remains, downgraded to MEDIUM — see P2.3.) |
| P7.4 (part) | Gemini API key in client bundle | **Primary path refuted** — `firebase.js:324-336` uses proxy sentinel `'managed-by-proxy'`; `app.config.js:38-46` deliberately omits the key. Only a legacy direct-key fallback remains (now P1.10, HIGH). |
| P8.1 | CI never ran tests/typecheck/lint as blocking | `.github/workflows/qa.yml:19-35` now runs client lint + `tsc --noEmit` + `npm test -- --ci` as blocking gates. |
| P8.2 (part) | Rules tests "log but pass" | `scripts/test-firestore-rules.js:56-65,348-358` now `process.exit(1)` on failure; emulator rules job is blocking in `qa.yml:67-83`. |
| P11.3 | Wrong-password login secretly sends a reset email (`probeAccountExistence`) | `probeAccountExistence` is **no longer present** in `AuthScreen.js`; appears removed. (Re-verify on the deployed build.) |
| P11.8 | Debug error toggle visible to real users | Now gated by `__DEV__` (`AuthScreen.js:927-935`). |
| P0.4 | Account-deletion worker "absent" | Worker now **exists** (`functions/src/account/deletionWorker.ts`, exported `index.ts:66`) — but purge is incomplete (re-scoped under P0.4 below). |
| P0.1 | Media moderation "absent" | `moderatePostMedia` now **exists** and triggers on post create (`index.ts:70`) — but off-by-default + fail-open (re-scoped under P0.1). |
| P0.2 | Comment/DM filtering "client-only" | Server-side text moderation now **exists** for feed comments + DMs (`textModeration.ts:97-207`) — live/matchday paths still bypass it (re-scoped under P0.2). |
| P0.3 | Report aggregation "no thresholds" | `aggregateReport`→`evaluateAutoAction` now applies thresholds (`reportAutoAction.ts`) — but posts-only + weak alerting + resolve blocked by rules (re-scoped under P0.3). |

**Shipped this session (verified good by the live-streaming deep-dive):**

- **Gift delivery** — Socket.IO Redis adapter wired for cross-instance fan-out (`socketServer.ts:21-49`); gifts now reach all Cloud Run instances. Deployed + verified.
- **Audio bleed (HomeBase)** — For-You rail gated on `useIsFocused` (`HomeBasePanel.js:118,782-785`); MediaViewer/PostPreview focus gates re-confirmed.
- **Guest join UI** — double-tap catcher spares the Join tile (`LiveStreamScreen.js:2589-2607`); `guestRequests` mirror rules verified (`firestore.rules:125-131`).
- AAB `versionCode 2026234011` built with these.

---

## Executive summary — top risks (current state)

| # | Risk | Severity | Phase |
|---|------|----------|-------|
| 1 | Live-service routes lack host auth: `/live/end`, guest invite/reject/requests, `/live/battle/join`+`start`, `/rooms/sweep` — any authed user controls any stream | CRITICAL | P1 |
| 2 | Gift `receiverUserId` trusted from client — gift credits an arbitrary uid, not the actual host | CRITICAL | P2 |
| 3 | Same subscription purchase token can activate on two uids (per-uid idempotency + fail-open token binding) → double coin grant | CRITICAL | P2 |
| 4 | Open IDOR rules: `chats`, `chatRooms`, `gameRooms`, nested `users/{uid}/chats` read, `liveStreams/viewers` write | CRITICAL | P1 |
| 5 | Battle/audition/team field-scope: participants/leader can rewrite `status`/`opponent`/`leaderId`; battle `score` client-writable | CRITICAL | P1/P7 |
| 6 | Legacy Functions live routes decode JWT without verifying signature | CRITICAL | P1 |
| 7 | Media moderation off-by-default + fail-open; no CSAM hash matching; live/matchday chat unfiltered server-side | CRITICAL | P0 |
| 8 | Age gate bypassed by social OAuth + guest mode; no age check before live/gift/DM | CRITICAL | P0 |
| 9 | Blocking is client-side only (DM/gift/push/live join unenforced); ban guard fails open | CRITICAL | P0/P1 |
| 10 | Account-deletion purge incomplete (no conversations/notifications/comments cascade; 500-cap; wrong storage prefixes) | CRITICAL | P0 |
| 11 | Admin "Resolve" blocked by `moderationQueue` rules → moderation actions silently fail | CRITICAL | P0 |
| 12 | iOS: no IAP/StoreKit, IVS hooks construct native client unconditionally (crash), no EAS iOS profiles | CRITICAL | P3 |
| 13 | Feed serves full-res MP4 + full-file prefetch → ~0.5–1.5 GB/session (no VOD ladder) | CRITICAL | E-A |
| 14 | Whole-feed re-render on every snapshot/like; unmemoized rows → scroll jank | CRITICAL | E-B |
| 15 | No Firestore/Postgres backups or PITR; financial ledger in Postgres | CRITICAL | P9 |
| 16 | Boot-time `CREATE TABLE IF NOT EXISTS` only; knex migrate broken (no `knexfile.cjs`) — can't alter prod schema | CRITICAL | P9 |
| 17 | Streaming backend hardcoded IVS; config ignores platform guards | CRITICAL | P3/P9 |
| 18 | Backend economy (~1900 LOC) has zero tests | CRITICAL (process) | P8 |
| 19 | IVS stages never deleted on end → silent AWS bill growth | HIGH | P6 |
| 20 | IVS viewers never auto-exit on host end (passive "Stream ended", no nav) | HIGH | P4 |
| 21 | Full `users` collection listeners (Messenger/FindPeople) → unbounded reads | HIGH (scale) | P6 |
| 22 | `commentCount` never incremented; follower counts read deprecated top-level docs | HIGH | P5 |
| 23 | Sentry DSN unset → production crashes invisible; no cloud alerts | HIGH | P8 |
| 24 | Accessibility largely absent; Dynamic Type disabled app-wide | HIGH | P10 |
| 25 | No Firestore offline persistence; no global offline UX | HIGH | P10 |
| 26 | Verification email may still send via Cognito default sender (SES `blyp.world` fix written, deploy unverified) → SPAM | CRITICAL (ops) | P11 |
| 27 | New users flash Home before onboarding; guests flash AuthScreen; `isOnboarded()` read-error skips onboarding | HIGH | P11 |

---

## Phase 0 — Legal / store-gating (blocks public launch)

- **P0.1 — Automated content moderation (CRITICAL).** `moderatePostMedia` exists and triggers on `posts/{postId}` create (`index.ts:70`) but is gated on `ENABLE_MEDIA_MODERATION=true` (default **off**) and is **fail-open** — Vision errors leave the post visible (`mediaModeration.ts:14,22-23,83,100-101`). Video scans the thumbnail only; no frame/segment sampling. There is **no CSAM hash matching** (only Vision SafeSearch + text patterns). Storage accepts any image/video by type/size with no scan gate (`storage.rules:61-68`). Enable the flag in prod, fail-closed/quarantine on error for adult/CSAM, add a PhotoDNA/NCMEC hash service, and scan on finalize before public read.
- **P0.2 — Server-side profanity/text filtering everywhere (HIGH/CRITICAL).** Feed comments + DMs now have a server backstop (`textModeration.ts:97-207`) — **good**. Gaps: live-stream comments write raw (`liveStreamApi.ts:266`), the Firestore live-comment fallback bypasses CFs (`HLSLiveStreamService.js:1118-1128`), and matchday chat is client-write only with **no Firestore rule** (`matchdayChatService.js:63-79`, missing rule near `firestore.rules:945` → default-deny or bypass if rules stale). Add a `moderateLiveComment`/`moderateMatchdayMessage` trigger or route through the moderated HTTP path; add matchday rules.
- **P0.3 — Report auto-action + admin resolve→takedown (CRITICAL).** `aggregateReport`→`evaluateAutoAction` applies thresholds (`index.ts:1033-1047`, `reportAutoAction.ts:25-55`) but only **auto-hides posts**; users/streams/comments are alert-only, and alerts are just an `adminAlerts` doc + `console.error` (`reportAutoAction.ts:133-151`). Worse, `moderationQueue` is `write:false` (`firestore.rules:340-342`), so the mobile "Resolve"/"Under review" path **silently fails** (`ModerationQueueService.js:27-40`) and resolve performs **no content takedown** (`ModerationQueueScreen.js:50`). Route resolve through a privileged CF that applies hide/ban via Admin SDK; extend auto-actions per target type; wire alerts to email/Slack/PagerDuty.
- **P0.4 — Complete the account-deletion worker (CRITICAL, GDPR/CCPA).** Worker exists (`deletionWorker.ts`, exported `index.ts:66`) but: posts purge capped at **500/run** with no pagination (`:36-52`); storage prefixes omit the real `users/{uid}/` path (`:55-61` vs `storage.rules:56`); **no purge** of `conversations`/DMs, `reports`, `notifications`, `liveStreams/.../comments`, post comment subcollections, or drafts; backend Postgres purge is skipped if secrets unset and silently continues (`:77-81`); Postgres ledger is retained with no anonymization policy. Paginate, fix prefixes, add recursive deletes + conversation tombstones, and fail the job if backend purge can't run.
- **P0.5 — Minor safety / age gating (CRITICAL).** 13+ DOB gate exists on **email signup only** (`AuthScreen.js:359-373`). Google/Facebook OAuth collects no DOB and calls `handleAuthSuccess` without a Cognito session (`:494-544`); guest mode bypasses all checks (`:1042-1044`). DOB isn't written to Cognito `birthdate` (`:397-409`). No `ageVerified`/`birthdate` check before Go Live, gifting, or DMs. `MessengerScreen.js:366-374,408` still loads **all users** ("for testing"). Collect DOB on every signup path, federate OAuth to Cognito, enforce minor restrictions server-side (no live/gifting/stranger-DM under policy), and a COPPA posture for under-13.
- **P0.6 — Report/block on all UGC surfaces (MEDIUM/HIGH).** Feed comments, DMs, live streams, and profiles have report+block (`CommentsModal.js:643-652`, `ReportModal.js:54-69`, `ChatConversationScreen.js:378-379,487-494`, `LiveStreamScreen.js:2665-2668`) — **good**. Gaps: no per-message report in DMs (reports `targetType:'user'`, `:490`) and no per-live-chat-message report. Add message-level reporting for Apple 1.2 / Google UGC completeness.
- **P0.7 — Finalize binding EULA / acceptance (HIGH).** Signup has only a TODO, no "I agree" checkbox/link (`AuthScreen.js:67-69`); guest entry accepts no terms (`:1042-1044`); Layer-2 formal Terms are stubbed "being finalised" (`termsService.js:99-100`); terms re-check fails open on read error (`:143-147`); Terms URLs are inconsistent (`blyp.app/terms` vs `blyp.world/terms`, user-reported 404). Publish binding Terms, require explicit acceptance before signup + guest entry, host the page.

## Phase 1 — Exploitable security (highest urgency)

- **P1.4 — Live-service host/participant auth (CRITICAL).** `/api/live/end` takes only `sessionId`, no host check (`liveRoutes.ts:516-527`, `liveService.ts:423-426`) — any user ends any stream. `inviteGuest`/`rejectGuest`/`guest/requests` read `userId` from JWT but never pass it to the service, which has zero host check (`liveRoutes.ts:353-378,412-476`, `liveService.ts:283-309`). `joinBattleStage` mints an IVS **PUBLISH** token for any authed user with `sessionId`+`battleId` (`liveRoutes.ts:502-508`, `liveService.ts:396-420`); `/live/battle/start` doesn't verify `creatorUid` (`:485-492`). `/rooms/sweep` is callable by anyone (`roomsRoutes.ts:105-110`). Verify `req.user.sub === session.hostUserId` (or battle participant) on each.
- **P1.5 — Verify legacy Functions JWTs (CRITICAL).** `functions/src/live/liveRoutes.ts:33-43` decodes the JWT with `JSON.parse(base64)` — **no signature verification** — still exported as `hostStartLegacy` etc. (`index.ts:21`). Retire the exports or replace with the JWKS `jwt.verify` already used in `ivsRouter.ts:84-104`.
- **P1.2 — Close IDOR rules (CRITICAL).** `chats/{chatId}` (`firestore.rules:568-577`), `chatRooms/{roomId}` (`:580-583`), `gameRooms/{gameRoomId}` (`:806-809`) are auth-only read/write; `users/{uid}/chats` + nested `messages` are readable by any authed user (`:190-197`); `liveStreams/{id}/viewers/{viewerId}` is writable by anyone (doc id not bound to caller, `:105-107`). Add participant/owner checks; bind viewer doc id to `request.auth.uid`.
- **P1.3 — Field-scope mutable docs (HIGH).** `battles/{id}` participants may change **any** field (the `hasOnly(['score','updatedAt'])` only applies to non-participants — `firestore.rules:885-888`); `auditions/{id}` has no `hasOnly` so leader/`aUid`/`bUid` can rewrite `teamId`/`status`/opponent (`:768-778`); `teams/{id}` lets leader/admin change `leaderId` → team takeover (`:711-716`). Add per-role `hasOnly()` and freeze identity fields.
- **P1.9 — Server-side block enforcement (CRITICAL).** Blocks are stored owner-only (good, `firestore.rules:181-183`) but enforced **client-side only** (`BlockService.js:7-8`). No server check on DM send/create (`firestore.rules:601-632`), DM push fan-out (`messageNotify.ts:41-79`), gifting (`economyService.ts:1005+`), or live join. Enforce in CFs/rules/gift API.
- **P1.8 — Ban guard fail-closed + broaden coverage (CRITICAL/MEDIUM).** `requireNotBanned` returns `false` (passes) on DB error / no cache (`banGuard.ts:44-45,67`); make it fail-closed. It's only applied to `/live/start` and battle routes — banned users can still join/mint tokens/invite/end (`liveRoutes.ts`). Apply at router level on all mutating live routes.
- **P1.6 — CORS + Socket.IO + headers (MEDIUM/HIGH).** If `CORS_ALLOWED_ORIGINS` unset, all origins allowed with `credentials:true` (`index.ts:42-49`); Socket.IO uses `origin:true` (`socketServer.ts:58-61`). Require an explicit allowlist in prod, add `helmet`, cap `express.json()` size.
- **P1.7 — Admin login hardening (MEDIUM).** No rate-limit/lockout/CAPTCHA on `/admin/auth/login` (`adminRoutes.ts:177-188`) — online brute-force of env passwords. Add Redis per-IP+email backoff.
- **P1.10 — Kill the legacy Gemini direct-key path (HIGH).** Primary path is proxied (fixed), but `geminiConfig.js:8-40` still reads `EXPO_PUBLIC_GEMINI_API_KEY` and appends `?key=`; a mis-set env re-exposes a key in the bundle. Delete the direct-key path or hard-fail if the key env is set in production builds.
- **P1.11 — Storage read/content policy (MEDIUM).** `users/{userId}/**` accepts `application/octet-stream` up to 200MB and `allow read: if true` makes any known path world-readable (`storage.rules:30,61-66`). Restrict to explicit image/video types; use signed/auth-gated reads for non-public media.

## Phase 2 — Money correctness

- **P2.7 — Gift to non-host (CRITICAL, NEW).** `sendGift` trusts client `receiverUserId` and never checks the receiver actually hosts `streamId` (`economyService.ts:1005-1012`) — coins/gems can be funneled to an arbitrary account. Resolve the host from the live session/Firestore and require `receiverUserId === hostUserId`.
- **P2.2 — Bind subscription token to one uid (CRITICAL).** The cross-user guard is non-transactional and **fails open** on error, and the coin idempotency key is **per-uid** not per-token (`handlers.ts:72-84,122`, `rtdn.ts:61`) → the same purchase token can activate on two uids, each granted coins. Play verify never checks `obfuscatedExternalAccountId` vs caller uid (`entitlement.ts:49-97`). Bind the token in a Firestore transaction before writing entitlement; require the Google account id to match.
- **P2.1b — Subscription coin-grant durability (HIGH).** Coin credit is silently skipped if `LIVE_SERVICE_BASE_URL`/`INTERNAL_SHARED_SECRET` unset and activation still returns `ok:true` (`coinGrant.ts:27-31`, `handlers.ts:104-127`). Fail/queue-retry activation when the Postgres credit can't run; surface failures to ops. No coin clawback on `REVOKED` (`rtdn.ts:104-107`).
- **P2.3 — Entitlement fail-closed on read error (MEDIUM).** Firestore read error grants a synthetic 30-day trial with `ai:true` (`entitlementService.js:121-133`); `hasAICached()` returns true when cache is null (`:97-98`); `useHasAI()` is fail-open while loading (`useEntitlement.js:26-28`). Default-deny paid features until a successful load; cache last-known-good. (Perpetual-Plus/ignore-status claims from v3 are **refuted** — see §A.)
- **P2.5 — Gift validation + throttle (HIGH).** Catalog `min_level`/`cooldown_ms` are exposed but never enforced in `sendGift` (`economyService.ts:1020-1026`); `/gift/send` has **no rate limit** (`economyRoutes.ts:236-261`); `quantity` up to 1000 with no spend cap (`economySchemas.ts:41`). Enforce level + per-(sender,gift) cooldown + Redis rate limit + spend cap before debit.
- **P2.4 — Pending-gem settlement race (HIGH).** `ensureWalletRow`/`getWallet` settle matured PENDING gems without `SELECT … FOR UPDATE` (`economyService.ts:572-604`) → concurrent calls can double-credit `gem_available`. Lock the wallet row first (or single-flight settlement).
- **P2.8 — Wallet source-of-truth consistency (MEDIUM/HIGH).** Prod is consistently Postgres (`eas.json:38,59` set `USE_LIVE_SERVICE_WALLET=true`) — **good**. But defaults differ across surfaces (`HeaderWalletBalances.js:8-14` defaults legacy Firestore; `GiftSystem.js:35-46`/`CoinStoreScreen.js` default live), `BlypCoinWallet.js:129` still claims daily reward via Firestore in live mode, and `ProfileScreen.v3.tsx:190-201` falls back to Firestore balance on live-fetch error (mixes stores). Centralize the flag; never cross-read stores.
- **P2.6 — Team bonus durability (MEDIUM).** `applyTeamGiftBonus` is post-commit non-fatal with no retry/backfill (`economyService.ts:1159`). Add reconciliation.

> **Refuted in money pass (don't re-investigate):** Android consumable IAP is solid (server verify + global token dedupe + cross-user reject + `forUpdate` lock + acknowledge — `economyService.ts:108-157,632-647,734-771`); subscription Firestore/Postgres split-brain is fixed; replay-to-same-uid is idempotent.

## Phase 3 — iOS parity (required for both-platform release)

- **P3.1 — iOS IAP / StoreKit (CRITICAL).** No StoreKit client; purchases blocked on non-Android (`CoinStoreScreen.js:335-337`); server throws 503 for iOS (`economyService.ts:160-165`); catalog is Android-only (`iapCatalog.ts:35-37`); `APPLE_*` env vars declared but unused (`economyEnv.ts:25-28`). Coin packs, subscriptions (`subscriptionService.js:5-19`), and matchday top-up (`matchdayEntitlementService.ts:115-130`) are all Play-only. Add a StoreKit 2 client + App Store Server API verify + iOS SKUs.
- **P3.2 — iOS live streaming crash path (CRITICAL).** IVS hooks call `getIVSNativeClient()` at init regardless of `enabled` (`useIVSHostSession.ts:81`, `useIVSViewerSession.ts:93`, `useIVSRoomSession.ts:82`) and the client constructor throws when native modules are absent (`IVSNativeClient.ts:70-79`). `StreamingFeatureConfig.ts:15-16` hardcodes `IVS`, ignoring the platform-aware factory guards (`StreamingBackendFactory.ts:33-46`). Lazy-init behind `hasNativeIVSModules()`, default HLS, route through `getStreamingBackendId()`, produce a real iOS prebuild. (`withIVSiOS` plugin exists, so a prebuilt iOS binary can host; the crash is on any IVS screen mount before guards / Expo Go.)
- **P3.3 — EAS iOS build/submit + plist (CRITICAL).** No `ios` build profiles (`eas.json:6-62`); submit uses placeholder Apple ID/`ascAppId` (`:71-75`); no `UIBackgroundModes`/`aps-environment`/push entitlements (`app.config.js:72-79`); `withIVSiOS.js:54-56` sets only `audio` background mode; missing `NSPhotoLibraryAddUsageDescription`. Add iOS profiles, real submit creds, `remote-notification` background mode, push entitlements, usage strings.
- **P3.4 — APNS payload + iOS permission pre-checks (HIGH).** APNS payload is `sound:default` only — no `badge`/`content-available`/`mutable-content` (`sender.ts:74-83`). `permissions.js:8-9,38-39` returns `true` for camera/mic on iOS without a real check, so guest publish skips the prompt (`LiveStreamViewer.js:356-357`). Add payload fields; request real iOS camera/mic. (Push-permission flow and host-path camera perms are OK.)

## Phase 4 — Verified crashes & top user-facing bugs

- **P4.A — IVS viewer never auto-exits on host end (HIGH).** IVS viewers get a passive "Stream ended" overlay with no `onError`/navigation (`LiveStreamViewer.js:520-530,1030-1033`) and skip the Firestore `status` subscription that the HLS path uses (`LiveStreamScreen.js:1157-1175`); auto-reconnect retries 3× after the host leaves (`useIVSViewerSession.ts:481-502`). Subscribe `liveStreams/{id}` for `status==='ended'` in the IVS path and navigate to summary; disable reconnect once ENDED. (HLS path is correct.)
- **P4.B — Live start partial-failure has no rollback (HIGH).** If `createFirestoreStream()` fails after native `startStreaming()` succeeds, the catch only `setIsStreaming(false)` — no `stopStreaming()`/`endHostLive`, leaving an orphaned IVS/Dynamo session (`LiveStreamScreen.js:1656-1744`, `useIVSHostSession.ts:144-181`). Add a compensating native stop in the catch.
- **P4.C — LIVE badge before native connected (MEDIUM).** `setIsStreaming(true)` fires right after Firestore, not on `localJoined`/`connectionState==='connected'` (`LiveStreamScreen.js:1679-1682`; true signal at `useIVSHostSession.ts:330-335`). Gate the LIVE pill + timer on connected.
- **P4.1 — Moderation `.exists` crash (HIGH).** `ModerationControlService.js:28,38,64` use `snap.exists` as a property → throws on first mute/kick/slow-mode in web-modular release builds. Use the `snapExists`/`snapData` helpers. (Re-verify; other historical `.exists` offenders in `useCommon.js`, `ProfileScreen.js`, `ActivityFeed.js` should be swept too.)
- **P4.5 — Like reconcile window (MEDIUM).** `likePendingRef` is cleared in `finally` before the snapshot may deliver the confirmed `likedBy`/count, leaving a stale-snapshot flash (`HomeScreen.js:657-677,914`). Keep pending until the snapshot confirms.
- **P4.8 — Stale-live ghosts in ChatList (MEDIUM).** Discovery/LiveUsersTab correctly filter `status=='live'` + 90s heartbeat (good), but `ChatListScreen.js:265-268` queries `userProfiles.isLive==true`, which the IVS path never sets (`LiveService.js:243` updates `users.status` only). Mirror `isLive` or query `liveStreams` with a heartbeat cutoff; add a scheduled sweep for heartbeat-stale `live` docs (`cleanupOldStreams` doesn't, `index.ts:745-794`).
- **P4.4 — Deep-link routing (MEDIUM).** Push routes to `'Home'` as if a root route, but it's a tab under `MainTabs` (`App.js:741`, tabs at `:324-327`); cold-start taps before login are lost (`:714-715`). Use nested navigation; persist+replay pending payload after login.
- **P4.10 — Error boundaries + listener leaks (HIGH).** Wrap Home/Media/Profile/Chat in boundaries; fix the `ChatListScreen` listener leak (P5/messaging below).

## Phase 5 — Data integrity

- **P5.1 — `commentCount` never incremented (HIGH).** Comment writes go to the subcollection only; the post doc's `commentCount` is never updated (`CommentsModal.js:419-432`, post created with `0` at `ReviewScreen.js:2490`); the feed badge reads modal-local then stale `post.commentCount` (`HomeScreen.js:1021-1039`). Increment in a transaction or via a CF trigger.
- **P5.6 — Follower/following count schema mismatch (HIGH).** `ProfileScreen.v3.tsx:340-346` and `ProfileScreen.js:87` read deprecated top-level `followers` while the canonical model is subcollections under `users/{uid}` (`followUtils.js:27-50`) → wrong counts. Read from subcollections.
- **P5.3 — Team membership lifecycle (HIGH).** `acceptJoinRequest` only `increment(1)`s `memberCount` (`teamsService.js:190-198`); there is **no** `leaveTeam`/`removeMember`/decrement. Implement symmetric membership + decrement.
- **P5.2 — Unify live counters (MEDIUM).** `viewCount` (HLS, `HLSLiveStreamService.js:972-979`) vs `viewerCount` (IVS, `LiveService.js:302-329`); viewer UI maps one to the other (`LiveStreamViewer.js:1146,1701-1702`). Pick one canonical field.
- **P5.4 — Denormalized staleness (MEDIUM).** Author name/avatar copied onto posts/comments/conversations; `likes`/`likeCount` + `comments.length`/`commentCount` fallbacks at `ProfileScreen.v3.tsx:845,849`. Converge on canonical fields.
- **P5.7 — Dead messaging service path (LOW).** `conversationsMessagingService.js:275-291` references an undefined `senderProfile`. Remove/fix before any caller uses it.

## Phase 6 — Cost / scalability hardening

- **P6.1 — Delete IVS stages on end (HIGH).** `endLiveSession` only marks Dynamo ENDED — no `DeleteStage` (`liveService.ts:423-426`); `leaveRoom` never deletes the shared stage (`roomsService.ts:202-204`). The legacy Firebase path **does** delete (`functions/src/live/liveService.ts:182-183`) — port it. Tear down AWS resources on end / last-publisher-leave.
- **P6.2 — Bound `users` listeners (CRITICAL scale).** Messenger/FindPeople subscribe to the **whole** `users` collection (`messengerUsersService.js:6-8`, `MessengerScreen.js:370-408`, `FindPeopleScreen.js:63-66`). Replace with paginated/search-indexed queries; load only thread participants + search results.
- **P6.3 — Fix N+1 in snapshot callbacks (HIGH).** Per-item `getDoc` inside `onSnapshot` handlers (`ChatListScreen.js:270-281,352-362`, `MessengerScreen.js:471-473`). Denormalize or batch `getAll`/`docChanges()` only.
- **P6.4 — Dedupe wallet polling (HIGH).** 5s `/wallet` polls across Home/header/wallet/store; consolidate to one backoff-aware source, pause in background.
- **P6.5 — Rate limiting (HIGH).** No global limiter on most live-service mutations or Firestore-direct actions; add limits on gifts/comments/likes/follows/DMs/search-AI/account+post creation (ties to P1.7, P2.5).
- **P6.6 — Cloud Functions cost (MEDIUM).** `updateStreamAnalytics` fires every 30s heartbeat with unbounded `arrayUnion`; review `minInstances` and sweep frequencies.

## Phase 7 — Feature logic completeness

- **P7.2 — Server-authoritative battle scoring (CRITICAL/HIGH).** Battle `score` is client-writable (`firestore.rules:885-888`); `battleService.js:354-363` increments score directly, and the gift socket handler also adds score client-side (`LiveStreamScreen.js:977-984`). Move scoring server-side on `/gift/send`; make clients read-only on `score`.
- **P7.5 — `kickGuest` route missing (HIGH).** The client calls `POST /api/live/guest/kick` (`ivsLiveApi.ts:1077-1082`) but no such route exists. Implement it with host-auth + `leaveGuest(..., {force:true})`.
- **P7.1 — Audition scheduling (HIGH).** No function starts/ends the 10pm battle; missing composite index for `auditionOpponentSweep`; idempotent acceptance (`auditionFlow.ts`, `firestore.indexes.json`).
- **P7.3 — Push reliability (HIGH).** Add an FCM token-refresh listener (`PushService.js:98-148`), `unregisterPush` on logout (`useCommon.js:73-94`), re-queue `no_device` when a device registers (`dispatcher.ts:74-81,141-145`), Android 13+ `POST_NOTIFICATIONS` manifest permission + runtime request (`AndroidManifest.xml`, `PushService.js:106-111`).
- **P7.6 — Follow from feed doesn't persist (HIGH/INFO).** `HomeScreen.js:918-929` `handleFollow` only toggles local state + `console.log`, never calls `followUser` (`followUtils.js:17`). It appears **unused** (real follow works in `MediaViewerScreen.js:1248-1259`) — wire it if surfaced, else remove the dead stub. Also wire SearchScreen/FindPeople follow buttons.
- **P7.7 — Post-publish lands on HomeBase, post buried (HIGH).** After publish the user goes to `MainTabs→Home` (HomeBase, not the feed) and the new post is appended to the **end** of the ranked feed (`ReviewScreen.js:2515`, `HomeScreen.js:229,644-647,1617-1627`). Switch to For You (`selectedTab:'A'`), prepend the new post, and scroll to top.
- **P7.4 — Search is mock data (HIGH).** `searchService.js` returns hardcoded users/posts/trending with fake verified badges; its Follow button is decorative. Wire real users/posts queries or hide the tab (trust-killer).

## Phase 8 — Quality gates & operational readiness (prerequisite — stand up early)

> Partial progress since v3: client lint/typecheck/test gates and rules-test gating are now **blocking** (see §A). Remaining gaps below are still high-leverage.

- **P8.3 — Backend economy tests (CRITICAL).** `backend/blyp-live-service/` has **zero** test files for ~1900 LOC of economy/gifting/escrow/IAP/idempotency; the backend CI job is typecheck-only (`qa.yml:52-65`). Add unit/integration tests **before** the Phase 2 money refactors; add a `npm test` job for the live-service.
- **P8.5 — Observability (HIGH).** Sentry never initializes (no DSN, `sentry.js:21-22`; reads `process?.env?.` that may not inline, `:14`); `GlobalErrorHandler.ts` only `console.error`s and is **never imported**; global handler async-imports Sentry after errors can fire (`App.js:587-628`). No Cloud Monitoring/uptime alerts on `/ready`, Functions, or push. Wire the DSN via `Constants.expoConfig.extra`, eager-init, add GCP alert policies, and point uptime checks at `/ready` (not `/health`, which returns 200 when `ready:false`, `index.ts:60-83`).
- **P8.7 — Automated deploy / drift checks (HIGH).** No deploy workflows (only `qa.yml`, `rules-tests.yml`); Firestore rules/indexes/Functions deploy manually → drift. `devResetFirestore` ships with the Functions bundle. Add deploy automation or a drift-check job (rules hash, function list); remove `devReset` from prod exports.
- **P8.4 — Real regression gate (HIGH).** `RUN_PRE_RELEASE_REGRESSION_GATE.ps1` checks config/git hygiene, not behavior. Wire the Detox/Appium scaffolding into a smoke suite (go-live, gift, like, post, login).
- **P8.6 — Static-analysis depth (MEDIUM).** Consolidate the duplicate rules workflow (`rules-tests.yml` Node 18 vs `qa.yml` Node 20); add Functions unit tests; incrementally type the largest JS screens/services.

## Phase 9 — Resilience & data durability

- **P9.1 — Backups / DR (CRITICAL).** No Firestore export schedule, Postgres backup/PITR, or DynamoDB backup in repo/IaC (`render.yaml:1-45`) — and wallet/ledger financial data lives in Postgres. Enable Cloud SQL PITR + scheduled Firestore exports + DynamoDB backup; write a restore runbook (the existing `BACKUP_RESTORE_PLAN.md` is UI-only).
- **P9.2 — Real schema migrations (CRITICAL).** Live-service uses boot-time `CREATE TABLE IF NOT EXISTS` only — it **cannot ALTER** existing tables (`schema.ts:14-16`); `migrate` references a missing `knexfile.cjs` (`package.json:13-14`); IAP seed uses `onConflict().ignore()` so catalog coin changes never apply (`schema.ts:314-315`). Add versioned knex migrations + rollback; reconcile SKU rows explicitly.
- **P9.3 — Contain `devResetFirestore` (HIGH).** Exported to prod (`index.ts:17`) and only blocked when `BLYP_ENV`/`NODE_ENV` is exactly `production`/`prod` — `unknown` passes and wipes `users`/`userProfiles`/`posts`/`liveStreams` (`devReset.ts:34-37,82-87`). Fail closed unless `FUNCTIONS_EMULATOR`/explicit dev project, or remove from deploy.
- **P9.4 — Externalize in-memory state (HIGH).** Admin sessions are an in-memory `Map` (`adminRoutes.ts:112,123-130`) → lost on restart, broken across instances. Move to Redis/Postgres with TTL.
- **P9.6 — Config single-source-of-truth (CRITICAL/HIGH).** Streaming backend is split (env vs hardcoded IVS — P3.2); `firebase.js:37-44` falls back to hardcoded `blyp-master` if env unset; the wallet flag is read ad hoc across 8+ files and defaults to legacy Firestore; `.env.example` is referenced but **not committed**; Sentry DSN false in all env files (`_env_key_presence.csv:357-361`). Add a validated required-env manifest checked at boot/build + a committed `.env.example`; require `CORS_ALLOWED_ORIGINS` in prod.
- **P9.5 — Dependency hygiene (MEDIUM).** `firebase-admin` skew (^12/^13.5/^14 across `functions`/backend/root); `node-fetch@2` in functions; `firebase-admin` in mobile app deps. Align majors; migrate to native `fetch`.

## Phase 10 — Accessibility & offline resilience

- **P10.1 — Accessibility (HIGH).** `allowFontScaling={false}` on 60+ core UI texts disables Dynamic Type; `accessibilityLabel`/roles are sparse (~20 repo-wide); touch targets 30×30 below 44pt (`HomeScreen.js:1857,1902`); no captions. Remove the font-scale flag, add labels/roles/hitSlop, expose captions.
- **P10.2 — Offline persistence + global UX (HIGH).** Web Firestore has no `enablePersistence` (`firebase.js:163`); no global offline banner despite NetInfo installed (used only for stream quality, `LiveStreamViewer.js:42,1200`). Enable persistence, subscribe NetInfo in `App.js`, add a connectivity banner + draft resume + retry outbox.
- **P10.3 — Consistent loading/error states (MEDIUM).** `PSkeleton` is unused; flows mix spinners/blank/Alerts/toasts and some silent `catch {}`. Standardize skeleton + one error/empty pattern; catch raw Firebase/Cognito error text before it reaches toasts.

## Phase 11 — First-run flow & email deliverability (first-impression / conversion)

### Email deliverability (the spam problem)
- **P11.1 — Deploy the SES / custom-domain sender (CRITICAL, ops).** IaC sets `emailSendingAccount:'DEVELOPER'` + SES `blyp.world` + `safety@blyp.world` (`amplify/backend/auth/369369369a1962b5f/override.ts:27-31`) but there's **no evidence it was `amplify push`ed**. If still `COGNITO_DEFAULT`, verification mail goes from the shared sender → spam. Verify with `aws cognito-idp describe-user-pool ... --query UserPool.EmailConfiguration`.
- **P11.2 — Complete SES + DNS prerequisites (CRITICAL, ops).** Per `tools/email/wire_cognito_ses.ps1`/`scripts/setup_cognito_email_blyp.ps1`: SES identity + DKIM CNAMEs, custom MAIL FROM (MX+SPF), `_dmarc` TXT, the Cognito send policy, and SES production access (exit sandbox), then `amplify push`.
- **P11.4 — Brand/harden templates (HIGH/MEDIUM).** Only signup-verification is customized (plain text); reset still uses generic copy. Add branded From-name + HTML on all paths; tighten DMARC `p=none`→`quarantine` after monitoring; add a manual-resend cooldown.

### First-run flow
- **P11.5 — Fix screen-gate flashes (HIGH/CRITICAL).** New authed users flash Home before onboarding (gate only renders onboarding when `onboarded===false`, else falls to `<AppStack/>` while `null` — `App.js:1077-1087` partially mitigates with a spinner, but `isOnboarded()` read failure does `setOnboarded(true)` → **skips onboarding**, `:579-580`). Returning guests flash AuthScreen because `isGuest` hydrates async from `false` (`guestSessionService.js:64-70`; `showApp` computed pre-hydration at `App.js:1063`). Gate on hydration; default new users to `false` on read error.
- **P11.6 — Resend uses opaque username (HIGH).** Unconfirmed-login resend uses the **email** username, not the stored opaque `confirmUsername` (`AuthScreen.js:301-302`) → can silently fail on alias pools, exactly when the first mail went to spam. Thread `confirmUsername` through all resend paths.
- **P11.7 — Verification UX polish (MEDIUM/HIGH).** `UserNotConfirmedException` auto-resends on login (`:299-310`) — make explicit; confirm flow has no timeout → infinite "Confirming…" on hung network (`:230-266,761`); persist pending-verification state; add change-email + 6-digit hints.
- **P11.9 — Social login is a no-op (HIGH, if enabled).** OAuth completes then `handleAuthSuccess` without minting a Cognito session (`AuthScreen.js:494-544`) and swallows errors. Wire token exchange or hide the buttons (also bypasses the age gate — P0.5).
- **P11.10 — Onboarding flow integrity (HIGH).** "Skip" bypasses interests + follow-creators (zero personalization); no back nav / mid-flow persistence — quitting resets to step 0. Add back handling + persist step/selections. (Acceptance recording at `OnboardingScreen.js:168,462` is good.)
- **P11.11 — Misleading trial CTAs (MEDIUM).** Guest "Start my 30-day free trial" only flips to signup; onboarding plan cards show success alerts even when billing isn't wired / on iOS. Align copy with real billing (ties P2/P3).

---

## Efficiency track (top priority — runs alongside Phase 1)

### E-A — Mobile data usage
- **E-A.1 — VOD transcoding + adaptive bitrate (CRITICAL).** Posts upload raw full-res MP4 (`ReviewScreen.js:2234-2254`); transcode triggers only for live segments (`index.ts:300-302`); import worker uploads full files (`blyp_import_worker.js:297-337`). Build a VOD rendition ladder/HLS. **Biggest single data win.**
- **E-A.2 — Stream, don't full-download (CRITICAL).** `videoCache.js:65-74` downloads the entire MP4 before playback; `EnhancedVideo.js:38-40` always resolves through it; `HomeScreen.js:1110-1123` prefetches the next full video → ~0.5–1.5 GB/session. Stream first; cap prefetch to manifest/first segment; Wi-Fi-only full cache with LRU.
- **E-A.3 — Cellular autoplay policy (HIGH).** Feeds autoplay unmuted (`HomeScreen.js:1285,1527`). Default muted + poster-only on cellular via NetInfo; load only the active video.
- **E-A.4 — Image resize/compress + grid thumbs (HIGH/MEDIUM).** No resize on upload (`ReviewScreen.js:2242-2245`); grids/avatars use full Storage URLs (`ProfileScreen.v3.tsx:808-823`, `UserProfileScreen.js:315-316,409-410`, `BlypAvatar.js:33`). Resize on upload; serve `_thumb`/`_grid` variants; adopt `expo-image`.
- **E-A.5 — Slim the feed schema / detach listeners (CRITICAL).** Feed `onSnapshot` re-delivers 30 full docs (incl. `likedBy[]`) on any like (`HomeScreen.js:569-576,625-650`). Read counts/thumbs only, move `likedBy` to a subcollection, patch via `docChanges()`, detach realtime after initial load.
- **E-A.6 — Storage Cache-Control + lifecycle (MEDIUM).** Set `public, max-age, immutable`; add bucket lifecycle for imported videos.

### E-B — Render / fluidity
- **E-B.1 — Memoize the feed row (HIGH).** Extract a memoized `FeedPostRow`, `useCallback` the `renderItem`, hoist `FeedActionButton`/`FeedStatBadge` to module scope, incremental-merge on snapshot (`HomeScreen.js:949-991,1196,1643,625-650`).
- **E-B.2 — MediaViewer pager (HIGH/MEDIUM).** `React.memo` the item, pass `isActive` via ref so `renderItem` is stable, gate decoder mount to active±1, `windowSize=1` (`MediaViewerScreen.js:157,600-619,1331-1343,1380-1382`).
- **E-B.3 — Messenger row remount (HIGH).** Hoist `SwipeableChatBar` to module scope + `React.memo`; stable `renderItem` (`MessengerScreen.js:816-918`).
- **E-B.4 — Reanimated migration (MEDIUM).** Move heart bursts/swipe-to-delete off the JS thread; replace `setInterval`+setState countdowns with shared values.
- **E-B.5 — Defer mount work (HIGH).** Lazy-start listeners per visible tab; `InteractionManager` for non-critical subscriptions; throttle `onPlaybackStatusUpdate` setState.
- **E-B.6 — Image stack discipline (HIGH).** Adopt `expo-image` with cache policy; enforce thumbnail URLs in all grids/avatars.

---

## Cross-cutting execution principles

- **Verify before edit:** re-confirm each file:line at edit time.
- **Rules + server together:** every client-side gate (blocks, entitlements, scores, host actions) needs a matching server/rules enforcement — IDOR gaps let clients bypass UI.
- **Fail closed for security; fail open only where availability > risk and it's documented.**
- **Idempotency everywhere money/notifications move** (and bind purchase tokens to a single uid).
- **Test on a real web-modular release build** (Hermes + web Firestore) — that's where `.exists` and env-inlining bugs live.
- **Cross-platform parity check** (Android + iOS) for every feature touched.

## Confirmed NON-issues (do not spend effort)

- `users/{uid}` self-grant admin — **fixed** (rules freeze `isAdmin`/`roles`).
- Subscription Firestore/Postgres split-brain — **fixed** (credits Postgres).
- Perpetual-Plus on missing `currentPeriodEnd` / ignoring `status` — **refuted** (fail-closed; status honored).
- Android coin IAP — solid (server verify, global token dedupe, cross-user reject, `forUpdate`, acknowledge).
- Rules tests "log but pass" + client CI gates absent — **fixed** (now blocking).
- Gemini key in main bundle (primary path) — **refuted** (proxy sentinel); only legacy fallback remains (P1.10).
- `conversations`/`streams/messages`/`rooms`/`/internal/*`/`/test` rules — correctly scoped/denied.
- Cognito username-vs-sub UID divergence — does not trigger on normal login.
- Team gem bonus math ("2.5 gems") — correct (micro-gem remainder).
- Staked-battle escrow settlement — participant-gated + idempotent (only the score layer is tamperable — P7.2).
- Service-account JSON / keystore / `.env*` — gitignored; no AWS keys committed.

## Suggested sequencing

1. **Now / parallel foundation:** P8.3 (backend economy tests) + P8.5 (Sentry) + Efficiency E-A.1–E-A.3 — safety net + biggest data win.
2. **Launch-gating:** Phase 0 (moderation/deletion/minor-safety/EULA/resolve) + Phase 1 (host auth, IDOR, blocks, JWT) + P9.1 (backups).
3. **Revenue/correctness:** Phase 2 (gift-to-non-host, token binding, gifting throttle) + P9.2 (migrations) before touching economy schema.
4. **Cross-platform:** Phase 3 (iOS parity).
5. **Tester-felt bugs:** Phase 4 (IVS viewer exit, live rollback) + Phase 5 + Efficiency E-B.
6. **Hardening/finish:** Phases 6, 7, 9 (remaining), 10.
7. **First-impression (cheap in-repo wins now):** Phase 11 — P11.5 gate flashes + P11.6 resend are small; P11.1/P11.2 are AWS/DNS ops.

## Roadmap maturity snapshot

| Dimension | State | Gating phase |
|-----------|-------|--------------|
| Security (rules/authz) | Admin self-grant fixed; host-auth + IDOR holes remain | P1 |
| Legal/compliance | Moderation exists but off/fail-open; deletion partial; age bypass | P0 |
| iOS parity | Not shippable (no IAP, IVS crash path) | P3 |
| Money correctness | Split-brain fixed; gift-to-non-host + token binding open | P2 |
| Data efficiency | Heavy (full-res video, full-doc snapshots) | E-A |
| Fluidity | Good bones, re-render storms | E-B |
| Test/CI safety net | Client gates fixed; backend untested; Sentry off | P8 |
| Backups/DR/migrations | Absent / unsafe | P9 |
| Accessibility/offline | Largely unaddressed | P10 |
| First-run / email | Deploy-state unverified; gate flashes | P11 |

## Items requiring info outside the repo (cannot verify statically)

- Cloud SQL / Render Postgres PITR + Firestore scheduled exports; DynamoDB backup.
- Deployed Functions `NODE_ENV`/`BLYP_ENV` (affects `devReset` safety) and whether `devResetFirestore` is in the live bundle.
- Live Cognito `EmailConfiguration` (is SES `override.ts` deployed, or still `COGNITO_DEFAULT`?) and SES `blyp.world` DKIM/MAIL FROM/DMARC/sandbox state.
- Whether deployed Firestore rules match the repo (manual-deploy drift).
- Managed Redis persistence/eviction mode.
- App Store / Play Console: Data Safety, age-rating, moderation attestation.
