# Missing Inputs (Config / Secrets / Endpoints)

Rules:
- Do not paste secrets/tokens/PII. Use [REDACTED].
- Every claim must include file + line range + excerpt.

## Phase A discovery artifacts (generated)

- Env keys used in code (keys only; no values):
	- [docs/_env_keys_used_in_code.txt](_env_keys_used_in_code.txt) (EXPO_PUBLIC_*; 78 keys)
	- [docs/_vite_keys_used_in_code.txt](_vite_keys_used_in_code.txt) (VITE_*; 6 keys)
- Local `.env*` key presence matrix (no values): [docs/_env_key_presence.csv](_env_key_presence.csv)
	- Summary (present / total):
		- `.env`: 13 / 78
		- `.env.local`: 2 / 78
		- `.env.development`: 4 / 78
		- `.env.production`: 0 / 78
		- `.env.staging`: 0 / 78
	- Excerpts (CSV lines; columns are `file,key,present,line` where `line` is the line number inside the env file):
		- `".env","EXPO_PUBLIC_API_BASE_URL","True","16"`
		- `".env.development","EXPO_PUBLIC_API_BASE_URL","True","2"`
		- `".env","EXPO_PUBLIC_LIVE_SERVICE_URL","True","19"`
		- `".env","EXPO_PUBLIC_GEMINI_API_KEY","True","2"`
- Entry-point hit inventories (broad grep lists to support deeper evidence links below):
	- [docs/_hits_auth.txt](_hits_auth.txt)
	- [docs/_hits_live.txt](_hits_live.txt)
	- [docs/_hits_comments.txt](_hits_comments.txt)
	- [docs/_hits_gifting.txt](_hits_gifting.txt)
	- [docs/_hits_ai.txt](_hits_ai.txt)

## Auth

### Firebase (client)

