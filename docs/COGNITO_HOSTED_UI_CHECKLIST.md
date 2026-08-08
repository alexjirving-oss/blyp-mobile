# Cognito Hosted UI — Alex checklist

Client wiring for Google / Facebook / TikTok is in the app. Buttons call
`signInWithRedirect` via `src/services/socialAuthService.js` when the Hosted UI
domain is set. **OAuth cannot complete until the items below are done in Console
+ EAS.** Full runbook: `_agent/auth/SOCIAL_SIGNIN.md`.

## Blocked on Alex (not inventable)

1. **Create / confirm Cognito Hosted UI domain**  
   Example shape: `<prefix>.auth.eu-west-2.amazoncognito.com` (no `https://`).
2. **Set EAS env (production + preview)**  
   `EXPO_PUBLIC_COGNITO_DOMAIN=<that-domain>`  
   Already present for redirects:
   - `EXPO_PUBLIC_COGNITO_REDIRECT_SIGN_IN=blyp://auth/`
   - `EXPO_PUBLIC_COGNITO_REDIRECT_SIGN_OUT=blyp://auth/signout/`
3. **Enable IdPs on the app client** (pool `eu-west-2_ITX07Zvnt`, client
   `4a7r115hllaedriqsjlsa00snj`): Google, Facebook; Apple only if listed in
   `EXPO_PUBLIC_SOCIAL_PROVIDERS`.
4. **Hosted UI app client**: Authorization code grant; scopes `openid email
   profile`; callback / sign-out URLs above; **no client secret**.
5. **TikTok**: needs the server OIDC bridge (not a direct Cognito OIDC paste) —
   see SOCIAL_SIGNIN.md. Until the bridge exists, TikTok stays “setup needed”.
6. **Rebuild / bake** after the domain env is set so `generate-aws-exports.js`
   embeds oauth into the binary.

## Already done in code

- AuthScreen social buttons + Hosted UI launch path
- Amplify oauth config from env / aws-exports generator
- Clear in-app alert when domain / IdP not configured
- Username overlay first-time only (deferral persisted; no launch spam)

## Verify after Alex sets domain

1. Fresh install of the new tip
2. Tap Continue with Google → Cognito Hosted UI → return to Blyp signed in
3. Same for Facebook
4. TikTok only after bridge + IdP exist
