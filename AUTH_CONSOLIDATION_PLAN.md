# Auth Consolidation Plan

## Rationale
Hybrid Cognito + (optional) Firebase auth increases complexity: dual identity mapping, token refresh divergence, analytics identity fragmentation. Consolidation reduces risk of half-authenticated states and simplifies moderation/audit.

## Current State
- Cognito (Amplify) primary with sticky optimistic window.
- Firebase auth optionally preferred via env flags.
- Firestore documents keyed by Firebase UID or Cognito mapped user; risks mismatch.

## Target
Single canonical identity provider (Cognito OR Firebase). Other provider acts as auxiliary (e.g., Firebase only for services needing it). All analytics/user references use canonical ID.

## Evaluation Criteria
| Criterion | Cognito | Firebase |
|-----------|---------|----------|
| Mobile SDK maturity | High | High |
| Custom auth flows (MFA, SRP) | Strong | Moderate |
| Real-time DB integration | Indirect | Native |
| Future ecosystem (Functions, Storage) | Moderate | Strong |
| Migration complexity | Lower staying | Higher switching |

## Proposed Direction
Retain Cognito as canonical (lower migration) while improving mapping to Firebase UID (if used). Consider Firebase-only pilot with dual-write mapping for new users.

## Phased Plan
1. Discovery: Inventory all places reading `auth.currentUser` (both providers). Map divergences.
2. Instrumentation: Emit auth identity consistency events (cognitoId, firebaseUid, mismatch flag).
3. Dual Mapping: Store canonical cognitoId → firebaseUid in `userProfiles` docs.
4. Feature Flag: `EXPO_PUBLIC_CANONICAL_AUTH_PROVIDER` controls which path UI displays.
5. Progressive Enforcement: Warning logs for mismatches; block actions if mapping absent after grace period.
6. Cutover (if choosing Firebase): Introduce silent re-auth for existing Cognito sessions; update tokens lazily.
7. Rollback: Retain rehydration logic to switch back via flag within one deploy.

## Monitoring
- Mismatch rate (% of sessions with differing IDs).
- Auth bounce/flicker events.
- Latency of token refresh.

## Risks & Mitigations
- User confusion during swap: Keep sticky window, unify display name derivation.
- Data orphan risk: Ensure dual-write before canonical switch.

## Next Steps
- Implement discovery script.
- Add identity consistency event in `EnterpriseAnalyticsService`.
- Add mapping field in profile docs (if absent).