- **EXPO_PUBLIC_FIREBASE_API_KEY** (required to enable Firebase; otherwise app enters “Firebase disabled (stub mode)”).
	- Evidence: `firebaseConfig.apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || ""` in [src/config/firebase.js](../src/config/firebase.js#L31-L37)
	- Evidence: “missing/invalid → disabled (stub mode)” behavior in [src/config/firebase.js](../src/config/firebase.js#L63-L76)
- Other Firebase public keys (optional if defaults are acceptable in this repo’s defaults).
	- Evidence: key list in [.env.example](../.env.example#L1-L12)

### Cognito / Amplify (client)

- **EXPO_PUBLIC_ENABLE_AMPLIFY** gates whether Amplify is configured.
	- Evidence: flag read + enable check in [src/config/amplify.js](../src/config/amplify.js#L14-L21)
- If `aws-exports` is missing/incomplete, Cognito config can come from:
	- **EXPO_PUBLIC_AWS_COGNITO_REGION** / **EXPO_PUBLIC_AWS_REGION**
	- **EXPO_PUBLIC_AWS_USER_POOL_ID**
	- **EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID**
	- Evidence: env fallback construction in [src/config/amplify.js](../src/config/amplify.js#L32-L49)
	- Evidence: generated fallback defaults exist in [src/aws-exports.js](../src/aws-exports.js#L6-L30)

### Entry points (Auth bootstrap)

- App bootstrap imports Amplify config before mounting anything that needs Cognito JWTs.
	- Evidence: `import './src/config/amplify';` in [App.js](../App.js#L38-L46)
- Top-level app auth gating is in `AppInner()` via `useAuth()`.
	- Evidence: `const { user, uid, loading, error: authError } = useAuth();` in [App.js](../App.js#L335-L339)
- Cognito session corruption is treated as recoverable and triggers a local cleanup + relogin.
	- Evidence: `COGNITO_SESSION_CORRUPTED_RELOGIN` handling in [App.js](../App.js#L401-L425)
	- Evidence: corruption detection + error token in [src/hooks/useCommon.js](../src/hooks/useCommon.js#L180-L207)

### Local dev presence (value redacted; generated)

- Evidence: [docs/_env_key_presence.csv](_env_key_presence.csv) (no values; includes `.env*` line numbers).

## Live

### App-side live-service base URL

- **EXPO_PUBLIC_LIVE_SERVICE_URL** (preferred) OR `EXPO_PUBLIC_API_BASE_URL` containing `:4000` to imply IVS mode.
	- Evidence: resolution logic in [src/api/ivsLiveApi.ts](../src/api/ivsLiveApi.ts#L540-L606)
	- Evidence: economy client uses the same requirement in [src/api/economyLiveApi.ts](../src/api/economyLiveApi.ts#L6-L24)

### IVS environment (client)

- **EXPO_PUBLIC_IVS_REGION** (defaults to `us-east-1` if absent).
- Optional per-app defaults:
	- **EXPO_PUBLIC_IVS_DEFAULT_STAGE_ARN**
	- **EXPO_PUBLIC_IVS_DEFAULT_CHANNEL_ARN**
	- **EXPO_PUBLIC_IVS_PLAYBACK_BASE_URL**
	- Evidence: typed env reader in [src/config/IVSEnv.ts](../src/config/IVSEnv.ts#L11-L22)

### Streaming feature selection (client)

- **EXPO_PUBLIC_STREAMING_BACKEND** and **EXPO_PUBLIC_API_BASE_URL** are logged/consumed by the IVS dev client.
	- Evidence: runtime config log in [src/streaming/IVSNativeClient.ts](../src/streaming/IVSNativeClient.ts#L80-L109)
	- Evidence: Expo config defaults `EXPO_PUBLIC_STREAMING_BACKEND` in [app.config.js](../app.config.js#L14-L24)

### Live-service required env (backend/blyp-live-service)

- **IVS_REALTIME_REGION** must be non-empty to create the AWS IVS Real-Time client.
	- Evidence: [backend/blyp-live-service/src/aws/ivsRealtimeClient.ts](../backend/blyp-live-service/src/aws/ivsRealtimeClient.ts#L1-L11)
- **COGNITO_REGION** and **COGNITO_USER_POOL_ID** are required to verify inbound JWTs.
	- Evidence: [backend/blyp-live-service/src/auth/verifyCognitoJwt.ts](../backend/blyp-live-service/src/auth/verifyCognitoJwt.ts#L5-L16)

### Entry points (Live join + host)

- Live UX entry is `LiveStreamScreen` (camera, IVS hooks, comments, gifting).
	- Evidence: screen imports IVS hooks + comments + gifting in [src/screens/LiveStreamScreen.js](../src/screens/LiveStreamScreen.js#L1-L60)

## Comments

### Transport and endpoints

- Live comments and likes are posted via Functions endpoints:
	- `POST /addLiveStreamComment`
	- `POST /addLiveStreamLike`
	- Evidence: client calls `${resolvedBase}/addLiveStreamComment` in [src/services/HLSLiveStreamService.js](../src/services/HLSLiveStreamService.js#L974-L1039)
	- Evidence: Functions handlers exist in [functions/src/liveStreamApi.ts](../functions/src/liveStreamApi.ts#L166-L215) and [functions/src/liveStreamApi.ts](../functions/src/liveStreamApi.ts#L310-L360)

### Required base URL config (client)

- To post comments/likes, client must be able to resolve a Functions base URL:
	- Either `EXPO_PUBLIC_API_BASE_URL` points at Functions (contains `:5001` or `/us-central1`)
	- Or set **EXPO_PUBLIC_FUNCTIONS_BASE_URL** / **EXPO_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL** explicitly
	- Evidence: resolver + error message in [src/services/HLSLiveStreamService.js](../src/services/HLSLiveStreamService.js#L960-L1005)

### Local dev risk (IVS mode)

- `.env.development` currently appears to set `EXPO_PUBLIC_API_BASE_URL` to a live-service base (`:4000`), which will NOT satisfy the comments resolver unless a Functions base URL is also provided.
	- Evidence (command output, no values): `.env.development` → `EXPO_PUBLIC_API_BASE_URL present; looksFunctions=False; looksLiveService=True`
	- Evidence: comments resolver requires Functions-like base in [src/services/HLSLiveStreamService.js](../src/services/HLSLiveStreamService.js#L987-L1005)

### Entry points (Comments transport)

- Client-side transport for posting comments/likes is `HLSLiveStreamService.addComment/addLike`.
	- Evidence: `addComment` in [src/services/HLSLiveStreamService.js](../src/services/HLSLiveStreamService.js#L948-L1031)
	- Evidence: `addLike` in [src/services/HLSLiveStreamService.js](../src/services/HLSLiveStreamService.js#L1077-L1143)
- Real-time comment list updates are subscribed directly from Firestore subcollections.
	- Evidence: `subscribeToComments` in [src/services/HLSLiveStreamService.js](../src/services/HLSLiveStreamService.js#L1032-L1067)

## Gifting

### Client → live-service

- Economy calls require a live-service base URL:
	- Evidence: production throw if missing in [src/api/economyLiveApi.ts](../src/api/economyLiveApi.ts#L6-L24)
- Economy endpoints used by client include `/wallet`, `/economy/catalog`, and `/gift/send`.
	- Evidence: API calls in [src/api/economyLiveApi.ts](../src/api/economyLiveApi.ts#L196-L208)

### Entry points (Gifting)

- Live gifting UI is wired into the live screen.
	- Evidence: `import GiftSystem from '../components/GiftSystem';` in [src/screens/LiveStreamScreen.js](../src/screens/LiveStreamScreen.js#L33-L40)

### Backend env (economy)

- Economy subsystem requires **POSTGRES_URL** and **REDIS_URL** plus several numeric controls.
	- Evidence: zod schema (required keys) in [backend/blyp-live-service/src/config/economyEnv.ts](../backend/blyp-live-service/src/config/economyEnv.ts#L3-L31)
	- Evidence: DB/Redis initialization uses these env vars in [backend/blyp-live-service/src/economy/infra.ts](../backend/blyp-live-service/src/economy/infra.ts#L12-L33)

## AI

### Gemini (client)

- **EXPO_PUBLIC_GEMINI_API_KEY**: preferred source is Expo `extra`, falling back to `process.env`.
	- Evidence: extra/env resolution in [src/config/firebase.js](../src/config/firebase.js#L316-L335)
- **EXPO_PUBLIC_GEMINI_API_URL** is optional; if absent, code constructs a URL using the key.
	- Evidence: URL fallback builder in [src/config/firebase.js](../src/config/firebase.js#L338-L341)
- `.env.example` documents both keys.
	- Evidence: [.env.example](../.env.example#L14-L18)
- Repo static config sets Gemini key to empty string (ensures no committed secret).
	- Evidence: `EXPO_PUBLIC_GEMINI_API_KEY: ""` in [app.json](../app.json#L74-L82)

### AI pipeline entry point

- AI generation is routed through the `AIService` wrapper which reads `geminiApiKey/geminiApiUrl` from `src/config/firebase`.
	- Evidence: import + availability check in [src/services/aiService.js](../src/services/aiService.js#L1-L33)

- Post creation/review pipeline entry is `ReviewScreen`, which imports `aiService` and exposes a clear “missing key” message.
	- Evidence: `import aiService from '../services/aiService';` in [src/screens/ReviewScreen.js](../src/screens/ReviewScreen.js#L22-L27)
	- Evidence: missing key message token in [src/screens/ReviewScreen.js](../src/screens/ReviewScreen.js#L49-L79)

## Build/Release

- Production builds require `EXPO_PUBLIC_LIVE_SERVICE_URL` (or `EXPO_PUBLIC_API_BASE_URL` containing `:4000` must be avoided as the only config if comments still need Functions).
	- Evidence: production requirement in [src/api/economyLiveApi.ts](../src/api/economyLiveApi.ts#L6-L24)
	- Evidence: IVS production requirement in [src/api/ivsLiveApi.ts](../src/api/ivsLiveApi.ts#L603-L606)
- Gemini key must not be committed and is expected via env/EAS secrets; missing key should degrade safely.
	- Evidence: security note + warning in [app.config.js](../app.config.js#L8-L17)
