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

| Screen              | Path                              | Status       | Notes                                       |
|---------------------|-----------------------------------|--------------|---------------------------------------------|
| Auth Screen         | /src/screens/AuthScreen.js        | Implemented  | Login/signup, partial social auth           |
| #4ME Feed           | /src/screens/HomeScreen.js        | Implemented  | Firestore feed, smooth video playback       |
| Camera Screen       | /src/screens/CameraScreen.js      | Implemented  | Photo/video capture with multi-photo mode   |
| Review Screen       | /src/screens/ReviewScreen.js      | Implemented  | Post creation/editing with AI enhancements  |
| Profile Screen      | /src/screens/ProfileScreen.js     | Implemented  | User profile, posts, stats, settings        |
| User Profile        | /src/screens/UserProfileScreen.js | Implemented  | View other users' profiles                  |
| Edit Profile        | /src/screens/EditProfileScreen.js | Implemented  | Edit user profile details                   |
| Messenger Screen    | /src/screens/MessengerScreen.js   | Implemented  | Chats, following, balances, live users      |
| Chat Conversation   | /src/screens/ChatConversationScreen.js | Implemented | 1-on-1 messaging interface            |
| Chat List           | /src/screens/ChatListScreen.js    | Implemented  | List of active chats                        |
| Chat Rooms          | /src/screens/ChatRoomsScreen.js   | Implemented  | Public chat room discovery                  |
| Chat Room           | /src/screens/ChatRoomScreen.js    | Implemented  | Public chat room participation              |
| Live Stream         | /src/screens/LiveStreamScreen.js  | Experimental | HLS-based live streaming (host/viewer)      |
| Games Screen        | /src/screens/GamesScreen.js       | Implemented  | Game browsing, matchmaking, live games      |
| Game Room           | /src/screens/GameRoomScreen.js    | Implemented  | In-game experience (Rock Paper Scissors)    |
| Coin Store          | /src/screens/CoinStoreScreen.js   | Implemented  | Purchase coins and gems for economy         |
| Search Screen       | /src/screens/SearchScreen.js      | Implemented  | Search interface for users and content      |
| Search Results      | /src/screens/SearchResultsScreen.js | Implemented | Display search results                    |
| Comments Screen     | /src/screens/CommentsScreen.js    | Implemented  | View and add comments on posts              |
| Followers Screen    | /src/screens/FollowersScreen.js   | Implemented  | View followers/following lists              |
| Find People         | /src/screens/FindPeopleScreen.js  | Implemented  | Discover and follow new users               |
| Media Viewer        | /src/screens/MediaViewerScreen.js | Implemented  | Full-screen media viewing                   |
| Post Preview        | /src/screens/PostPreviewScreen.js | Implemented  | Preview post before publishing              |
| Voice Memo          | /src/screens/VoiceMemoScreen.js   | Implemented  | Voice note recording for posts              |
| Moderation Queue    | /src/screens/ModerationQueueScreen.js | Implemented | Admin moderation interface             |

_(Future agents: keep this table updated when screens are added/modified.)_

## 2.2 Services & Core Logic

