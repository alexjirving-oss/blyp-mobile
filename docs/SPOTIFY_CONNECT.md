# Spotify Connect (Model A) — Alex Dashboard checklist

Blyp links the **user’s own Spotify Premium** account so they can keep listening
while browsing the app. Blyp does **not** resell Spotify catalog as Plus content.

## App wiring (already in repo)

- Screen: `SpotifyConnect` (`src/screens/SpotifyConnectScreen.js`)
- Service: `src/services/spotifyConnectService.js` (PKCE via `expo-auth-session`)
- Audio coordinator: pauses Spotify when For You unmutes / live joins
- Redirect scheme: `blyp://spotify` (default; override with `EXPO_PUBLIC_SPOTIFY_REDIRECT_URI`)

## What Alex must do in Spotify Developer Dashboard

1. Open [https://developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Create an app (or open the Blyp app)
3. **Redirect URIs** — add exactly:
   - `blyp://spotify`
   - (optional Expo Go / web) whatever `AuthSession.makeRedirectUri` prints in a debug build
4. Note the **Client ID** (public). For mobile PKCE you typically do **not** ship a client secret.
5. Put Client ID into EAS / local env (never commit secrets):

```text
EXPO_PUBLIC_SPOTIFY_CLIENT_ID=<client-id>
EXPO_PUBLIC_SPOTIFY_REDIRECT_URI=blyp://spotify
```

6. Rebuild the app (env is baked at build time).
7. Android package / iOS bundle must match the Dashboard app settings if Spotify asks for them (`com.blyp.mobile` — see `app.config.js`).

## Runtime behaviour

- User opens **Hub → Spotify Connect** (or navigates to `SpotifyConnect`)
- Links account once; tokens stored on-device
- Resume/Pause uses Spotify Web API player endpoints (requires an active Spotify device — user should open Spotify once)
- Blyp pauses Spotify (soft-fail) when it needs audio focus:
  - unmuted For You (`HomeScreen` → `pauseSpotifyForBlypAudio('for_you_unmuted')`)
  - live join (`LiveStreamScreen` → `live_join`)
  - call start / answer (`callService` → `call_start` / `call_answer`)

## Dashboard checklist (copy/paste)

| Setting | Value |
|---------|--------|
| App type | Web / mobile (PKCE; no client secret in the app) |
| Redirect URI | `blyp://spotify` |
| Client ID env | `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` |
| Redirect env (optional) | `EXPO_PUBLIC_SPOTIFY_REDIRECT_URI=blyp://spotify` |
| Android package | `com.blyp.mobile` |
| Scopes requested | `user-read-email`, `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`, `streaming` |

## Blocked without Alex

Without `EXPO_PUBLIC_SPOTIFY_CLIENT_ID`, the screen shows setup steps and cannot complete OAuth. That is expected until Dashboard + env are filled.
