# Profile tab fixes — READY for tip AAB

## Commit SHA (include in Play AAB bake)

`4599aef5190fc0121ca097a40add19a4280adc45`

Message: `fix(profile): speed save/wallet and stop Promote tab crash`

Branch tip (eas-modern): `feat/rooms-presence-ambassador` — bake from tip that **contains** this SHA (or later).

## Also pending on tip AAB stack

- AI create-post variants: `ebb8306c`
- Preload / lag: `5f24e0d2` (see `_agent/perf-20260806/PRELOAD.md`)
- Play fold/edge/R8: `17980e8f`

## Root causes + fixes

1. **Edit profile save slow** — Save awaited username collision queries (even when unchanged), club membership sync, and sequential post author-meta backfill (up to 200 docs) before `Alert` + goBack.
   - Fix: write user doc → update `ownProfileCache` → toast → goBack immediately; club sync + backfill run in background; skip uniqueness queries when username unchanged.

2. **Promote tab crash** — Promote Studio (`a5136e9`) called `subscribeMyBattles(callback)` without `uid`, so `cb` was undefined and Firestore snapshots crashed (`cb is not a function`). Empty/undefined catalog fields could also throw on `.replace` / `Math.min(...)`.
   - Fix: restore `useAuth` + `subscribeMyBattles(uid, cb)`; harden `battleService.subscribeMyBattles`; empty-catalog / missing-field guards; show fallback catalog without blocking on pricing.

3. **Wallet tab forever loading** — Profile gated Wallet/Promote on full `loadAll` `busy` (`isLoading`), so switching tabs waited on posts/stats. Balance fetches were sequential; no last-wallet cache; Stripe Connect only needed for withdraw but UX felt blocked.
   - Fix: mount Wallet/Promote immediately after auth; seed from `walletBalanceCache` + parent balances; `Promise.all` coin/gem fetches; skeleton while refreshing; Stripe Connect stays withdraw-only.

## Files

- `src/screens/EditProfileScreen.js`
- `src/components/PromoteTab.tsx`
- `src/services/battleService.js`
- `src/screens/ProfileScreen.v3.tsx`
- `src/screens/CoinStoreScreen.js`
- `src/components/BlypCoinWallet.js`
- `src/services/walletBalanceCache.js` (new)

## AAB agent handoff (`eac5730e-cc42-4153-9e3a-0f71035a5c6c`)

Include this SHA in the tip AAB bake (with `ebb8306` AI post + preload). Do **not** ship an AAB frozen before `4599aef5`.