| Service                        | Path                                    | Status       | Notes                                         |
|--------------------------------|-----------------------------------------|--------------|-----------------------------------------------|
| HLS Live Stream Service        | /src/services/HLSLiveStreamService.js   | Experimental | Production HLS live streaming (segments)      |
| Live Service                   | /src/services/LiveService.js            | Experimental | Live presence, chat, interactions             |
| Firestore Live Service         | /src/services/FirestoreLiveService.ts   | Experimental | TypeScript live streaming helpers             |
| Blyp Coin Service              | /src/services/BlypCoinService.js        | Implemented  | Coin wallet, purchases, transactions          |
| Gem Service                    | /src/services/GemService.js             | Implemented  | Premium gem currency management               |
| Ledger Service                 | /src/services/LedgerService.ts          | Implemented  | Economic transaction audit trail              |
| Billing Verification Service   | /src/services/BillingVerificationService.ts | Partial  | Play Store purchase verification              |
| Game Service                   | /src/services/GameService.js            | Implemented  | Game creation, matchmaking, state mgmt        |
| Chat Room Service              | /src/services/ChatRoomService.js        | Implemented  | Public chat room management                   |
| Social Auth Service            | /src/services/socialAuthService.js      | Partial      | Google/Facebook auth integration              |
| Auth Consistency Service       | /src/services/AuthConsistencyService.js | Implemented  | Auth state synchronization                    |
| Enterprise Analytics Service   | /src/services/EnterpriseAnalyticsService.js | Implemented | Production-scale analytics & monitoring   |
| Enterprise Storage Service     | /src/services/EnterpriseStorageService.js | Implemented | Optimized media storage & CDN             |
| Error Monitoring Service       | /src/services/ErrorMonitoringService.js | Implemented  | Crash tracking and error reporting            |
| Moderation Queue Service       | /src/services/ModerationQueueService.js | Implemented  | Content moderation queue management           |
| Moderation Control Service     | /src/services/ModerationControlService.js | Implemented | Moderation actions and enforcement          |
| Reporting Service              | /src/services/ReportingService.js       | Implemented  | User content reporting system                 |
| AI Service                     | /src/services/aiService.js              | Implemented  | AI-powered content enhancement                |
| Gemini Speech Service          | /src/services/geminiSpeechService.js    | Implemented  | Speech-to-text via Google Gemini              |
| Media Description Service      | /src/services/mediaDescriptionService.js | Implemented | AI media analysis and captioning             |
| Search Service                 | /src/services/searchService.js          | Implemented  | User and content search                       |
| Cleanup Service                | /src/services/CleanupService.js         | Implemented  | Resource cleanup and maintenance              |
| Agora Service                  | /src/services/AgoraService.js           | Partial      | Agora RTC integration (not fully wired)       |

_(Future agents: keep this table in sync with reality after significant changes.)_

## 2.3 User Flows

### Auth Flow
- Baseline login/signup implemented.
- Social auth (Google/Facebook) partially implemented.
- Needs UX polish, error handling and loading states.

### Feed Flow (#4ME)
- Firestore-backed content.
- Prefetch / warm-connection logic present.
- Uses UnifiedVideo for playback.
- Needs ranking improvements, caching and offline behaviour.

### Live Flow
- Live-related services and screen(s) exist but are not production-ready.
- Backend endpoints and Agora integration still missing.
- Treat as EXPERIMENTAL until explicitly promoted.

# 3. Gaps & TODOs Before Public Beta

## 3.1 Live Streaming – Critical Gaps
- Implement backend endpoints:
  - POST /live/create
  - POST /live/join
  - POST /live/end
- Implement Agora token generation (Cloud Function or equivalent).
- Integrate Agora React Native SDK on the client.
- Build out:
  - GoLiveScreen (host setup, camera, mic, title, tags).
  - LiveRoomScreen (viewer/guest experience).
- Implement guest seat UI (target 4/8/16 guests).
- Implement coin gifting overlay and live interaction UI.
- Add live analytics and stability monitoring.

## 3.2 Monetisation
- Integrate Google Play Billing for coin purchases.
- Implement coin → gift flow.
- Implement creator payout system (wallet, withdrawal mechanics).
- Add anti-fraud checks, rate limiting and abuse detection.

## 3.3 Feed Quality
- Implement actual ranking algorithm (beyond naive ordering).
- Weighted engagement model (watch time, likes, shares, comments, gifts).
- Smarter prefetching for next videos.
- Creator boosting logic (e.g. new creators, events, battles).

## 3.4 UX & UI Polish
- Smooth transitions and navigation.
- Skeleton/loading states for feed, profiles and live.
- Proper error states with helpful messaging.
- Production-grade typography, spacing and layout consistency.

## 3.5 Observability
- Integrate and verify:
  - Crashlytics
  - (Optional) Sentry
- Define and emit key analytics events:
  - App open, session start/end
  - Feed scroll events
  - Video start/complete
  - Live start/end
  - Coin purchases, gifts sent

## 3.6 Performance
- Optimise bundle size (tree-shaking, dead-code removal).
- Implement aggressive but safe image/video caching.
- Identify and resolve memory leaks.
- Validate behaviour when app is backgrounded / foregrounded.

