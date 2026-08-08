# Battle Arena UX brief

## P0 contract

Battle Arena is a scheduled, server-authoritative 1v1 event.

- Side A is always the creator and occupies IVS slot `0` / the left pane.
- Side B is always the invited opponent and occupies IVS slot `1` / the right pane.
- Accepted battles open their lobby at T-15 minutes.
- The server owns `INVITED → ACCEPTED → LOBBY_OPEN → COUNTDOWN → LIVE → FINALIZING → ENDED`.
- At the published start, both joined publishers enter a five-second countdown. A missing side gets a two-minute grace period before no-show finalization.
- Free and staked battles use the same registry and stage authorization. Escrow is optional; it is not stage authorization.
- Votes and gifts score only during `LIVE`. The gift picker must name `SIDE A` or `SIDE B`; recipient inference is not accepted.
- Gift score is written in the same backend transaction as the gift event. `giftEventId` uniqueness prevents retry or socket replay from scoring twice.
- Postgres is authoritative. Firestore and `battle_event` sockets are presentation mirrors.

## P0 user flow

1. Creator chooses opponent, title, published time, duration, and free/staked mode.
2. Opponent accepts or declines.
3. At T-15, both participants can enter the lobby and start/join the shared IVS stage.
4. UI always renders A left and B right, including on Side B's own device.
5. Once both are present and published time arrives, the server runs the countdown and opens scoring.
6. A viewer taps Gift, explicitly chooses Side A or Side B, then chooses the gift.
7. The server finalizes at duration expiry or participant end, determines the winner, settles/refunds, and mirrors the result.

## P0 verification

- Backend: `npm --prefix backend/blyp-live-service test`
- App static checks: `npm run typecheck` and `npm run lint`
- Manual: create a free battle, accept it, open both publisher devices before T-15, confirm fixed A/B placement, wait for countdown, send one gift to each explicit side, retry one gift request with the same idempotency key, cast one vote twice, and confirm final score/settlement.

## P1 (not part of this release)

- Push notification scheduling and deep-link polish.
- Tournament brackets, leagues, teams, and multi-round formats.
- Rich replay/highlight packaging and public battle history.
- Creator moderation controls beyond the existing live safety surface.
- Advanced combo multipliers, seasonal rankings, and discovery boosts.
