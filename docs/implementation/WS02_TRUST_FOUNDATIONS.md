# WS-02 Trust, Privacy, Block, and Mute Foundations

**Status:** Implemented on isolated branch `workstream/ws02-trust-foundations-20260801`

**Parent checkpoint:** `integration/first-batch-20260801` at `9fba41a321ad824a839929e8f92fe6fe51eb78e8`

**Scope:** auditable consent and age-band profiles, safe-default privacy settings, canonical block and mute controls, versioned Trust events, a fail-closed cross-domain policy decision service, and an authenticated mobile API client.

## 1. Outcome

WS-02 establishes one server-authoritative Trust boundary for later Feed, Search, Messaging, Live Rooms, Dating, Gifts, Team, and AI work. Product domains must query or invoke this boundary rather than reading client-owned privacy documents or reproducing block and mute logic locally.

| Decision | Authoritative implementation | Consequence |
|---|---|---|
| Consent and policy profile | PostgreSQL `trust_policy_profiles` plus append-only history | Consent, age band, jurisdiction, policy version, source, and withdrawal state are auditable. |
| Privacy | PostgreSQL `trust_privacy_settings` plus append-only history | Missing state fails closed; default visibility and processing permissions are restrictive. |
| Block and mute | PostgreSQL `trust_relationship_controls` plus history | Controls are canonical, directional, versioned, auditable, and evaluated in both directions. |
| Policy evaluation | `evaluateTrustPolicy` and `requireTrustPolicy` | Cross-domain services receive deterministic allow/deny decisions and bounded reason codes. |
| Mobile access | `trustApiService` over `platformApiClient` | Trust mutations use Cognito identity, client versioning, correlation IDs, and idempotency. |
| Rollout | `trust.policy_v1`, inserted disabled at zero percent | The schema and API can be deployed before enforcement is enabled. |

## 2. Safe defaults and policy profile

A consent acceptance records a validated ISO birth date, derived age band, two-letter jurisdiction, accepted policy version, acceptance source, canonical user subject, and monotonically increasing profile version. The server derives the age band; clients cannot assert it directly.

| Privacy field | Initial value |
|---|---|
| Account visibility | `private` |
| Content visibility | `followers` |
| Message permission | `nobody` |
| Discoverability | `hidden` |
| Location precision | `off` |
| Personalisation | Disabled |
| Analytics | Disabled |
| AI training | Disabled |

Withdrawal retains the profile and history, marks consent withdrawn, records the timestamp, and causes policy evaluation to deny capabilities that require an accepted profile.

## 3. Versioned API

All routes are mounted below `/api/v1/trust`, require verified Cognito authentication and `X-Client-Version`, inherit canonical response envelopes and correlation IDs, and apply a bounded Trust rate limit.

| Method and route | Purpose | Mutation controls |
|---|---|---|
| `GET /api/v1/trust/me` | Return the caller’s consent profile and privacy state | Read-only |
| `POST /api/v1/trust/me/consent/accept` | Accept a policy version and establish or update the policy profile | Strict schema and `Idempotency-Key` |
| `POST /api/v1/trust/me/consent/withdraw` | Withdraw the caller’s accepted consent | Strict schema and `Idempotency-Key` |
| `POST /api/v1/trust/me/privacy` | Apply a bounded partial privacy update | Strict schema and `Idempotency-Key` |
| `GET /api/v1/trust/me/relationships` | List active block and/or mute controls | Optional validated type filter |
| `POST /api/v1/trust/me/relationships` | Add or update a block or mute | Strict schema and `Idempotency-Key` |
| `DELETE /api/v1/trust/me/relationships/:type/:target` | Remove a block or mute | Validated path and `Idempotency-Key` |
| `POST /api/v1/trust/decisions` | Evaluate a capability against consent, age, privacy, block, and mute state | Read-only decision; no client-supplied actor identity |

Unknown fields are rejected. User identifiers are bounded, self-targeting controls are rejected, blocks cannot expire, and mute expiry must be in the future and no more than 366 days away.

## 4. Policy semantics

The baseline evaluator denies when the actor lacks accepted consent, does not meet a required age band, or the target’s privacy state does not permit the requested capability. Missing consent or privacy records are explicit denial reasons, not permissive fallbacks.

| Signal | Affected capability | Result |
|---|---|---|
| Block in either direction | All capabilities | Deny with `BLOCKED_RELATIONSHIP` |
| Actor mutes target | `view`, `discover` | Deny with `MUTED_BY_ACTOR` |
| Target mutes actor | `contact` | Deny with `MUTED_BY_TARGET` |
| Target consent inactive or missing | All evaluated cross-user capabilities | Deny with `TARGET_CONSENT_INACTIVE` |
| Follower-only visibility without relationship proof | `view`, `contact`, `discover` | Deny with `FOLLOW_RELATIONSHIP_REQUIRED` |

