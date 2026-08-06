# Home Customization — Layout Engine (2026-08-06)

## Goal

Make Blyp Home infinitely customizable with a coherent **widget system** (not a junk drawer): ordered modules, persist per user, edit mode that feels like iOS Home / Twitter Lists / TikTok — Blyp-branded.

## Architecture

```
Home tab (key: home)
  └─ HomeBasePanel
       ├─ Pinned chrome (always on)
       │    Greeting · Edit Home · Activity · Saved
       │    Blyp AI bar
       │    Watches / Reminders (when present)
       └─ Home Layout Engine
            ordered widgets from blyp.prefs.homeLayout
```

**Persistence:** `users/{uid}.blyp.prefs.homeLayout` (+ AsyncStorage `@blyp/prefs/{uid}`) via existing `userPreferencesService` — no new REST API required.

**For You sticky actions / gifts / SportPage teams:** untouched. Layout only drives the **Home** hub (`HomeBasePanel`), not tab `A` (For You feed).

## Widget catalog (16 types)

| Type | Title | Notes |
|------|--------|--------|
| `suggestions` | Smart suggestions | Ask Blyp chips |
| `recentSearches` | Recent searches | From prefs |
| `forYou` | For you | Preview rail → opens feed `A` |
| `continueWatching` | Continue watching | Watch history |
| `liveNow` | Live now | Live streams |
| `trending` | Trending now | Discovery |
| `creators` | Creators to follow | Suggested creators |
| `sportPages` | Your pages | Pin `topic:football`, `topic:f1`, etc. |
| `quickDm` | Quick messages | Recent chats + favorite people |
| `clubs` | Clubs | Profile clubs rail |
| `clubPeople` | People in your clubs | Shared-club people |
| `quickActions` | Jump in | Live / Dating / Games / … |
| `interests` | Your interests | Interest chips |
| `pageList` | All pages | Full page list |
| `battles` | Battles | Deep-link Chat → battles |
| `rankings` | Rankings | Rankings screen |

Configurable widgets:

- **sportPages** — `config.pageKeys: string[]` (e.g. `["topic:football","topic:f1"]`)
- **quickDm** — `config.peopleIds: string[]` (favorites; falls back to recent threads)

## Layout shape

```json
{
  "version": 1,
  "widgets": [
    { "id": "w_forYou_…", "type": "forYou", "enabled": true, "config": {} },
    { "id": "w_sportPages_…", "type": "sportPages", "enabled": true, "config": { "pageKeys": ["topic:football"] } },
    { "id": "w_quickDm_…", "type": "quickDm", "enabled": true, "config": { "peopleIds": [] } }
  ]
}
```

- Missing / empty layout → `buildDefaultHomeLayout(interests)` (migration).
- Unknown types dropped; required types (`forYou`, `liveNow`, `sportPages`, `quickDm`) healed in if absent.
- P0: one instance per type (keeps Home coherent).

## How to edit Home

1. Open bottom tab **Home** → header chip **Home** (not For You).
2. Tap the **grid** icon (top-right of greeting) **or** the **Edit Home** CTA at the bottom **or** long-press that CTA.
3. In edit mode:
   - **↑ / ↓** reorder
   - **eye** hide/show
   - **×** remove
   - **Add** opens catalog sheet
   - On **Your pages**: tap cards to unpin; dashed cards to pin Football / F1 / interests
   - On **Messages**: tap people to pin/unpin favorites
4. Tap **Done**.

Pages editor (`PagesEditor` / “Customize Home”) still manages **header tabs** (For You, Following, topic pages). The Layout Engine manages **modules inside the Home hub**.

## Files shipped

| Path | Role |
|------|------|
| `src/services/homeLayoutService.js` | Catalog, defaults, normalize, CRUD |
| `src/services/userPreferencesService.js` | `homeLayout` in prefs + `setHomeLayout` |
| `src/components/HomeBase/HomeBasePanel.js` | Layout render + edit mode |
| `src/components/HomeBase/HomeWidgetFrame.js` | Edit chrome |
| `src/components/HomeBase/SportPagesWidget.js` | Sport / interest page pins |
| `src/components/HomeBase/QuickDmWidget.js` | Quick messaging row |
| `src/components/HomeBase/EditHomeSheet.js` | Add / reset sheet |

## Defaults (new users)

Suggestions → Recent searches → For you → Continue watching → Live now → **Your pages** → **Messages** → Trending → Creators → Clubs → Club people → Battles → Rankings → Jump in → Interests → All pages.

Sport page pins seed from onboarding interests (`football` / `f1` preferred).

## Out of scope / next

- Drag-and-drop (P0 uses ↑↓)
- Multiple instances of same widget type
- Dedicated battles live rail (deep-link card for P0)
- Server-side layout templates / A-B
