# AI post variants (create flow)

Staged create-post AI (Review screen):

1. **Upload media** → ambient vision **describe** (Plus/trial) via `geminiProxy` (OpenAI primary → Gemini backup).
2. User edits **What AI sees** and adds **Your guide** (text or mic).
3. **Generate 3 post options** → pick one → becomes caption / title / hashtags.

## Client

- `src/screens/ReviewScreen.js` — UI + orchestration (`autoDescribeMedia`, `generateOptimizedPosts`, `applyVariant`)
- `src/services/mediaDescriptionService.js`
  - `generateMediaDescriptions` — literal vision
  - `generateOptimizedPostVariants` / `generatePostDescriptionVariants` — 3 captions
  - `generatePostFromMedia` — multimodal shortcut (still used as legacy magic path)

## APIs

No new Cloud Function. Existing:

`POST {geminiProxyBaseUrl}/geminiProxy?model=…`  
Auth: Firebase ID token. Plus/trial gated (402).

## AAB

**Yes** — UI lives in the app. Backend unchanged; no CF deploy required for this feature.
