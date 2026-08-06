# Guided product tour overhaul (2026-08-06)

## Why the old tour felt weak

- Walls of long copy (~14–16 steps) — modal slideshow, not cinematic beats
- Spotlight zone `foryou.actions` still assumed a **right-side vertical rail**; For You actions are now a **horizontal** `FeedActionBar`
- Missed critical surfaces: Home customize, Stage Desk, Gifts, Promote Studio
- Weak motion (simple fade only); callouts often missed live targets after layout churn
- Dating / Games / Rankings / Rooms diluted the first-run path

## What shipped (TOUR_VERSION = 3)

Eight short beats with one CTA each:

1. **For You** — feed + header tab spotlight  
2. **React in place** — horizontal engagement bar  
3. **Gifts that land** — gift control + overlay wow burst (does **not** touch `giftMotion`)  
4. **Make Home yours** — Home hub + customize (grid) control  
5. **Live + Stage Desk** — Chat → Live tab + in-card Stage Desk peek  
6. **Promote** — Profile → Promote Studio  
7. **Messages** — Messages tab  
8. **Your profile** — finish / replay hint  

## Flexible anchors

- Live `TourTarget` ids preferred; each step also lists `targetIds` fallbacks + a zone heuristic
- Zones updated for horizontal actions, gift slot, home customize, Live/Promote headers
- Targets remasure on staggered ticks (layout-safe)

## Replay

- **Settings → Replay tour** (`StubScreens` Settings)
- **Profile → Menu → Replay tour**
- Welcome inbox notification (`type: tour`) still starts via `requestStartTour`
- Auto-start once after onboarding when `tourCompleted` is false (auth/onboarding signup unchanged)

## Files touched

- `src/tour/tourSteps.js`, `tourTargets.js`, `TourTarget.js`, `GuidedTourOverlay.js`, `GuidedTourProvider.js`, `welcomeTourInbox.js`
- Anchors: `FeedActionBar`, `GiftSystem`, `HomeBasePanel`, `PromoteTab`, `TabBarIcon` (+ App.js messenger/profile ids)
- Profile tour select wiring; Settings subtitle copy

## Coordination

- Did **not** modify `src/components/live/giftMotion/**` (parallel gift-animation packaging agent)
- Did **not** change `OnboardingScreen` / signup auth gates
