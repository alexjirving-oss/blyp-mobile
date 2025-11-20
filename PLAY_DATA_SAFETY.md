# Google Play Data Safety (Blyp Mobile)

Last updated: 2025-10-31

This document maps app features to data types collected/processed and third-party SDKs used, to assist with Google Play Data Safety disclosures.

## SDKs
- Expo (runtime modules)
- AWS Amplify (Cognito Auth)
- Firebase (Firestore, Storage) — optional via EXPO_PUBLIC_DISABLE_FIREBASE

## Data Collection and Usage

- Authentication (Cognito)
  - User identifiers: email/phone (provided by user)
  - Purpose: Account creation, authentication, security
  - Data handling: Not sold/shared; used only for auth; stored in AWS Cognito

- User Content
  - Photos, videos, audio (uploads via Expo Camera/AV; Storage in Firebase Storage)
  - Purpose: Core app functionality (posting, streaming)
  - Data handling: User-controlled; not sold; retained until user deletes or per retention policy

- App Info and Performance
  - Crash logs and diagnostics (minimal console logs; optional error monitoring service)
  - Purpose: App stability
  - Data handling: Not sold/shared

- Device or Other IDs
  - May use instance IDs for Firebase (if enabled)
  - Purpose: Messaging/analytics (currently minimal)

## Security Practices
- Data is encrypted in transit (HTTPS/HLS).
- Authentication: Password-based login via Cognito; tokens stored with AsyncStorage (optionally SecureStore in future).
- Optional: Foreground service for camera/mic during live capture.

## Data Deletion
- Users can request deletion via account settings (implement per policy) and by removing uploaded content.

## Location
- Precise location: Not collected.
- Approximate location: Not collected.

## Additional Notes
- Cleartext traffic is allowed only in debug builds for local development.
- Storage permissions are limited; no broad external storage access in production.
