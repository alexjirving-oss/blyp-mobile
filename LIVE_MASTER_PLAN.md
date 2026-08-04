# Blyp Live — Master Plan

> Living document. Status markers: ✅ done · 🛠️ in progress · 📋 planned · ❓ open question to decide together.
> Last updated: 2026-06-14.

---

## 1. Vision

One **world-class, effortless** live experience — TikTok-Live-class, but where we deliberately go further (more guests, viewer gifting, battles). The room must feel **co-present**: low latency, instant reactions, and "you understand it the second you look at it."

### North star (decided)
- **Monetization is the #1 priority — because it's what keeps the platform alive.** When two goals genuinely conflict, the choice that sustains the business wins. This is survival, not greed.
- **Engagement, creator growth, and community are the heart** — the reason the platform exists and what we maximise everywhere money isn't on the line. They are first-class, not afterthoughts.
- Practical reading: design for delight and connection by default; make the monetization paths (gifting/coins) frictionless, prominent, and trustworthy so the platform can fund all of it.

### Principles (the bar every screen is judged against)
1. **Clarity at a glance** — who's live, who's talking, how to act.
2. **Content over chrome** — video fills the frame; UI recedes; teal only where it earns attention; red = LIVE.
3. **One consistent system** — host, viewer, and every state share the same layout DNA. Host = viewer + extra controls.
4. **Effortless hierarchy** — generous spacing, calm type, no clutter, no neon.
5. **Every state designed** — connecting, joining, full, ended — never a dead end.
6. **Premium moments without noise** — gifts/battles feel special without cluttering the default view.
7. **Real, never fake** — only ship controls that actually work; server-authoritative; publishable.

---

## 2. Design language (LOCKED)

Anchored to the approved host-solo mockup + the consistent set.

- **Identity:** near-black `#0A0A0C`, teal accent `#00D2BE` (quiet, on active controls + primary buttons), rose-red `#F43F5E` for LIVE / destructive. Glass surfaces `rgba(10,10,12,0.55)`.
- **Header:** compact, single row — avatar + `@name` + red LIVE pill + eye/heart counts + Follow/close. Same for host and viewer.
- **Controls:** one labeled circular bottom row. Viewer = Comment field + Like / Gift / Share. Host = Mic / Flip / Camera / Layout / End.
- **Tiles:** rounded, thin teal-edged, name + mic chip, single thin teal ring on the active speaker.
- **Gifts:** bottom-sheet tray, horizontal carousel, on-tile combo Send, coin balance + Get Coins / Gift History.
- **Type/spacing:** Pulse tokens (`ThemeProvider` / `palettes.ts`); pill radii; consistent 4px spacing scale.

Reference mockups (in `assets/`): `blyp_03_host_solo`, `blyp_05_viewer_solo`, `blyp_06_viewer_grid`, gift tray, `blyp_02_prelive`, `blyp_01_discovery`.

---

## 2b. Monetization surface (all in scope, phased)

The platform's survival lever. All of the following are in scope; sequencing TBD:
- **Virtual gifts (coins)** — the core; creators earn a share. ✅ live (catalog/send/economy).
- **Blyp Premium (app-wide sub, ~£4.99/mo)** — the likely #1 revenue line. Platform-retained (no creator split). Unlocks: **subscriber-only games** (a proper games section, "better than TikTok"; a few free as the hook), a **dating section**, **live perks** (badges, entry effects, exclusive gifts, ad-free), **included monthly coin/gift credit** (drives gifting + recirculation), **creator tools / boosted reach**, and **exclusive content / early access**. Rich bundle → model higher conversion (base ~7%, optimistic ~14% of MAU). 📋
- **Creator subscriptions** — monthly support of a specific creator, with perks/badges (separate from Premium). 📋
- **Ticketed / paid-entry rooms** — pay to watch a stream. 📋
- **Battle stakes / wagers** — coins on the line in PK battles. 📋
- **Ads / sponsored placements** — 📋
- **Direct tips** — one-tap, no animation. 📋
- **Live shopping** — sell products during a stream. 📋

**Priority order (decided):** gifts/coins (live) → then **subscriptions**, **battle stakes**, and **ads/sponsorships** as the next trio → then shopping / ticketed / tips.

**Gifting strategy (decided): lean HARD into super-spender / "whale" mechanics** — gifter spend is the dominant revenue dial, so build the systems that grow it:
- Top-gifter **leaderboards** (per stream + global/weekly) and **crowns/badges**.
- **VIP tiers / levels** that reward cumulative spend with status + perks.
- **Battle frenzies** (gifting drives the score → competitive spending spikes).
- **Limited-edition / seasonal gifts** (scarcity, FOMO).
- Recognition that makes big gifts *visible and celebrated* in-room.
- Guardrail: keep it premium, not predatory — spend visibility + safeguards (see safety).

