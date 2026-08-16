# Grid 9 handover

Nine-box live battle royale. **v2 unlock (Wave 1):** see `GRID9_V2_DESIGN.md` and live-service `ARCHITECTURE.md` § Grid 9 v2. Protocol version **2**.

The server is the only authority. The client sends signed intents and renders public snapshots.

## Architecture

**Live-service** (`backend/blyp-live-service/src/games/grid9/`): Socket.IO channel `grid9`, Cognito id JWT handshake, Redis match aggregate + Lua commit, Postgres paid-only reserve into match escrow, ZSET presence timeouts for Cloud Run. Room events carry monotonic `sequence`. Paid actions do not broadcast until one `HSET` commits.

**Client data layer** (`useGrid9`, `Grid9Provider`, `src/realtime/grid9GameSocket.ts`): non-authoritative store. Drops stale room packets, requests a snapshot on a sequence gap. Intents attach a 16-byte base64url CSPRNG nonce (not `randomUUID()`).

**Client UI**: `Grid9ArenaScreen` → provider + `Grid9EntryPortal` (Play / Private) → `Grid9ArenaView` (roulette flash, header, 3x3 board, action drawer, victory stub). NativeWind is scoped to `src/games/grid9/**` via `grid9.css` and `metro.config.js`.

Do not mount this under `src/components/live/**` or `src/screens/LiveStreamScreen.js` (LIVE freeze).

## Flags (default OFF)

| Layer | Flag | Effect |
|---|---|---|
| Client | `EXPO_PUBLIC_LIVE_GRID9_ENABLED` | `isGrid9Enabled()` in `src/config/Grid9Flags.js`. Off → locked view, no socket. |
| Live-service | `LIVE_GRID9_ENABLED` | Off → intents return `MATCH_NOT_ACTIVE`. `WELCOME` still arrives. |

Catalog (v2): Arrow 10 / Shield 15 / Fireball 25 / MegaBomb 50. Client + server + Lua stay locked.

## Verify

- Client: `npm run typecheck` and `npx jest src/games/grid9/__tests__`
- Live-service: grid9 suites under `backend/blyp-live-service` (`npm run typecheck` + `node --test dist/games/grid9/*.test.js`)
