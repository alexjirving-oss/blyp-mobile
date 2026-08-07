# Play Store listing — com.blyp.mobile

Mirrored store listing text (source of truth after API commit).  
Updated: 2026-08-06 via Play Developer API (`diagnostics/update_play_listing.mjs`).

## Titles

| Locale | Before | After |
|--------|--------|-------|
| en-GB | Blyp | **Blyp Live** |
| en-US | *(none — created)* | **Blyp Live** |

Launcher / `app.config.js` `name`: **Blyp** (unchanged — store title is what search uses).

## Short description (≤80)

```
Blyp Live — short videos, go live & social with your community.
```

## Full description

```
Blyp Live by Blyp Labs is a social app for short videos and live streaming — not a trip planner or travel map.

Create posts, watch creators, and go live with your community in real time.

Key features:
- Create and share short videos and posts
- Watch and discover content from creators you follow
- Go live and interact with your audience in real time
- Send Blypcoin gifts to support the creators you love
- Build your profile and grow your following

Create. Watch. Go live. — Blyp Live by Blyp Labs
```

## API

- Edit committed successfully (HTTP 200) for en-GB + en-US.
- If Managed publishing is on, confirm **Publish** in Play Console for the listing change to go live publicly.
- Artifact: `diagnostics/play_listing_update.json`
