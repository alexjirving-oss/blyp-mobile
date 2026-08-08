# Blyp social sign-in setup

The mobile code uses Cognito Hosted UI federation. Google, Facebook, optional
Apple, and TikTok accounts therefore finish as normal Blyp Cognito user-pool
sessions; no second identity system is created.

TikTok Login Kit is OAuth 2.0, not OpenID Connect: TikTok does not issue the ID
token or publish the JWKS that a Cognito custom OIDC provider requires. Do not
enter TikTok's endpoints directly into Cognito. TikTok must sit behind a
server-side OIDC bridge:

```text
Blyp app -> Cognito Hosted UI -> custom OIDC provider "TikTok"
         -> Blyp OIDC bridge -> TikTok Login Kit
```

The bridge is an authentication service, not mobile code. It owns the TikTok
secret and converts a verified TikTok authorization into standards-compliant
OIDC claims for Cognito. Never scrape or reuse a session from the TikTok app.

## Public build configuration

Set these EAS environment variables (none are secrets):

```text
EXPO_PUBLIC_ENABLE_SOCIAL_AUTH=true
EXPO_PUBLIC_ENABLE_AMPLIFY=true
EXPO_PUBLIC_COGNITO_DOMAIN=<your-prefix>.auth.eu-west-2.amazoncognito.com
EXPO_PUBLIC_COGNITO_REDIRECT_SIGN_IN=blyp://auth/
EXPO_PUBLIC_COGNITO_REDIRECT_SIGN_OUT=blyp://auth/signout/
EXPO_PUBLIC_SOCIAL_PROVIDERS=Google,Facebook,TikTok
```

Only add `TikTok` (and optional `Apple`) to `EXPO_PUBLIC_SOCIAL_PROVIDERS` after
the corresponding Cognito provider is configured. The Cognito custom provider
name is case-sensitive and must be exactly `TikTok`. `scripts/generate-aws-exports.js`
writes these public values into the EAS artifact. Enter the Cognito domain
without `https://`.

## Cognito user pool

User pool: `eu-west-2_ITX07Zvnt`; app client:
`4a7r115hllaedriqsjlsa00snj`.

1. Create a user-pool domain (managed Cognito domain or custom domain).
2. Under **Sign-in experience → Federated identity provider sign-in**, add
   Google and Facebook. Map at least `email`, `name`, and `picture` where the
   provider supports them. Do not map a provider subject/UUID to
   `preferred_username`.
3. In the app client's Hosted UI settings:
   - enable Google and Facebook (and Apple if configured);
   - enable OAuth **Authorization code grant**;
   - enable scopes `openid`, `email`, and `profile`;
   - add callback URL `blyp://auth/`;
   - add sign-out URL `blyp://auth/signout/`.
4. Ensure the app client has no client secret. Native apps cannot safely hold
   one.

## Google

1. In Google Cloud Console, configure the OAuth consent screen.
2. Create a **Web application** OAuth client for Cognito.
3. Add this authorized redirect URI:
   `https://<cognito-domain>/oauth2/idpresponse`.
4. Put the Google client ID and client secret into the Cognito Google identity
   provider. Keep the client secret in Cognito/your secret manager; never add it
   to EAS public variables or this repository.

## Facebook

1. Create/configure a Meta app and add **Facebook Login**.
2. Add this valid OAuth redirect URI:
   `https://<cognito-domain>/oauth2/idpresponse`.
3. Put the Facebook app ID and app secret into the Cognito Facebook identity
   provider. Keep the app secret out of the client and repository.
4. Request/enable `email` and `public_profile`, and complete Meta app review or
   tester assignment as appropriate.

## TikTok

### 1. Deploy or select an OIDC bridge

The bridge must expose public HTTPS endpoints for:

- `/.well-known/openid-configuration`;
- `/authorize`;
- `/token`, accepting Cognito client authentication as `client_secret_post`;
- `/userinfo`, accepting a bearer token with HTTP GET;
- `/.well-known/jwks.json`.

It must perform TikTok's authorization-code exchange on the server, validate
`state`, use PKCE where TikTok requires it, and call TikTok's user-info API. It
must issue a signed ID token with at least `iss`, `aud`, `sub`, `iat`, `exp`, and
`kid`. Use TikTok `open_id` (or `union_id` when intentionally shared across
approved apps) as the source for a stable, namespaced OIDC `sub`. Publish the
active public signing key at the JWKS endpoint. Return `name` and `picture` from
TikTok's verified user response.

