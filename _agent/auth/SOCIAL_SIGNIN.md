# Blyp social sign-in setup

The mobile code uses Cognito Hosted UI federation. Google, Facebook, and optional
Apple accounts therefore finish as normal Blyp Cognito user-pool sessions; no
second identity system is created.

## Public build configuration

Set these EAS environment variables (none are secrets):

```text
EXPO_PUBLIC_ENABLE_SOCIAL_AUTH=true
EXPO_PUBLIC_ENABLE_AMPLIFY=true
EXPO_PUBLIC_COGNITO_DOMAIN=<your-prefix>.auth.eu-west-2.amazoncognito.com
EXPO_PUBLIC_COGNITO_REDIRECT_SIGN_IN=blyp://auth/
EXPO_PUBLIC_COGNITO_REDIRECT_SIGN_OUT=blyp://auth/signout/
EXPO_PUBLIC_SOCIAL_PROVIDERS=Google,Facebook
```

Add `Apple` to `EXPO_PUBLIC_SOCIAL_PROVIDERS` only after the Apple provider is
configured. `scripts/generate-aws-exports.js` writes these values into the EAS
artifact. The Cognito domain is entered without `https://`.

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

After any social sign-in that has no claimed Blyp username, the app shows the
same complete-profile screen used after email signup. Existing users with a
legacy missing username may choose **Not now** for the current session.

## Verification

Test each provider in a development build (not Expo Go):

1. Tap the provider on both Log In and Create Account modes.
2. Complete Hosted UI consent and verify return to `blyp://auth/`.
3. Confirm the app resolves the Cognito `sub`, bridges Firebase Auth, and shows
   username completion for a first-time social account.
4. Confirm two accounts cannot claim the same handle with different casing.
5. Confirm `users/{uid}.username` and `.handle` never contain a Cognito UUID.
