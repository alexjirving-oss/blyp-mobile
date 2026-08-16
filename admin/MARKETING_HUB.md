# Marketing Hub (admin)

Production-shaped v1 for **https://admin.blyp.world** → **Marketing**.

Connect social accounts, pull content from Blyp (recent public posts + promo templates), and enqueue/publish on a schedule. Mel `economy.credit` RBAC is untouched; this surface uses a separate permission: **`marketing.manage`** (Owner, Executive, Administrator/Mel).

## What is live vs scaffolded

| Network | Connect (OAuth) | Publish | Notes |
|---------|-----------------|---------|-------|
| **Facebook** | Live when Meta env set | Live — Page feed (`message` + optional `link`) | Needs a Facebook Page the user can manage |
| **Instagram** | Live when Meta env set | Live — Content Publishing API | Needs IG **Business/Creator** linked to a Page; **public https media URL required** (caption-only fails honestly) |
| **TikTok** | Scaffold / Coming soon | Not implemented | Needs Content Posting API approval + client credentials |
| **Snapchat** | Scaffold / Coming soon | Not implemented | Needs Marketing API / Public Profile access |

The UI never marks an item **published** unless the network API returns an id. Stub networks fail with `*_NOT_IMPLEMENTED`.

## Admin UI

Nav: **Business → Marketing** (`/marketing`)

1. **Connected accounts** — per-network cards; Connect / Re-connect / Disconnect  
2. **Content sources** — recent live Blyp posts (`GET /admin/posts` pool) + promo templates; queue to selected networks  
3. **Schedule** — enable/pause, IANA timezone, days, local times, source mode, caption template (`{caption}`, `{link}`, `{author}`), target networks  
4. **Queue / history** — scheduled / published / failed with error detail; Publish now / Cancel  

## Auth model

Same as the rest of tip admin:

1. Cognito login → Bearer ID token  
2. Outer gate: `ADMIN_ALLOWLIST_SUBS` on Cloud Run  
3. RBAC: `marketing.manage`

OAuth **callback** is browser-facing (no Bearer):  
`GET /admin/marketing/oauth/meta/callback`  
State is HMAC-signed (actor + network + expiry). Tokens are encrypted at rest and **never** returned to the admin UI or logged.

## Backend env vars (Cloud Run live-service)

| Variable | Required for | Purpose |
|----------|--------------|---------|
| `MARKETING_TOKEN_ENCRYPTION_KEY` | Meta connect | 32-byte key as 64-char hex **or** base64; used for AES-256-GCM token ciphertext |
| `META_APP_ID` | Meta | Facebook Developer App ID |
| `META_APP_SECRET` | Meta | App secret (Secret Manager) |
| `META_REDIRECT_URI` | Meta (recommended) | Must match Meta app Valid OAuth Redirect URIs. Default: `{LIVE_SERVICE_PUBLIC_URL}/admin/marketing/oauth/meta/callback` |
| `ADMIN_PUBLIC_URL` | Meta callback | Defaults to `https://admin.blyp.world` — post-OAuth redirect target |
| `MARKETING_OAUTH_STATE_SECRET` | Optional | HMAC secret for OAuth `state`; falls back to encryption key / Meta secret |
| `INTERNAL_SHARED_SECRET` | Scheduler | Existing internal cron auth |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | Future | Documented only — not wired in v1 |
| `SNAP_CLIENT_ID` / `SNAP_CLIENT_SECRET` | Future | Documented only — not wired in v1 |

Generate a key:

```bash
openssl rand -hex 32
```

## Meta developer setup

1. Create an app at [developers.facebook.com](https://developers.facebook.com/) (type: Business).  
2. Add **Facebook Login** + **Instagram** products as needed.  
3. Permissions (request App Review for production):  
   - Facebook: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`  
   - Instagram: above + `instagram_basic`, `instagram_content_publish`, `business_management`  
4. Valid OAuth Redirect URI = exact `META_REDIRECT_URI` (live-service callback URL).  
5. Instagram: convert the IG account to **Professional** (Business or Creator) and link it to a Facebook Page. Personal IG accounts cannot use Content Publishing.  
6. Media for IG must be a publicly reachable **https** image or video URL (Firestore/CDN). Private or localhost URLs will fail.

## TikTok (future)

1. Apply at [developers.tiktok.com](https://developers.tiktok.com/) for **Content Posting API**.  
2. Approval is gated; until then keep status **Coming soon**.  
3. Planned env: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, redirect to a similar `/admin/marketing/oauth/tiktok/callback`.  
4. Do not fake publish in the UI.

## Snapchat (future)

1. Snap Kit / Marketing API access via [kit.snapchat.com](https://kit.snapchat.com/) / Ads Manager business.  
2. Planned env: `SNAP_CLIENT_ID`, `SNAP_CLIENT_SECRET`.  
3. Public Profile / Stories posting policies are restrictive — expect review.

## Scheduler

Recommended Cloud Scheduler job (every 5 minutes):

```text
POST https://blyp-live-service-innn3d7yqq-uc.a.run.app/internal/cron/marketing-publish
Header: x-internal-secret: $INTERNAL_SHARED_SECRET
Body: {}
```

Example:

```bash
gcloud scheduler jobs create http marketing-publish \
  --project=blyp-master --location=us-central1 \
  --schedule="every 5 minutes" --time-zone=UTC \
  --uri="https://blyp-live-service-innn3d7yqq-uc.a.run.app/internal/cron/marketing-publish" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-internal-secret=SECRET" \
  --message-body="{}" \
  --attempt-deadline=180s
```

Behavior:

1. If schedule **enabled** and local time matches a configured slot (±4 min) on an allowed weekday → enqueue one content pick per selected network (once per slot key).  
2. Process due `scheduled` queue rows → real Meta publish or honest failure.

Manual “Publish now” in the admin UI hits the same publish path.

## Postgres tables (ensured on boot)

- `marketing_social_accounts`  
- `marketing_schedules`  
- `marketing_queue_items`  

## Deploy notes

- **Admin UI**: tip `admin/` → Netlify site `blyp-admin-console` / `https://admin.blyp.world` (preserve Mel RBAC; do not orphan tip admin).  
- **API**: deploy `blyp-live-service` with the env vars above before Connect works.  
- Without Meta env, Facebook/Instagram cards show **Needs auth** / configure env; Connect returns `NOT_CONFIGURED`.

## Honest limits (v1)

- One connected account row per network (reconnect replaces).  
- Facebook Page picker: uses first manageable Page (IG prefers a Page with linked IG). Multi-page picker can come later.  
- “Featured creators” uses the same recent public post pool as Content & Media.  
- TikTok/Snapchat queue items fail with `*_NOT_IMPLEMENTED` if somehow enqueued.  
- No secrets in git, audit logs, or API JSON responses.