# 4. Agent Safety & Non-Regression Rules

These rules are **mandatory** for any agent touching this repo.

## 4.1 Hard Safety Rules
- NEVER modify or delete working auth logic without explicit approval from Alex.
- NEVER modify or delete #4ME feed logic without explicit approval from Alex.
- ALWAYS create a safety branch before touching:
  - Auth screens/flows
  - #4ME feed
  - Live streaming logic
  - Navigation / App.js
  - Core services (auth, feed, live, payments)
- NEVER "guess" intended behaviour. If unsure: **STOP and ask Alex.**
- NEVER auto-format large parts of the repo just to "clean up".
- NEVER add new dependencies without:
  - Explaining why they're needed.
  - Summarising impact on bundle size and maintenance.

## 4.2 Procedure Rules (Every Run)

Every agent run MUST follow this loop:

1. **READ**
   - Read this file.
   - Read the relevant screens/services you intend to change.
   - Summarise your intended plan in under 15 lines.

2. **CONFIRM**
   - Present that short plan to Alex.
   - Do NOT execute non-trivial changes until Alex explicitly approves.

3. **EXECUTE (SMALL STEPS)**
   - Make changes in small, reversible steps.
   - Run:
     - `npm run lint`
     - `npm run typecheck`
   - Report results back to Alex.
   - If anything fails or looks risky: **STOP and report.**

# 5. Workflow Contract for All Future Agents

1. Always load and read this file FIRST.
2. Treat this document as the canonical product + ops reference.
3. Update this document ONLY when:
   - A major feature is added/changed, or
   - A major architectural decision is made.
4. Never assume business logic or product intent — if this file doesn't say it and the code doesn't clearly define it, ask Alex.
5. Do not "speed run" major refactors. Blyp is a production app, not a toy.

# 6. Appendices

## 6.1 Baseline Feature List

### Screens (25 Production Screens)

- **HomeScreen** (`/src/screens/HomeScreen.js`) – #4ME feed with vertical video scrolling, engagement actions. Status: Implemented.
- **AuthScreen** (`/src/screens/AuthScreen.js`) – Login/signup with email/password and social auth entry. Status: Implemented.
- **CameraScreen** (`/src/screens/CameraScreen.js`) – Photo/video capture with front/back camera, multi-photo mode, emulator detection. Status: Implemented.
- **ReviewScreen** (`/src/screens/ReviewScreen.js`) – Post creation/editing with AI caption generation, media description, voice transcription. Status: Implemented.
- **ProfileScreen** (`/src/screens/ProfileScreen.js`) – Current user's profile with posts grid, stats (followers/following), settings access. Status: Implemented.
- **UserProfileScreen** (`/src/screens/UserProfileScreen.js`) – View other users' profiles, follow/unfollow, view their content. Status: Implemented.
- **EditProfileScreen** (`/src/screens/EditProfileScreen.js`) – Edit profile details (name, bio, avatar, cover photo). Status: Implemented.
- **MessengerScreen** (`/src/screens/MessengerScreen.js`) – Main messaging hub with tabs for chats, following users, live users, balances. Status: Implemented.
- **ChatConversationScreen** (`/src/screens/ChatConversationScreen.js`) – 1-on-1 chat interface with real-time messaging. Status: Implemented.
- **ChatListScreen** (`/src/screens/ChatListScreen.js`) – List of active chat conversations with unread counts. Status: Implemented.
- **ChatRoomsScreen** (`/src/screens/ChatRoomsScreen.js`) – Public chat room discovery and browsing. Status: Implemented.
- **ChatRoomScreen** (`/src/screens/ChatRoomScreen.js`) – Public chat room participation with real-time messages. Status: Implemented.
- **LiveStreamScreen** (`/src/screens/LiveStreamScreen.js`) – HLS-based live streaming for both host (broadcaster) and viewer modes. Status: Experimental.
- **GamesScreen** (`/src/screens/GamesScreen.js`) – Game discovery, browsing, matchmaking, live games list. Status: Implemented.
- **GameRoomScreen** (`/src/screens/GameRoomScreen.js`) – In-game experience for Rock Paper Scissors with betting. Status: Implemented.
- **CoinStoreScreen** (`/src/screens/CoinStoreScreen.js`) – Purchase coins and gems with package tiers, bonus amounts. Status: Implemented.
- **SearchScreen** (`/src/screens/SearchScreen.js`) – Search interface for discovering users and content. Status: Implemented.
- **SearchResultsScreen** (`/src/screens/SearchResultsScreen.js`) – Display and browse search results. Status: Implemented.
- **CommentsScreen** (`/src/screens/CommentsScreen.js`) – View and post comments on content with threading. Status: Implemented.
- **FollowersScreen** (`/src/screens/FollowersScreen.js`) – View followers and following lists for any user. Status: Implemented.
- **FindPeopleScreen** (`/src/screens/FindPeopleScreen.js`) – Discover and follow suggested users. Status: Implemented.
- **MediaViewerScreen** (`/src/screens/MediaViewerScreen.js`) – Full-screen media viewing with swipe gestures. Status: Implemented.
- **PostPreviewScreen** (`/src/screens/PostPreviewScreen.js`) – Preview post before final publishing. Status: Implemented.
- **VoiceMemoScreen** (`/src/screens/VoiceMemoScreen.js`) – Record voice notes to attach to posts. Status: Implemented.
- **ModerationQueueScreen** (`/src/screens/ModerationQueueScreen.js`) – Admin interface for reviewing flagged content. Status: Implemented.

