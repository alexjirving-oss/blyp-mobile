# Firebase Web API Key Suspension

If you see an auth error similar to:

```
Firebase: Error (auth/permission-denied:-consumer-'api-key:XXXX'-has-been-suspended.)
```

it means Google has suspended the Web API key being used for Firebase Auth requests. Anonymous sign‑in and other Identity Toolkit calls will fail until a valid key is configured.

## Common Causes
- Key manually restricted or deleted in Google Cloud Console > APIs & Services > Credentials.
- Key flagged or auto‑disabled due to suspected abuse (exposed publicly, high unexpected traffic).
- Project billing disabled or in arrears causing auth endpoints to reject requests.
- Identity Toolkit / Firebase Auth API disabled for the project.
- Accidental use of an old key from a different (inactive) Firebase project.

## Immediate Impact
- `signInAnonymously`, email/password, custom token, etc. all fail.
- Firestore/Storage security rules requiring `request.auth != null` cannot be satisfied, blocking writes/reads that rely on authenticated context.
- Any posting/upload flow depending on a Firebase UID will fail early.

## Remediation Steps
1. Open Firebase Console > Project Settings > General.
2. Note the current Web API Key; press the rotate icon (or create a new key in Google Cloud Console if needed).
3. In Google Cloud Console > APIs & Services > Credentials:
   - Create New API Key.
   - (Optional) Restrict key: Application restrictions -> None (for React Native dev) or HTTP referrers if only web; API restrictions -> Allow only "Firebase" / "Identity Toolkit"/"Cloud Firestore"/"Firebase Storage" related APIs.
4. Ensure the following APIs are ENABLED in Google Cloud Console > APIs & Services > Library:
   - Identity Toolkit API
   - Cloud Firestore API
   - Firebase Rules API (optional but recommended)
   - Firebase Management API
5. Confirm billing status (Billing > Overview) is active.
6. Update your environment variables:
   - In `app.config.js` / `app.json` extra or local `.env`: set `EXPO_PUBLIC_FIREBASE_API_KEY` to the new key.
   - Remove any stale `firebase.local` override referencing the old key.
7. Restart the dev client:
   - Stop Metro / Expo.
   - Clear caches (`expo start --clear` or use `./start-app.ps1`).
8. Re-run the app and watch logs for `🔐 Ensuring Firebase auth (anonymous)` followed by absence of suspension errors.

## Verification Checklist
- Anonymous auth returns a user object with a UID (log shows success, no suspension message).
- Firestore writes succeed (no permission-denied from rules due to missing auth).
- Storage uploads produce a `downloadURL` instead of immediate auth failure.

## Optional: Automatic Fallback
Current code sets a `firebaseSuspended` flag to prevent repeated attempts and surfaces a clear alert. If you want to fully stub Firebase when suspended, you can set `EXPO_PUBLIC_DISABLE_FIREBASE=1` temporarily.

## Security Hygiene
- Never commit raw API keys in public repos.
- Rotate keys periodically (quarterly) or after suspected leakage.
- Use monitoring/alerts for abnormal auth traffic.

## Troubleshooting After Rotation
| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Still seeing suspension message | App restarted with old bundle | Fully reload Expo, ensure env rebuild |
| `auth/network-request-failed` | Local connectivity / proxy | Check network, disable VPN/proxy |
| `API key not valid` | Typo / wrong project | Copy key again; verify project ID matches |

If suspension persists after rotation and billing/API enable checks, contact Firebase Support with project ID and error details.

---
Last updated: (auto-generated) Rotation guide for Blyp Mobile.
