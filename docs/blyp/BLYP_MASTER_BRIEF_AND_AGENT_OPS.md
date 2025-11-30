# BLYP – Master Product Brief & Agent Operations Manual
_The Single Source of Truth for the Blyp Mobile Platform_

# 1. Product Vision (High-Level)
Blyp is a next-generation short-form video and live-streaming platform built to outperform TikTok in creator economics, feature depth, and user experience — without copying its weaknesses.

Core principles:
- Creator-first economics (higher payout rates, lower platform cut)
- Ultra-low-latency live streaming with up to 16 guest seats
- A personalised, addictive, ultra-smooth #4ME feed
- A global, scalable infrastructure built on modern streaming tech
- Professional reliability: zero crashes, zero regressions

# 2. Current Implemented Features (Snapshot)

## 2.1 Screens (Implemented or Partially Implemented)
| Screen | Path | Status | Notes |
|-------|------|--------|-------|
| Auth Screen(s) | /src/screens/AuthScreen.js | Implemented | Login/signup, partial social auth |
| #4ME Feed | /src/screens/HomeScreen.js | Implemented | Firestore feed, smooth video playback |
| Welcome / misc screens | various | Implemented | Basic foundation |

## 2.2 Services & Core Logic
| Service | Path | Status | Notes |
|---------|------|--------|-------|
| Feed Service | /src/services/feedService.js | Implemented | Firestore content flow |
| UnifiedVideo | /src/components/UnifiedVideo.js | Implemented | Prefetch + video handling |
| Auth Service | /src/services/socialAuthService.js | Partial | Needs refining |
| Live Services | /src/services/LiveService.js etc. | Experimental | Legacy HLS, Agora not integrated |

## 2.3 User Flows
### Auth Flow
- Implemented baseline login/signup  
- Partial Google/Facebook  
- Needs polish

### Feed Flow (#4ME)
- Firestore-backed  
- Prefetch logic  
- Needs ranking + caching improvements  

### Live Flow
- Stubs only  
- Backend endpoints missing  
- Agora migration pending  

# 3. Gaps & TODOs Before Public Beta

## 3.1 Live Streaming – Critical Gaps
- Implement /live/create, /live/join, /live/end
- Create Agora token function
- Integrate Agora SDK
- Build GoLiveScreen + LiveRoomScreen
- Guest seat UI (target 4/8/16)
- Coin gifting overlay
- Live analytics + monitoring

## 3.2 Monetisation
- Google Play Billing for coins  
- Gift system  
- Creator payout pipeline  
- Anti-fraud system  

## 3.3 Feed Quality
- Proper ranking  
- Weighted engagement  
- Smart prefetch  
- Boosting logic  

## 3.4 UX & UI Polish
- Transitions  
- Skeletons  
- Error states  
- Typography  

## 3.5 Observability
- Crashlytics  
- Sentry (optional)  
- Analytics events  

## 3.6 Performance
- Bundle size  
- Video caching  
- Memory leak fixes  

# 4. Agent Safety & Non-Regression Rules

## 4.1 Hard Safety Rules
- NEVER modify auth or #4ME feed without explicit approval  
- ALWAYS create safety branch before editing core areas  
- NEVER guess behaviour — STOP and ask Alex  
- NEVER auto-format the repo  
- NEVER add dependencies without an impact summary  

## 4.2 Procedure Rules
Step 1 — READ  
Step 2 — CONFIRM with Alex  
Step 3 — EXECUTE only after approval  

If anything breaks → STOP immediately.

# 5. Workflow Contract for All Future Agents
1. Load this file first  
2. Treat it as canonical truth  
3. Update this file only when major progress is made  
4. Never assume anything  
5. Never accelerate unless Alex commands it  

## Stage 2 – Stabilisation (Live, Economy, Safety)

### 2.1 Live Stream Model Unification

- Canonical live stream schema established:
	- `liveStreams` is the authoritative collection for active/ended streams.
	- Per-stream `segments` subcollection stores segment records (HLS-style chunks).
	- Presence / chat continues via dedicated presence collection (`streams`) during transition.
- Config module: `liveStreamModel` centralises:
	- Collections:
		- `LIVE_STREAMS_COLLECTION`
		- `SEGMENTS_SUBCOLLECTION`
		- `PRESENCE_STREAMS_COLLECTION`
	- Flags:
		- `ENABLE_LIVE_FEATURES`
		- `ENABLE_LIVE_SEGMENTS_SUBCOLLECTION`
		- `ENABLE_LEGACY_SEGMENTS_MAP`
		- `ENABLE_PLAYLIST_MANIFEST_VIEWER`