### Services (23 Core Services)

- **HLSLiveStreamService** (`/src/services/HLSLiveStreamService.js`) – Production HLS live streaming with segment recording, Firebase Storage upload, viewer preloading. Status: Experimental.
- **LiveService** (`/src/services/LiveService.js`) – Live stream presence, chat messages, viewer counts, interactions. Status: Experimental.
- **FirestoreLiveService** (`/src/services/FirestoreLiveService.ts`) – TypeScript live streaming helpers and utilities. Status: Experimental.
- **BlypCoinService** (`/src/services/BlypCoinService.js`) – Coin wallet management, purchases (with server verification), transactions, gifting. Status: Implemented.
- **GemService** (`/src/services/GemService.js`) – Premium gem currency for enhanced features and boosts. Status: Implemented.
- **LedgerService** (`/src/services/LedgerService.ts`) – Economic transaction audit trail and immutable ledger. Status: Implemented.
- **BillingVerificationService** (`/src/services/BillingVerificationService.ts`) – Play Store purchase receipt verification. Status: Partial.
- **GameService** (`/src/services/GameService.js`) – Game creation, matchmaking, state management, betting with coins. Status: Implemented.
- **ChatRoomService** (`/src/services/ChatRoomService.js`) – Public chat room creation, management, real-time messaging. Status: Implemented.
- **socialAuthService** (`/src/services/socialAuthService.js`) – Google and Facebook OAuth integration. Status: Partial.
- **AuthConsistencyService** (`/src/services/AuthConsistencyService.js`) – Sync auth state across Cognito/Firebase/Firestore. Status: Implemented.
- **EnterpriseAnalyticsService** (`/src/services/EnterpriseAnalyticsService.js`) – Production-scale event tracking, stream health monitoring, performance metrics. Status: Implemented.
- **EnterpriseStorageService** (`/src/services/EnterpriseStorageService.js`) – Optimized media uploads, CDN integration, storage lifecycle. Status: Implemented.
- **ErrorMonitoringService** (`/src/services/ErrorMonitoringService.js`) – Centralized error tracking, crash reporting integration. Status: Implemented.
- **ModerationQueueService** (`/src/services/ModerationQueueService.js`) – Access moderation queue for admins, prioritization. Status: Implemented.
- **ModerationControlService** (`/src/services/ModerationControlService.js`) – Execute moderation actions (remove, restrict, ban). Status: Implemented.
- **ReportingService** (`/src/services/ReportingService.js`) – User-generated content reports and flagging system. Status: Implemented.
- **aiService** (`/src/services/aiService.js`) – AI-powered content enhancement, caption generation. Status: Implemented.
- **geminiSpeechService** (`/src/services/geminiSpeechService.js`) – Google Gemini API for speech-to-text transcription. Status: Implemented.
- **mediaDescriptionService** (`/src/services/mediaDescriptionService.js`) – AI-powered media analysis and auto-captioning. Status: Implemented.
- **searchService** (`/src/services/searchService.js`) – User and content search with Firestore queries. Status: Implemented.
- **CleanupService** (`/src/services/CleanupService.js`) – Automated resource cleanup and maintenance tasks. Status: Implemented.
- **AgoraService** (`/src/services/AgoraService.js`) – Agora RTC integration helpers (not fully wired to live flows). Status: Partial.

