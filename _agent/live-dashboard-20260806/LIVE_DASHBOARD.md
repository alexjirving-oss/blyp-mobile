# Stage Desk (Live Dashboard)

**Product name:** Stage Desk  
**Ship date:** 2026-08-06  
**Scope:** In-app host control surface for Blyp Live (Tickfinity-class power, no Electron companion)

## Why Stage Desk

Hosts want infinitely customizable live chrome — gift alerts, goals, top gifters, layout, guests, battles, sound cues — without leaving the phone. Stage Desk is Blyp’s answer: a Fold-friendly sheet + pin-able chrome rail, persisted on the host account.

## How hosts open it

| Surface | Entry |
|---------|--------|
| **Pre-live** | Teal **Stage Desk** row above Go Live |
| **Live (host)** | Bottom control **Desk** (replaces the old Layout shortcut; layout lives inside Stage Desk) |

Host-only. Viewers never see Stage Desk.

## Persistence

`users/{uid}.blyp.prefs.liveDashboard` via `userPreferencesService` (AsyncStorage + Firestore mirror).

Shape (normalized by `liveDashboardService`):

```json
{
  "version": 1,
  "themeId": "pulse",
  "widgets": [
    { "id": "sd_goalBar_…", "type": "goalBar", "enabled": true, "config": { "target": 500, "label": "Gift goal" } }
  ]
}
```

## Widget catalog

### Core (free) — up to **6** active slots

| Type | Surface | Role |
|------|---------|------|
| `giftAlerts` | chrome | Alert theme for gift cinema / toasts |
| `comboTicker` | chrome | Combo streak rail |
| `goalBar` | chrome | Gift/coin progress bar |
| `topGifters` | chrome | Top supporters this stream |
| `chatHighlight` | chrome | Jump to chat to pin highlights |
| `quickReplies` | panel | One-tap host chat lines |
| `guestInvites` | panel | Invite followers to stage |
| `battleControls` | panel | Guest challenge / battle entry |
| `layoutPicker` | panel | Bottom · Focus · Equal · Split |
| `mediaControls` | panel | Mic / flip / camera |
| `sharePromote` | panel | Share live |
| `sessionStats` | chrome | Viewers · hearts · gifts |

### Plus / Pro — up to **12** active slots

| Type | Surface | Role |
|------|---------|------|
| `marbleRace` | panel | Guest Grand Prix when marble flag on |
| `teamShoutouts` | panel | Scripted fan thank-yous |
| `subscriberBadges` | chrome | Plus/sub badge chrome (when data exists) |
| `soundAlerts` | panel | Device-side gift sound arm/mute |
| `alertTheme` | panel | Desk-wide accent theme |

**Themes:** Pulse · Neon · Ember · Gold

## Plus gating

```
isPro = useHasAI()  // Blyp Plus or active trial
       || EXPO_PUBLIC_LIVE_DASHBOARD_PRO=1
```

- Free: core catalog, **6** enabled widgets.
- Plus / flag: full catalog, **12** slots, upsell row hidden.
- Locked Pro modules show a Plus badge and deep-link to **Plans**.

## Edit mode

Same pattern as Home widgets:

1. Open Stage Desk → **Edit**
2. Reorder ↑↓, hide (eye), remove
3. **Add** opens catalog; **Reset Stage Desk** restores defaults

Pinned `surface: 'chrome'` modules render as a slim host rail under the LIVE header (`StageDeskChrome`) — does not replace Gift Cinema V2.

## Key files

| Path | Role |
|------|------|
| `src/services/liveDashboardService.js` | Catalog, normalize, persist API |
| `src/config/LiveDashboardFlags.js` | `liveDashboard.pro` flag |
| `src/components/live/dashboard/LiveDashboardSheet.js` | Host sheet UI |
| `src/components/live/dashboard/StageDeskChrome.js` | On-stream chrome rail |
| `src/components/live/dashboard/StageDeskModuleBodies.js` | Module bodies |
| `src/components/live/dashboard/StageDeskWidgetFrame.js` | Edit chrome |
| `src/screens/LiveStreamScreen.js` | Entry points + wiring |
| `src/services/userPreferencesService.js` | `liveDashboard` prefs field |

## Out of scope (P0)

- External Electron / OBS browser-source companion
- Server-authoritative sound packs
- Viewer-visible overlay redesign (host chrome only)
- Changes to Gift Cinema V2, Home layout engine, or feed audio

## Inspired by Tickfinity (mapped in-app)

| Tickfinity | Stage Desk |
|------------|------------|
| Overlay gallery | Widget catalog + pin order |
| Alert box / gift alerts | `giftAlerts` + theme |
| Goal overlays | `goalBar` |
| Top gifters | `topGifters` |
| Sound alerts | `soundAlerts` (Plus) |
| Chat tools | `quickReplies`, `chatHighlight` |
| Sub perks | `subscriberBadges` (Plus) |
