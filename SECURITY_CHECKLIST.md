# Security Checklist

Date: 2025-10-31

- [x] AndroidManifest trimmed: removed deprecated storage permissions and requestLegacyExternalStorage
- [ ] Network Security: restrict cleartext traffic to debug only (debug manifest present)
- [ ] Secrets: ensure no hardcoded secrets in repo
  - [ ] Move Firebase keys/config to EXPO_PUBLIC_* and document; avoid printing keys
  - [ ] Do not commit google-services.json to public repos
- [ ] Auth tokens: consider SecureStore for token persistence abstraction (fallback to AsyncStorage)
- [ ] Error handling: avoid leaking PII in logs
- [ ] Play Data Safety: REVIEW [`PLAY_DATA_SAFETY.md`](./PLAY_DATA_SAFETY.md) and confirm accuracy before submission
- [ ] Review Firestore/Storage rules against current features
- [ ] Minimum permissions principle on both platforms