### Hooks (4 Core Hooks)

- **useAuth** (`/src/hooks/useCommon.js`) – Provides `{ user, uid, authReady, isAuthenticated, loading, error }` for auth state. Status: Core/Stable.
- **useIsAdmin** (`/src/hooks/useIsAdmin.js`) – Checks if current user has admin privileges. Status: Implemented.
- **useUnreadCount** (`/src/hooks/useUnreadCount.js`) – Tracks unread message count for badge display. Status: Implemented.
- **useModerationQueue** (`/src/hooks/useModerationQueue.js`) – Real-time moderation queue subscription for admins. Status: Implemented.

### Key Components (10 Critical Components)

- **UnifiedVideo** (`/src/components/UnifiedVideo.js`) – Unified video playback component with prefetch, caching, state management for feed. Status: Implemented.
- **CreatePostButton** (`/src/components/CreatePostButton.js`) – Plus menu for creating new posts (Photo/Video) and going live. Status: Implemented.
- **LiveStreamViewer** (`/src/components/LiveStreamViewer.js`) – HLS live stream viewer with dual-player preloading, retry logic. Status: Experimental.
- **LiveStreamBroadcaster** (`/src/components/LiveStreamBroadcaster.js`) – Live stream broadcasting component (multiple variants exist). Status: Experimental.
- **BlypCoinWallet** (`/src/components/BlypCoinWallet.js`) – Wallet display and management UI. Status: Implemented.
- **GiftSystem** (`/src/components/GiftSystem.js`) – Gifting UI for sending virtual gifts during live streams. Status: Implemented.
- **CommentsModal** (`/src/components/CommentsModal.js`) – Comments overlay modal for posts. Status: Implemented.
- **SearchBar** (`/src/components/SearchBar.js`) – Reusable search input component. Status: Implemented.
- **HeartAnimation** (`/src/components/HeartAnimation.js`) – Animated hearts for likes/engagement. Status: Implemented.
- **BlypLogo** (`/src/components/BlypLogo.js`) – Branded logo component with gradient options. Status: Implemented.

### Feature Domains Summary

**✅ Fully Implemented:**
- #4ME Feed (HomeScreen + UnifiedVideo)
- Auth System (Login/Signup + Social Auth Partial)
- Profile Management (View/Edit)
- Messaging (1-on-1 + Public Chat Rooms)
- Economy (Coins + Gems + Transactions + Ledger)
- Games (Rock Paper Scissors with betting)
- Search & Discovery
- Content Creation (Camera + Review + AI Enhancements)
- Moderation & Reporting
- Analytics & Monitoring

**🟡 Experimental/Partial:**
- Live Streaming (HLS-based, needs Agora integration + backend endpoints)
- Social Auth (Google/Facebook partially integrated)
- Billing Verification (server validation not fully wired)

**❌ Not Yet Implemented:**
- Multi-guest live streaming (4/8/16 seats)
- Creator payouts and KYC
- Push notifications
- Advanced feed ranking algorithm
- Real HLS/DASH playlists with CDN

## 6.2 Known Bugs / Open Issues
_To be curated as bugs are identified and confirmed._

## 6.3 Critical Paths
- Live streaming (end-to-end)
- Monetisation (coins, gifts, payouts)
- Feed ranking (#4ME)
- Auth stability and persistence
- Push notifications and re-engagement