The bridge stores the TikTok client secret, OIDC signing private key, and the
OIDC client secret issued for Cognito outside this repository. Do not put any
of them in `EXPO_PUBLIC_*`, EAS public variables, app config, or the mobile
bundle.

### 2. TikTok Developer Portal

1. Create a TikTok developer app for Blyp and add **Login Kit**.
2. Add the bridge callback as the Login Kit redirect URI, for example
   `https://<bridge-domain>/oauth/tiktok/callback`. This is not Cognito's
   `/oauth2/idpresponse` URL and not the `blyp://` deep link.
3. Request `user.info.basic`. Request `user.info.email` only if available to the
   app and needed by the Cognito pool; complete TikTok review for every
   production scope.
4. Add the required privacy policy, terms, domain verification, and Android/iOS
   app details. For Android use package `com.blyp.mobile` and the production
   signing certificate. Complete Login Kit production review.
5. Store the TikTok client key and secret in the bridge's server-side
   configuration. Never place the client secret in this repository or app.

### 3. Cognito custom OIDC provider

In user pool `eu-west-2_ITX07Zvnt`:

1. Go to **Sign-in experience -> Federated identity provider sign-in -> Add
   identity provider -> OpenID Connect**.
2. Set provider name exactly to `TikTok`.
3. Enter the OIDC client ID and secret issued by the bridge, not the TikTok
   Login Kit credentials.
4. Set scopes to `openid profile`. Add `email` only when the bridge can return a
   real email authorized by the user.
5. Use the bridge issuer for discovery, or manually enter its authorization,
   token, user-info, and JWKS HTTPS endpoints. Select GET for user-info.
6. Map `sub`, `name`, and `picture`. Map `email` and `email_verified` only when
   supplied and verified. If the pool requires email, the bridge must obtain
   and verify a real email; do not invent a synthetic verified address.
7. In app client `4a7r115hllaedriqsjlsa00snj`, enable `TikTok`. Keep
   authorization-code grant, scopes `openid email profile`, and callback/sign-
   out URLs `blyp://auth/` and `blyp://auth/signout/`.
8. Add `TikTok` to `EXPO_PUBLIC_SOCIAL_PROVIDERS` only after a Hosted UI test
   succeeds. The native Cognito app client remains secretless.

The bridge must register Cognito's
`https://<cognito-domain>/oauth2/idpresponse` as its OIDC redirect URI. TikTok
itself redirects only to the bridge callback above.

## Apple (optional iOS path)

1. In Apple Developer, enable Sign in with Apple for `com.blyp.mobile`.
2. Create a Services ID and configure the Cognito domain return URL:
   `https://<cognito-domain>/oauth2/idpresponse`.
3. Generate the Apple private key and configure Cognito's Apple provider with
   the Services ID, Team ID, Key ID, and private key.
4. Enable Apple in the Cognito app client and append `Apple` to
   `EXPO_PUBLIC_SOCIAL_PROVIDERS`.

Apple's private key is a secret. Store it only in Apple/Cognito-approved secret
storage.

## Username claims

Deploy `firestore.wave0-live.rules` (and keep `firestore.rules` synchronized)
before releasing this client. The app atomically reserves lowercase handles in
`usernameClaims/{usernameKey}` and writes `username`, `usernameKey`, `handle`,
and `displayName` to `users/{uid}`.

After any social sign-in, including TikTok, that has no claimed Blyp username,
the app shows the same complete-profile screen used after email signup. Existing
users with a legacy missing username may choose **Not now** for the current
session.

## Verification

Test each provider in a development build (not Expo Go):

1. Tap the provider on both Log In and Create Account modes.
2. Complete Hosted UI consent and verify return to `blyp://auth/`.
3. Confirm the app resolves the Cognito `sub`, bridges Firebase Auth, and shows
   username completion for a first-time social account.
4. Confirm two accounts cannot claim the same handle with different casing.
5. Confirm `users/{uid}.username` and `.handle` never contain a Cognito UUID.
6. For TikTok, confirm Cognito tokens (not TikTok tokens) reach the app and no
   TikTok secret appears in the bundle or logs.
