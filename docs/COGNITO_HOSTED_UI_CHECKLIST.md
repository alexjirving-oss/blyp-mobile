# Cognito Hosted UI — Alex checklist

Client + env are wired. Domain is live in AWS:
`eu-west-2itx07zvnt.auth.eu-west-2.amazoncognito.com`
(pool `eu-west-2_ITX07Zvnt`, app client `4a7r115hllaedriqsjlsa00snj`).

Tapping Google / Facebook / TikTok calls Amplify `signInWithRedirect`. **OAuth
cannot finish until IdPs exist in Console** (currently `list-identity-providers`
is empty).

## Remaining Console clicks (secrets only Alex can supply)

1. **Google** — Cognito → User pool → Social / IdP → Add Google. Paste Google
   OAuth client id + secret. Enable Google on app client
   `4a7r115hllaedriqsjlsa00snj`. Callback already: `blyp://auth/`.
2. **Facebook** — Same path with Facebook App id + secret; enable on the same
   app client.
3. **Hosted UI / Managed Login** — Authorization code; scopes `openid email
   profile`; sign-out URL `blyp://auth/signout/`; **no client secret**.
4. **TikTok** — Needs the server OIDC bridge (not a direct Cognito paste). Until
   that exists, TikTok may open Hosted UI then fail — expected.
5. **Optional** — After IdPs exist, set
   `EXPO_PUBLIC_COGNITO_IDP_PROVIDERS=Google,Facebook` (add TikTok when ready)
   so builds only advertise live providers.

No bake required for client wiring already in repo; rebuild only if an older tip
lacks `EXPO_PUBLIC_COGNITO_DOMAIN`.

## Already done in code

- `EXPO_PUBLIC_COGNITO_DOMAIN` in `eas.json` (dev / preview / production)
- Amplify oauth merge in `src/config/amplify.js` + `scripts/generate-aws-exports.js`
- AuthScreen buttons → `signInWithRedirect` (no “coming soon” gate when domain set)
- Username: email signup only; social missing-handle = one-time max, never every launch