**Economics reality (important):**
- App stores (Apple/Google) take **~30% once — only on real money entering** (a coin purchase). In-app movement after that is untaxed by them.
- **The coin economy recirculates.** A gift becomes gems; the recipient can reconvert + re-gift, and the platform takes a **cut on every hop** (e.g. ~50%). Only **withdrawn** gems are a real payout — un-withdrawn/recirculated balances are platform margin/float.
- So the platform's **effective take on gift money-in is NOT a flat 20%** — it ranges from ~20% (everyone cashes out immediately) up toward ~70% (low cash-out, high recirculation). The dials are **per-hop cut** and **cash-out rate**.
- **Blyp Premium (app-wide sub: exclusive games + dating)** is platform-retained (no creator split) and converts far higher than a creator tip-sub — likely the **largest single revenue line**.
- **Subscriptions are the cheaper store rail:** Google takes **~15% on subscriptions** vs **~30% on one-off coin packs** (Apple: 30% yr 1 → 15% after; both ~15% under small-business programs below ~$1M/yr).
- **Subscription strategy (decided): Premium-only for now.** Blyp Premium (with included coins) is the sole subscription product; **no separate coin/VIP sub ladder yet** (deferred — store-policy + impulse-spend + ops downsides). **One-off coin packs remain** for impulse/event gifting (accept 30% there — it captures peak "event whale" spend a monthly plan can't). Revisit coin-subs once Premium is proven.
- Implication: revenue is driven by **scale × premium-sub conversion × gift recirculation/whales**, plus ads, **with as much spend as possible on the 15% subscription rail**. Per-gift cut alone understates it.

Open (business decisions to revisit, not blocking design): **creator revenue share %** (model now defaults to 50%; decide final), **app-store fee mitigation** (web/direct top-ups to avoid the 30%?), coin pricing, payout/cash-out, regional pricing, tax/compliance. ❓

## 2c. Games (product pillar)

Both a **standalone arcade** and **live-integrated** games — same game types in both. Signature mechanic that fuses games + live + gifting:

- **Shared "lives + revive" framework** wrapping many 2–4 player competitive game skins (start with 1v1). One framework, many skins, one leaderboard + economy.
- Each player starts with **3 extra lives**. Lose a life → **a supporter sends a "revive" gift → +1 life**, keeping their player in. Gifting is *consequential* (buys survival, not just cosmetics).
- **Leaderboards** for winners + **top supporters** (ties into whale mechanics).
- Live: two creators play, each side's viewers revive them. **Standalone arcade (decided): self-revive with your own coins, AND matches are spectatable so friends/followers can gift revives** — same mechanic everywhere, and spectatable arcade doubles as a funnel into live.
- **Coins are the in-game currency** (entry, revives, power-ups) → feeds the gifting economy + recirculation; Premium unlocks the full library + perks (2–3 games free as the hook).

**Balance (decided): gifting-hard, with light skill guardrails.** Reference: TikTok PK battles are *pure* pay-to-win (gifts are the entire contest — no skill layer). Ours is better because there's a **real game underneath**: revives make gifting consequential, but between **evenly-supported players, skill breaks the tie** — a great, modestly-backed player can still beat a rich-but-worse one. Keeps TikTok's revenue engine, adds genuine gameplay so non-payers still have a shot and players have a reason to get good. **Guardrails (decided, tunable per game):** per-match revive **cap** + **diminishing returns** (each revive costs more / gives less) + revive **cooldown** (no instant spam) + **skill tie-break** between evenly-supported players + **sudden-death finish** (revives off, pure skill decides). Tune the mix per game skin.

## 2d. Dating (product pillar) — live/video-native

Core model (decided): **live/video-native dating** (video profiles + live speed-dating + host-run dating game-shows), Premium-gated, reusing the live + guests + gifting + games stack. **Safety is non-negotiable:** 18+/age verification, photo verification, reporting/blocking, location privacy, strict moderation.

**Gifting / monetization ideas (brainstorm — to prioritise):**
- *Getting noticed:* gift-attached intro (jump the queue), gift on a profile (visible; competitive suitor gifting), profile boost/spotlight, pay to see who liked you.
- *Opening chat:* paid first message ("message + rose"), gifted compliments, gift to unlock chat.
- *Live dating:* **pay-per-minute live date** (datee earns), **gift-to-extend** the date (revive/extend mechanic), paid speed-dating entry, **gift mid-date** (escalating intent tiers), pay to take a date private.
- *Dating game-shows:* viewers **gift to vote**, **gift to keep a contestant in** (lives/revive mechanic), **auction-a-date** (top gifter wins a private date), gift to skip the queue.
- *Status/commitment:* intent gift tiers (rose → ring), "most-gifted" desirability leaderboards, lock-in/go-exclusive, anniversary gifts, paid rewind/re-match.
- *Ambitious:* virtual gift → **real-world redemption** (flowers/dinner) via partners.

**Priority mechanics (decided):** gift-attached intro · gift-on-profile · **pay-per-minute live date** · **gift-to-extend the date** · dating game-show **gift-to-vote / keep a contestant** · **auction-a-date**. (Intent tiers/leaderboards fold into the broader whale mechanics.)

**Sequencing (decided):** ship **public / entertainment-framed dating gifting first** (gift-attached intros, gift-on-profile, public dating game-shows, **auction-a-date as a public show segment**) — public + moderated + "TV-show" framed = defensible. **Defer private paid-1:1** (pay-per-minute, private rooms) to a **lawyered phase 2** with hard age/ID verification, live moderation, strict anti-solicitation enforcement, spend/time caps — or keep paid dates public/visible to sidestep most of the risk.

**Compliance to engage before any paid-dating launch (not legal advice — get a specialist):** Apple/Google policies (digital→IAP billing; no sexual content / no facilitating solicitation; UGC moderation/reporting), **UK Online Safety Act 2023** (risk assessments, age assurance, child-safety/illegal-content duties, Ofcom), **CSAE/minor protection** (strong age verification + detection/reporting — highest stakes), GDPR special-category data, AML/KYC + tax on real-money payouts to datees.

## 3. Architecture

- **Transport:** AWS IVS Real-Time (Stages) for interactive participants; **12-publisher hard cap per stage**. Mass audience → low-latency HLS via server-side composition (future, for scale/cost).
- **Backend:** `blyp-live-service` on Cloud Run (sessions, guests, tokens, battles, economy). Firebase functions for comments/likes. DynamoDB (sessions/guests), Postgres (economy), Firestore (discovery/mirror/counts).
- **Signaling:** Socket.IO room-event bus (`roomEvents` / `roomEventsSocket`) for gifts + room events.
- **Client:** single `LiveStreamScreen` branching host/viewer; `LiveStreamViewer` for playback; shared `src/components/live/*`.

---

## 4. Status — what's already shipped

### Backend (deployed) ✅
- 12-guest cap + `PANEL_FULL` (409); server-side gift-recipient enforcement.
- Gift-catalog DDL fix (gifting works); comment moderation + rate limit.
- Viewer-count Firestore-rules fix; `viewer.joined` events; host-mute + moderator endpoints.

### Client (latest build `2026236613`) ✅
- Immersive full-screen room (app home header removed); unified compact header (host + viewer).
- Unified bottom bar (Comment + Like/Gift/Share); chat lifted above the guest tray.
- Host control row (Mic/Flip/Camera/Layout/End) replacing the floating rail.
- Working Layout switcher: **Full / Strip / Grid** (drives the real guest-tray arrangement).
- Solo host = full-bleed (tray hidden, auto-reveals on first guest).
- Designed pre-live screen (branded hero + title + Go Live), no black void.
- Gift tray carousel + combo Send; real "X joined" names; mid-screen duplicate video fixed.

---

## 5. Roadmap

### M2 — Stage composition engine 🛠️ (next)
Make every participant (host included) a tile placed by a **layout** that both host and viewers share.
- Presets: Full · Split · Grid (2×2/3×3) · Host+Strip · Spotlight.
- Layout becomes a room property broadcast over the signaling bus → viewers render the same composition.
- Shared `LiveStage` component for host + viewer.
- Risks: live video-surface re-layout (avoid black-frame/flicker); needs on-device testing.

### M3 — Live battles (two hosts) 📋
A **Split layout + score game** on a shared stage. Backend largely exists (`startBattleStage` / `joinBattleStage` dual publish tokens; `attributeBattleGift`; `BattleOverlay`).
- Pairing flow ❓ (invite-a-friend vs random matchmaking vs both).
- VS intro + countdown; mid-screen score bar; winner/loser reveal.
- Team battles (each host + their guests on their half) within the 12-publisher cap.
- Viewers see the same split (depends on M2 signaling).

### M4 — Discovery + end-of-stream summary 📋
- Discovery: live-room cards in the feed (host face, LIVE, viewers, title, category).
- Summary: duration, peak viewers, new followers, coins/gifts, top supporters, share recap.

### M5 — Gifting depth, moderation, safety 📋
- Tiered gift animations (premium "moment" for 100+ coin gifts); viewer-to-viewer gifting ❓ (policy/anti-fraud).
- Moderator UI (appoint/revoke; mod controls); host mute/kick UI parity; report/block surfaced.
- Follow button wiring in the header.

### M6 — Scale, cost, performance, observability 📋
- HLS + server-side composition for large audiences (cost-efficient beyond the real-time break-even).
- Multi-region / participant replication for big or cross-region rooms/battles.
- Client perf (off-thread animations, batched bridge events); Redis for socket fan-out; metrics/alerts.

---

## 6. Open questions to decide together ❓
1. **Battle pairing:** invite-a-friend, random matchmaking, or both? Any rules (followers-only, level-gated)?
2. **Viewer gifting:** do we ship gifting *any* in-room viewer, and with what anti-fraud limits?
3. **Pre-live camera preview:** worth the native work later, or keep the designed (no-camera) setup screen?
4. **Battle stakes:** purely score/bragging, or a coin/gem reward + loser penalty (TikTok-style)?
5. **Discovery placement:** dedicated "Live" tab, a rail on Home, or both?
6. **Max guests in practice:** keep 11, or design battle/team modes around smaller per-side caps?

---

## 7. Constraints (known)
- IVS: 12 publishers/stage (hard); subscribers 10k+/stage; participant-hour billing (audio-only ~1/10th); empty stage not billed.
- Both battle hosts share one stage/region (latency trade-off for distant hosts → replication later).
- Everything monetary stays server-authoritative (economy in Postgres).
