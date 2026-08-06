# Promote Infinite Studio (2026-08-06)

## What shipped

Catalog-driven **Promote Studio** replaces the 3-button Promote tab.

### Methods (11 in catalog)

| methodId | Type | Wiring |
|----------|------|--------|
| `spotlight` | SPOTLIGHT | Existing exclusive calendar |
| `time_slot` | TIME_SLOT | Existing exclusive slots |
| `battle` | BATTLE | Existing battle boost |
| `feed_boost` | FEED_BOOST | **New** — charter Boost: Postgres promo + Firestore `reach.boosted` + feed weight 65 (post-scoped) |
| `profile` | PROFILE | **New** — profile amplify weight 55 |
| `live` | LIVE | **New** — live amplify weight 60 |
| `search` | SEARCH_SPONSORED | **New** — labelled search slot; client injects from `/promote/active` |
| `followers` | FOLLOWERS_NOTIFY | **New** — follower amplify weight 35 |
| `team` | TEAM_SHOUTOUT | **New** — team shoutout weight 45 |
| `cross_sport` | CROSS_SPORT | **New** — cross-sport push weight 40 |
| `rematch` | REMATCH | **New** — rematch promo weight 50 |

### UX

- Profile → **Promote** → Promote Studio (Methods / Active / History)
- Method cards, category filters, compose flow (package, targeting, reach preview, note)
- Battle HQ / Battle detail → opens studio on Battle Boost
- Post reach sheet → **Boost this post** → Feed Boost compose

### APIs

- `GET /promote/pricing` — now includes `catalog`, `packages`, `limits`
- `POST /promote/method/book` — catalog booking (routes legacy methods)
- `GET /promote/mine` — active + history for creator
- Existing battle/slot/spotlight endpoints unchanged

### Fair caps / anti-spam

- Max active promotions per user (default 5)
- One active campaign per type per user
- Search sponsored global concurrent cap (default 8)
- Feed fair-cap unchanged (~1/3 promote share, max 2/author/window)
- Weights still below admin `boost` (150); cap 95

## How to open

1. App → **Profile** tab → **Promote**
2. Or Battle HQ → **Promote**
3. Or own post → Reach → **Boost this post**

## Roadmap

- Server-side search orchestrator sponsored fill (today: client inject)
- Real push fanout for Notify Followers
- CPM/cash brand campaigns / advertiser portal
- Admin ROI / promote spend console beyond read-only queue
- Per-query contextual matching beyond sport/interest keywords
