# Grid 9 handover

Nine-box live battle royale. The server is the only authority. The client sends signed intents and renders public snapshots.

## Architecture

**Live-service** (`backend/blyp-live-service/src/games/grid9/`): Socket.IO channel `grid9`, Cognito id JWT handshake, Redis match aggregate + Lua commit, Postgres paid-only reserve into match escrow, ZSET presence timeouts for Cloud Run. Room events carry monotonic `sequence`. Paid actions do not broadcast until one `HSET` commits.

**Client data layer** (`useGrid9`, `Grid9Provider`, `src/realtime/grid9GameSocket.ts`): non-authoritative store. Drops stale room packets, requests a snapshot on a sequence gap. Intents attach a 16-byte base64url CSPRNG nonce (not `randomUUID()`).

**Client UI**: `Grid9ArenaScreen` → provider + `Grid9ArenaView` (header, 3x3 board, action drawer, weapons / shield gallery, targeting, proxy-war fund). NativeWind is scoped to `src/games/grid9/**` via `grid9.css` and `metro.config.js`.

Do not mount this under `src/components/live/**` or `src/screens/LiveStreamScreen.js` (LIVE freeze).

## Flags (default OFF)

| Layer | Flag | Effect |
|---|---|---|
| Client | `EXPO_PUBLIC_LIVE_GRID9_ENABLED` | `isGrid9Enabled()` in `src/config/Grid9Flags.js`. Off → `Grid9ArenaScreen` shows the locked view and does not open a socket. |
| Live-service | `LIVE_GRID9_ENABLED` | Off → intents return `MATCH_NOT_ACTIVE`. `WELCOME` still arrives. |

Client reads `process.env[key]` then `Constants.expoConfig.extra`. For a release binary, also put `EXPO_PUBLIC_LIVE_GRID9_ENABLED` in `app.config.js` `extra` / EAS env. Turn **both** flags on before a real match. Catalog costs must stay aligned: arrow 10, fireball 50, mega bomb 200, nano shield 25.

## Mount `Grid9ArenaScreen`

`Grid9ArenaScreen` is a **named** export. Follow the existing `ArtilleryGame` lazy-screen pattern in `App.js`:

```js
const Grid9ArenaScreen = React.lazy(() =>
  import('./src/games/grid9/Grid9ArenaScreen').then((mod) => ({
    default: mod.Grid9ArenaScreen,
  }))
);

<Stack.Screen name="Grid9Arena" children={(navProps) => (
  <Suspense fallback={null}>
    <Grid9ArenaScreen {...navProps} />
  </Suspense>
)} />
```

Navigate with `navigation.navigate('Grid9Arena')` from Games (or another non-LIVE surface) only after both flags are on. Unmount closes the socket and clears the session store.

## Verify

- Client: `npm run typecheck` and `npx jest src/games/grid9/__tests__`
- Live-service: `npm test` / `npm run typecheck` in `backend/blyp-live-service`
