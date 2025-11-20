# BLYP Mission Statement (Authoritative)

## App foundation

- React Native + Expo (Dev Client + EAS), dark theme, gradient accents, bottom tabs + stack navigation.
- Centralized Firebase via React Native Firebase (Auth, Firestore, Storage). Feature flags (build-time + remote) for LiveStreaming.
- Smart scripts: startup, status checks, and a production build guide.

## Authentication & profiles

- Firebase Auth, profile screen with user posts, avatar/name/bio.
- Followers/following counts with real-time subscription and cleanup utilities (remove fake followers, test follower injectors).

## Creation & media pipeline

- Capture/import photos, videos, and audio (voice memos).
- Uploads via RNFirebase Storage (no Web SDK blobs), normalized Firestore post schema.
- Thumbnails for videos; multi-photo posts supported; null-safe Firestore writes (no undefined fields).
- AI assist scaffolding for captions/descriptions and voice-to-text.

## Feeds & discovery

- Discover feed + Following feed; multi-media carousel when posts have multiple items.
- Enhanced video player (expo-av), audio tiles for audio-only posts.
- Prefetching and connection warm-ups to reduce start latency and black screens.

## Social graph & reactions

- Likes (atomic counters + likedBy array).
- Follows/unfollows; activity records (like/unlike/follow/unfollow, etc.).
- Heart animations on like; smooth UI updates.

## Comments & sharing

- Comments UI with nested replies model ready.
- System share (Share API) for posts; share metadata patterns (title/caption) and deep link hooks prepared for extension.

## Hashtags, topics, and search

- Hashtags tab, categories, WhatsApp-popular tab; search service and Firestore indexes present.
- Query strategies (where/orderBy/limit) tuned to avoid heavy reads.

## LiveStreaming (broadcast and view)

- HLS-based live broadcasting (segment + manifest handling backed by Storage).
- Viewer support at scale via CDN caching of HLS; real-time counters in Firestore (views/likes).
- Safety and cleanup: end-of-stream finalization; TTL cleanup of abandoned content.
- Rollout controls: build-time and remote flags, plus a rollback plan.

## Gifts, coins, and rewards

- GiftSystem component for in-app gifting UX.
- BlypCoin wallet to track balance and transactions; DailyRewards for recurring engagement.
- Gem/Gift services for credits, boosts, anti-abuse throttles, and ledger updates.
- Live gifting overlay/animations support (sentiment bursts, stackable effects) with Firestore-backed increments.

## Chat & messaging

- Chat list and conversation screens; chat room service.
- Real-time threads, unread counts, delivery state updates.
- Hooks for presence/typing indicators and message status; scalable subcollection design.

## Activity & notifications

- Activity feed (likes, follows, comments, shares).
- Unread counts and mark-as-read batching.
- Firestore queries are subscription-based for “instant” feel.

## Animations & UX polish

- HeartAnimation on likes; gradient and motion accents across screens.
- Focus-aware media playback, lifecycle-safe loading/unloading for memory.
- Gift animations and overlays during lives; smooth counters.

## Moderation & safety

- Firestore/Storage rules; guarded schema (no undefined).
- Content cleanup utilities; soft-delete/visibility flag pattern ready.
- Throttling patterns (likes/comments/gifts) to deter spam.

## Performance & reliability

- Prefetch next media, connection warm-ups, cache-aware playback.
- Bounded listeners with proper unsubscribe; batch writes for bulk operations.
- Avoids external media fallbacks; resilient error handling and retries.

## Observability & controls

- Structured logging for critical flows (uploads, live manifest updates).
- Feature flags to disable risky features instantly.
- Analytics/Crashlytics hooks planned/assumed per RNFirebase setup; verify runtime config before claiming “on.”

## Build & release

- EAS build pipeline for Android; signed artifacts; Play Store submission guide.
- Startup scripts to clear caches, test connectivity, tunnel fallback for networks.
- Staged rollout + rollback via feature flags.

## Experimental/optional modules

- Games/multiplayer utilities (separate folder) and enterprise-oriented docs.

## End-to-end run-through (user + system flows)

### Create and post
- User captures/imports media (photo/video/audio). If video, we produce a thumbnail; if audio, an audio tile is created.
- Uploads go via RNFirebase Storage; Firestore doc is written with normalized media[], counters set to 0, serverTimestamp.
- Activity is tracked; feeds auto-update via subscriptions.

### Feeds and interactions
- Discover/Following load posts in order; upcoming media is prefetched and connections warmed.
- Like/unlike with heart animation; counts update atomically and reflect everywhere.
- Comments open; replies modeled; user can share via system share sheet.
- Hashtags/categories surfaces show relevant groups; search lets users find content and creators.

### LiveStreaming
- Creator starts a stream: stream doc created, HLS segments/manifest written to Storage with atomic updates.
- Viewers join; HLS plays; counters update in Firestore. Gifts trigger overlay animations and increment user/stream tallies.
- On end: manifest sealed, counters snapshot, optional VOD/archive; cleanup jobs remove stragglers.
- If needed, LiveStreaming can be disabled instantly via remote flag.

### Gifting and rewards
- User opens GiftSystem overlay, spends BlypCoin balance (or collects DailyRewards) to send animated gifts during live.
- Transactions and leaderboards update in near-real time; throttles prevent abuse.

### Chat
- Users message through chat lists and conversations; unread badges appear.
- Message delivery state updates via Firestore; typing/presence hooks are extensible.

### Moderation + safety
- Users report content; moderators flag/soft-delete; Storage/Firestore rules enforce access.
- Cleanup tools remove fake/abusive followers and orphaned content.

## Anything missing or needing explicit callouts

- Push notifications: not explicitly wired in the visible code; can be added (Expo Notifications/FCM) for likes/comments/follows/live events.
- Like counters naming: some screens use likes vs likeCount; unify to one field and backfill.
- Analytics/Crashlytics: ensure config is active in the dev client and release builds; add key events (post create, live start/stop, errors).
- Deep links: optional, but recommended for shares and live invites.
- Anti-spam: rate limits for messages/comments; captcha or similar for abuse patterns (future).
- VOD for live: optional—archive HLS segments into a VOD post after stream ends.

## Pinning note

This mission statement is the single source of truth. It is referenced from EXECUTIVE_SUMMARY.md and PRODUCTION_READINESS_REPORT.md.
