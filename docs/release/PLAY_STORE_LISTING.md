# Play Store listing — com.blyp.mobile

Source of truth for store copy. Brand name is **Blyp** only.

## Titles

| Locale | Title |
|--------|--------|
| en-GB | **Blyp** |
| en-US | **Blyp** |

Launcher / `app.config.js` `name` / `android:label`: **Blyp**.

Do **not** use "Blyp Live", "Blip", or any track suffix in the title.  
Play Console may show **(Internal Beta)** next to the name for accounts on the internal test track — that is Google UI, not part of our listing title. We do not put "Internal Beta" in the title string.

## Short description (≤80)

```
Blyp — short videos, go live & social with your community.
```

## Full description

```
Blyp by Blyp Labs is a social app for short videos and live streaming — not a trip planner or travel map.

Create posts, watch creators, and go live with your community in real time.

Key features:
- Create and share short videos and posts
- Watch and discover content from creators you follow
- Go live and interact with your audience in real time
- Send Blypcoin gifts to support the creators you love
- Build your profile and grow your following

Create. Watch. Go live. — Blyp by Blyp Labs
```

## Update

```powershell
cd C:\Users\Alex\Blyp26-eas-modern
node diagnostics/update_play_listing.mjs
```

Requires `android-service-account.json`. After API commit, if Managed publishing is on, publish the change in Play Console when review clears.
