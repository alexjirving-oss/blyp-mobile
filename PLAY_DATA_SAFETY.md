# Google Play Data Safety (Blyp Mobile)

Last updated: 2026-08-05

This document maps app features to data types collected/processed and third-party SDKs used, to assist with Google Play Data Safety disclosures.

**Pointers**
- Privacy policy (hosted): `blyp-landing/privacy.html` / production URL on blyp.world
- Legal HTML: `legal/privacy-policy.html`
- In-app: Privacy settings + deletion requests (`src/screens/PrivacySettingsScreen.js`, `src/services/PrivacyRequests.js`)
- Store ops checklist: `PRODUCTION_PLAY_STORE_CHECKLIST.md` §4
- Security review checklist: `SECURITY_CHECKLIST.md`

## SDKs
- Expo (runtime modules)
- AWS Amplify (Cognito Auth)
- Firebase (Firestore, Storage) — optional via EXPO_PUBLIC_DISABLE_FIREBASE
- Live: AWS IVS / Cloud Run live-service (stream metadata, gifts, moderation)
- Payments: Google Play Billing (Android IAP); Stripe Connect (withdrawals — **client CTA default OFF**)
- Optional crash reporting: Sentry (`EXPO_PUBLIC_SENTRY_DSN`, user-toggleable)

## Data Collection and Usage

- Authentication (Cognito)
  - User identifiers: email/phone (provided by user), Cognito `sub`
  - Purpose: Account creation, authentication, security, admin allowlisting
  - Data handling: Not sold/shared; used only for auth; stored in AWS Cognito

- User Content
  - Photos, videos, audio (uploads via Expo Camera/AV; Storage in Firebase Storage)
  - Captions, comments, DMs, live chat
  - Purpose: Core app functionality (posting, messaging, streaming)
  - Data handling: User-controlled; not sold; retained until user deletes or per retention policy
  - Moderation: reports may auto-hide content (`posts.moderation.hidden`); admins can remove / ban

- App Info and Performance
  - Crash logs and diagnostics (minimal console logs; optional Sentry when enabled)
  - Purpose: App stability
  - Data handling: Not sold/shared

- Device or Other IDs
  - May use instance IDs for Firebase (if enabled) / push tokens for FCM
  - Purpose: Messaging/notifications

- Financial
  - Coin purchase receipts (Play Billing); gem/coin balances on live-service
  - Withdrawals: not offered in production client until `EXPO_PUBLIC_ENABLE_WITHDRAWALS=1` **and** backend kill-switch

## Security Practices
- Data is encrypted in transit (HTTPS/TLS).
- Authentication: Cognito; admin routes gated by `ADMIN_ALLOWLIST_SUBS` (empty allowlist refuses all admin).
- Firestore client writes cannot set `isAdmin` / roles or clear `moderation.hidden`.
- Optional: Foreground service for camera during live capture (declared for Play).

## Data Deletion
- Users can request deletion via account / privacy settings (`PrivacyRequests`) and by removing uploaded content.
- Confirm Play Console “data deletion URL” matches live policy page before submission.

## Location
- Precise location: Not collected as a core product feature.
- Approximate location: Only if user opts into location-related features (review before store form).

## Additional Notes
- Cleartext traffic is allowed only in debug builds for local development.
- Storage permissions are limited; no broad external storage access in production.
- UGC + messaging + live: answer Play content rating / Families policies accordingly; gambling-like paid pots remain OFF.