`requireTrustPolicy` converts a denied decision into the bounded `TRUST_POLICY_DENIED` API error and includes only capability, target, denial reasons, and policy/privacy versions. Domain services should call it before performing protected reads, joins, contacts, gifts, or other state changes.

## 5. Persistence and audit

Migration `0003_trust_foundation` is transactional, ordered after the platform spine, and deliberately irreversible because it stores consent and relationship audit evidence.

| Table | Responsibility |
|---|---|
| `trust_policy_profiles` | Current consent, age-band, jurisdiction, and accepted-policy state |
| `trust_consent_history` | Append-only consent acceptance and withdrawal evidence |
| `trust_privacy_settings` | Current restrictive privacy settings |
| `trust_privacy_history` | Append-only full snapshots for every privacy version |
| `trust_relationship_controls` | Active directional blocks and mutes |
| `trust_relationship_history` | Append-only add/remove evidence with correlation IDs |

Mutations use transaction-scoped PostgreSQL advisory locks, row locks where applicable, monotonic versions, and the existing transactional outbox. The schema includes reverse relationship indexes so target-side block checks do not require scans.

## 6. Versioned events

| Event | Emitted when |
|---|---|
| `trust.consent.changed.v1` | Consent is accepted or withdrawn |
| `trust.privacy.changed.v1` | Privacy settings change |
| `trust.relationship.changed.v1` | A block or mute is added, updated, or removed |

Every payload is validated against the event registry before insertion into the outbox. Event names and numeric versions must agree.

## 7. Mobile contract

`src/services/trustApiService.js` is the only new mobile Trust transport. It uses the shared authenticated platform client and never writes Trust state to Firestore. Consent, privacy, block, mute, and removal mutations supply stable idempotency keys and bounded retry intent through the existing transport contract.

The service exposes snapshot, consent acceptance, consent withdrawal, privacy update, relationship listing, relationship add/update, relationship removal, and policy evaluation methods. UI adoption remains feature-flagged and belongs to the consuming domain or settings screen.

## 8. Rollout sequence

| Gate | Required evidence | Stop condition |
|---|---|---|
| 1. Database backup | Restorable PostgreSQL backup captured | No verified restore path |
| 2. Preflight | Build, aggregate backend contracts, root CI, and typecheck pass | Any compiler, contract, lint, or security-gate regression |
| 3. Schema | Migrations `0001` through `0003` apply once and report clean status | Drift, lock failure, or partial migration |
| 4. API canary | Real token can read/update only its own Trust state; unknown fields and missing idempotency fail | Actor spoofing, permissive missing state, or unsafe error details |
| 5. Relationship canary | Block and mute work in both directions; expiry and self-target rules hold | Any protected action survives an active block |
| 6. Domain shadow mode | Domains compare Trust decisions without changing user-visible results | Unexpected denial rate or missing identity mappings |
| 7. Controlled enforcement | Enable `trust.policy_v1` for allowlisted subjects, then a bounded percentage | Error spike, unexplained denial, or audit/outbox gap |

The flag must remain disabled until each consuming domain has explicit Trust checks and rollback observability.

## 9. Validation evidence

| Validation | Result |
|---|---|
| Backend TypeScript build | Passed |
| Aggregate backend contracts | Passed: 13 tests, 0 failures |
| Pure Trust policy tests | Age boundaries, invalid dates, missing state, consent, age gates, privacy, block, mute, and target consent covered |
| Event contracts | Trust event registration, valid payload, and invalid payload rejection covered |
| Migration contract | Ordered ID, transactional behavior, irreversible status, and callable upgrade covered |
| Mobile Trust client | Passed: 4 tests, 0 failures |
| Root production integrity, secret scan, dependency ratchet, lint, and Jest | Passed: 11 suites and 37 tests |
| Root TypeScript no-emit | Passed |

Live integration against production Cognito, PostgreSQL, Redis, Firebase, or downstream product domains was not attempted from the isolated worktree. The rollout gates above remain mandatory.

## 10. Boundaries and follow-on work

This branch supplies the Trust authority and reusable enforcement primitive. It does not claim that every legacy product path is already protected.

| Follow-on domain | Required adoption |
|---|---|
| Feed and Search | Filter blocked/muted subjects and invoke `view`/`discover` decisions before returning content |
| Messaging | Invoke `contact` before thread creation, recipient selection, or delivery |
| Live Rooms and Games | Invoke `join` and content visibility decisions before room admission or invitation |
| Dating | Apply consent, age-band, block, privacy, and discoverability decisions before candidate projection |
| Gifts and Economy | Invoke `transact` before a cross-user gift and retain the Trust decision evidence with the transaction |
| Team | Apply `contact`/`join` decisions before invites, membership changes, and private workspace access |
| AI | Respect consent, age band, privacy, and AI-training permission before retaining or training on user data |

Firestore’s legacy authenticated catch-all remains a production blocker outside this branch. No consuming domain may treat that catch-all as equivalent to Trust policy enforcement.
