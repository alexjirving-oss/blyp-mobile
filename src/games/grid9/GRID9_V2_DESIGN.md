# Grid 9 v2 — locked product design

**Unlock:** authorized protocol/product redesign (Alex, 2026-08-16).  
**Not unlocked:** LIVE / IVS / `src/live/**` — video stage stays SentinelStage / avatar placeholders only.  
**Authority that stays:** Redis aggregate, Lua commit, nonce, sequence, Cognito socket, escrow settlement.

Protocol: `GRID9_PROTOCOL_VERSION = 2`. Rules: `2026-08-16.4`.

---

## Locked match shape (NOW)

- **Closed 9-seat combat** until seats drop out / last standing.
- Audience is always open conceptually (watch + gifts + comments).
- **DEFERRED (do not build now):** mid-match seat inserts / agency “join once” team rules. Keep as future only.

---

## Roulette + who can fire

1. Server RNG among survivors → `ROULETTE_START` → land → active seat.
2. **Only the roulette-selected active seat** may FIRE / SHIELD from arsenal (inventory or escrow on their turn).
3. Audience does **not** remote-detonate weapons. Audience / kicked / eliminated late-game agency = **weapon gifts** into a living seat’s inventory.

---

## Weapon gifts (core — not money-only)

Gifts available = **arsenal catalog items** (Arrow / Shield / Fireball / MegaBomb — same IDs + `costCoins`).

`SEND_ARSENAL_GIFT` (any time while match is open: lobby / roulette / combat):

1. Debit sender `costCoins` from match escrow (same paid-intent discipline).
2. Split face: **70% recipient bankroll**, **30% jackpot**.
3. **Grant the item into recipient inventory**.
4. Recipient uses it on their **next active turn** via inventory consume → FIRE/SHIELD (not an instant remote strike).

### Inventory overflow (locked)

Capacity **3**. On grant when full: **FIFO drop oldest** so gifts always land.

### Self-buy

`BUY_INVENTORY_ITEM` for living combatants: same 70/30 accounting (70% stays on own bankroll, 30% jackpot) + item stocked. Distinct from instant `FIRE_WEAPON` / `PURCHASE_SHIELD` on your turn (those still exist for on-turn spend or inventory consume).

---

## Tokens SoT (mirrors gems; gems read-only)

| Field | Rule |
|---|---|
| Credit | Human victory: `tokens = floor(jackpotCoins * 0.5)` → `wallets.token_available` only |
| Convert | `POST /wallet/convert-tokens` → `ceil(tokens * 1.15)` coins (Instant +15% bonus) |
| Instant debit | **Available-first, then pending** — same allocation as gems Instant. Victory never writes `token_pending`, so pending is latent; convert still may debit pending if present, under row lock + conditional UPDATE (no overdraft / double convert via idempotency keys). |
| Why | Raw coin jackpot payout skips the cut; Tokens→Coins is the monetization boundary |
| Client | `grid9TokenWallet.ts` only — do not edit BlypCoinService / IAP freeze |

House keeps the other 50% of jackpot value (not credited as Tokens).

---

## Disconnect + kick

- Disconnect: **9s grace** (`GRID9_DISCONNECT_GRACE_MS`), then mark disconnected and **auto-resolve turn** if that seat is spotlight (auto-shield / pass → next roulette).
- Kick (host-only): seated player → **audience** (can still gift); seat filled with **Sentinel** so the 9-box stays full; room broadcast carries `replacementPlayer` + `audienceCount`; kicked user also receives private `PRIVATE_ROOM_STATUS: kicked` (slotIndex null).

---

## Discoverability (public matches)

- `GET /api/grid9/matches` lists **public** active matches only (no private room codes / tokens / secrets).
- Games hub → **Live Grid 9** rows → Spectate opens arena as **audience** via `REQUEST_SNAPSHOT` (not a combatant seat).

---

## Catalog fantasy (locked numbers)

| Item | Cost | Instant-fire jackpot contrib | Gift/self-buy split |
|---|---:|---:|---|
| Arrow | 10 | 5 | 70% bankroll / 30% jackpot of **cost** |
| Shield | 15 | 8 | same |
| Fireball | 25 | 12 | same |
| MegaBomb | 50 | 25 | same |

---

## Deferred agency-join-once

Mid-match human seat inserts and agency “join once” team rules remain **future-only**. Do not implement until Alex unlocks that product slice.

---

## What stays from v1 / Wave 1 authority

Redis match aggregate + Lua single `HSET` commit · one-time nonces · monotonic room `sequence` · Cognito JWT socket · platform wallet → match escrow → settlement · 9 slots · server-only damage/HP/jackpot.