- Service refactor (`HLSLiveStreamService`):
	- Helpers: `createLiveStreamDoc`, `appendSegment`, `endLiveStream`.
	- Dual-write to legacy inline segments map + subcollection gated by flags.
	- Global kill switch short-circuits create / upload / end operations safely.
- Viewer (`LiveStreamViewer`): single source decision via `decideSegmentSource()` with priority:
	1. playlist (experimental ABR) → 2. subcollection → 3. legacy map.
- Unification migration strategy:
	- Legacy `segmentsMap` retained for backward compatibility; all transition points wrapped in `TODO(stage2-live-unification)` markers.
	- Planned removal: eliminate legacy map + dual-write once subcollection-only rollout validated.
	- Kill switch (`ENABLE_LIVE_FEATURES`) applied across services and UI for rapid disable.

### 2.2 Economy Safety & Billing Scaffolding

- Central economy config: `economyModel` defines collections & safety flags.
	- Collections:
		- `WALLETS_COLLECTION`
		- `TRANSACTIONS_COLLECTION`
		- `GIFTS_COLLECTION`
		- `GEMS_COLLECTION`
	- Flags (dev defaults preserve existing behaviour):
		- `ENABLE_PURCHASES = true`
		- `ENABLE_WITHDRAWALS = false`
		- `ALLOW_SIMULATED_CLIENT_TOPUPS = true`
		- `REQUIRE_SERVER_RECEIPT_VALIDATION = false`
	- Helper: `isUnsafeSimulationMode()` (true when purchases enabled, simulation allowed, server validation off).
- Services updated:
	- `BlypCoinService` & `GemService`:
		- Guard purchase/top-up entry points with economy flags.
		- Stub verification hooks: `verifyPurchaseWithServer`, gem equivalent (always ok now; marked TODO).
		- Replaced magic strings with shared collection constants.
		- Added `TODO(stage2-economy-safety)` for: server receipt validation, immutable ledger (derive wallet from transactions), fraud/velocity heuristics, moving daily rewards server-side.
- Store & gifting:
	- `CoinStoreScreen` respects `ENABLE_PURCHASES`; hides purchase UX if disabled; shows simulation banner when `isUnsafeSimulationMode()`.
	- `GiftSystem` emits analytics events:
		- `economy_gift_send`
		- `economy_gift_error`
		- Includes sender/recipient IDs, gift metadata, contextual post/stream info.
		- TODO markers for future gift fraud heuristics (velocity, multi-account).

### Agent Rules – Stage 2 Constraints

**Live**
- Do NOT introduce new collections or ad-hoc models for live streams/segments.
- Always use `liveStreamModel` constants for Firestore paths.
- Respect `ENABLE_LIVE_FEATURES` when adding new live entry points (creation, viewing, ending).
- Do NOT remove legacy `segmentsMap` / dual-write until all `TODO(stage2-live-unification)` items are explicitly approved.
- Playlist / ABR experimentation must stay behind `ENABLE_PLAYLIST_MANIFEST_VIEWER`.

**Economy**
- All wallet / transaction / gift writes MUST use `economyModel` constants.
- Any new purchase or top-up flow MUST gate on: `ENABLE_PURCHASES`, `ALLOW_SIMULATED_CLIENT_TOPUPS`, `REQUIRE_SERVER_RECEIPT_VALIDATION`.
- Extend `verifyPurchaseWithServer` (or gem equivalent) rather than bypassing validation logic.
- Do NOT embed real platform billing logic directly in client; route via a backend once implemented.
- Do NOT flip economy flag defaults without updating this brief.
- Fraud or anti-abuse logic additions must be clearly marked with `TODO(stage2-economy-safety)` if partially implemented.

**General**
- Preserve kill switches and feature flags; add new flags in the relevant model file (liveStreamModel / economyModel) not scattered.
- When deprecating legacy paths, retain fenced TODO markers until removal is merged & documented.

# 6. Appendices

## 6.1 Baseline Feature List
(To be filled by Baseline Discovery output)

## 6.2 Known Bugs / Issues
(To be filled manually)

## 6.3 Critical Paths
- Live streaming  
- Monetisation  
- Feed ranking  
- Auth stability  
- Push notifications
