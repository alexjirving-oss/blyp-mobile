# Secrets Triage (Phase 1)

Date: 2025-11-03

Summary:
- Removed hard-coded Gemini API key from `src/config/firebase.js`. Now read from `process.env.EXPO_PUBLIC_GEMINI_API_KEY` and construct URL via `EXPO_PUBLIC_GEMINI_API_URL`.
- Migrated Firebase Web API key to `process.env.EXPO_PUBLIC_FIREBASE_API_KEY`.
- Added `.env.example` with placeholders and updated `.gitignore` to ignore `.env*`.
- Sentry DSN read from `process.env.EXPO_PUBLIC_SENTRY_DSN` (no values committed).

False positives documented:
- Firebase Web API key: public-by-design for client apps; secured by Firestore/Storage rules. No server privileges.
- AWS Cognito pool IDs / client IDs in `src/aws-exports.js`: identifiers, not secrets.
- Supabase config file contains placeholders only; anon key should be treated as public with RLS.

Next actions:
- If any provider credentials were previously committed, rotate at provider and consider history purge (BFG) before tagging a release.
- Re-run the audit to confirm P0 is cleared (no trufflehog hits).
