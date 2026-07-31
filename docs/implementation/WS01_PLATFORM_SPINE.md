# WS-01 Platform Spine and Canonical Identity

**Status:** Implemented on isolated branch `manus/ws01-platform-spine`

**Parent checkpoint:** `manus/ws00-wave0`

**Scope:** canonical API identity, versioned transport, verified legacy linking, request contracts, feature controls, database migrations, idempotency, and transactional domain-event delivery.

## 1. Outcome

WS-01 creates the shared platform boundary that later product workstreams must use rather than adding further direct, unversioned, or client-authoritative integrations. The mobile client now obtains a canonical Cognito **access token**, the backend derives the user identifier exclusively from the verified Cognito `sub`, and Firebase identities can be linked only by presenting a Firebase ID token that the backend verifies with Firebase Admin.

| Decision | Authoritative implementation | Consequence |
|---|---|---|
| API identity | Verified Cognito access token and canonical `sub` | Client-supplied user IDs are not identity evidence. |
| Legacy identity | `identity_links` in PostgreSQL | Firebase remains a linked legacy namespace, not API authority. |
| API contract | `/api/v1/platform` plus a stable envelope | New workstreams share correlation, errors, version checks, and auth semantics. |
| Persistence | PostgreSQL through the existing economy infrastructure | No second database connection or configuration path was introduced. |
| Event delivery | Transactional PostgreSQL outbox to BullMQ | Domain writes and event enqueueing can occur in one transaction. |
| Feature control | PostgreSQL flags evaluated server-side | Unknown and unavailable flags resolve disabled. |
| Schema evolution | Ordered, advisory-lock-protected migrations | Ad hoc startup schema mutation is replaced by a recorded migration ledger. |

## 2. Runtime topology

```mermaid
flowchart LR
  M[Mobile app] -->|Cognito access token| G[/api/v1/platform]
  G --> C[Cognito JWT verification]
  C --> P[Versioned platform routes]
  P --> DB[(PostgreSQL)]
  P -->|verified Firebase ID token| FA[Firebase Admin]
  P --> O[Transactional outbox]
  O --> W[Managed outbox worker]
  W --> Q[(BullMQ / Redis)]
```

The existing live and economy routes remain mounted for compatibility. New domain work should migrate behind the shared v1 middleware rather than expanding legacy route-specific authentication and response patterns.

## 3. Versioned API contract

All platform routes require `Authorization: Bearer <Cognito access token>` and `X-Client-Version`. The backend also accepts an incoming `X-Correlation-Id` when it conforms to the bounded identifier contract; otherwise it generates one. Every success and error response returns the active correlation ID.

| Method and route | Purpose | Additional controls |
|---|---|---|
| `GET /api/v1/platform/capabilities` | Discover API, identity, persistence, and event-contract versions | Authenticated; global platform rate limit. |
| `GET /api/v1/platform/feature-flags` | Return privacy-safe, server-evaluated client flags | Authenticated; unknown flags are omitted/disabled. |
| `GET /api/v1/platform/identity-links` | List the caller’s linked legacy identities | Uses canonical token `sub`; no user ID parameter. |
| `POST /api/v1/platform/identity-links/firebase` | Verify and bind a Firebase identity | `Idempotency-Key`; stricter rate limit; server-side Firebase proof. |
| `DELETE /api/v1/platform/identity-links/firebase` | Revoke the caller’s verified Firebase link | `Idempotency-Key`; transactional revocation event. |

Success responses use the following stable shape:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "correlationId": "request-correlation-id"
  }
}
```

Errors use a bounded machine code and do not expose stack traces or infrastructure details:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "A safe client-facing message."
  },
  "meta": {
    "correlationId": "request-correlation-id"
  }
}
```

The mobile `platformApiClient` supplies the canonical access token, version and correlation headers, bounded timeouts, stable error parsing, and retries only for safe/idempotent reads. Mutations are not automatically retried; callers supply stable idempotency keys explicitly.

## 4. Canonical identity and legacy linking

The mobile session store is event-driven and backed by one Cognito user-pool instance. It validates token shape and expiry, exposes the canonical `sub`, refreshes after successful authentication and when the app returns to the foreground, and never falls back to Firebase as API authority. The previous two-second polling loop and three-minute sticky placeholder identity have been removed.

| Identity rule | Enforcement |
|---|---|
| Access tokens only | JWT verification requires token use `access`. |
| Bound app clients | `client_id` must match the configured allowlist. |
| Stable principal | Backend request identity is Cognito `sub`. |
| Legacy ownership | Firebase ID token is verified server-side; its verified `uid` becomes the legacy key. |
| One-to-one binding | Database constraints and locked transactional checks prevent one legacy account or one canonical account from being linked inconsistently. |
| Revocation | Link state is retained as `revoked`; an audit event is enqueued transactionally. |

The linking mutation never accepts a naked Firebase UID. If Firebase Admin credentials are unavailable, the endpoint fails closed with `LEGACY_IDENTITY_NOT_CONFIGURED`.

## 5. Mutation idempotency

Protected mutations require an `Idempotency-Key` containing 8–128 allowed characters. The ledger is scoped by canonical actor, operation and key; it hashes the method, route and request body, rejects reuse with a different payload, returns `IDEMPOTENCY_IN_PROGRESS` for concurrent duplicates, and replays completed responses with `Idempotency-Replayed: true`.

| Condition | Response behavior |
|---|---|
| Missing or malformed key | `400 IDEMPOTENCY_KEY_REQUIRED` |
| Same key, different payload | `409 IDEMPOTENCY_KEY_REUSED` |
| Same request still running | `409 IDEMPOTENCY_IN_PROGRESS` |
| Completed duplicate | Original status/body replayed |
| Unhandled 5xx or no JSON body | Reservation deleted so a later deliberate retry can proceed |

Idempotency records expire after 24 hours. A later maintenance task should purge expired records on a scheduled operational path; this is deliberately not an unmanaged timer inside the API process.

## 6. Ordered migrations

The backend now uses `platform_schema_migrations` and a PostgreSQL advisory lock to serialize schema upgrades. Startup calls the ordered runner before accepting traffic. The first migration adopts the existing economy and admin schema; the second creates the platform-spine tables and is explicitly irreversible because it contains identity links and queued events.

| Migration | Responsibility | Rollback |
|---|---|---|
| `0001_adopt_existing_schema` | Ensure/adopt the existing economy and admin schema and establish the migration baseline | Non-destructive compatibility baseline. |
| `0002_platform_spine` | Identity links, outbox, dead letters, feature flags and API idempotency | Explicitly irreversible. |

Deployment commands are run from `backend/blyp-live-service` after dependencies are installed:

```bash
npm run build
npm run migrate:status
npm run migrate
npm run migrate:status
npm run start
```

Rollback is guarded by both the migration’s own rollback support and `ALLOW_PLATFORM_MIGRATION_ROLLBACK=true`. The foundational native migration refuses rollback even when the environment guard is enabled. Database backup and restore remain the rollback mechanism after it is applied.

## 7. Transactional outbox and worker

`enqueueDomainEvent` validates a registered event name, verifies that its numeric version matches the `.vN` suffix, validates the payload schema, and writes the event through the caller’s database transaction. The worker claims rows with `FOR UPDATE SKIP LOCKED`, uses lease expiry for crash recovery, publishes with the event ID as the BullMQ job ID, applies exponential retry, and moves exhausted records into a durable dead-letter table.

| Worker contract | Default or behavior |
|---|---|
| Command | `npm run worker:start` after `npm run build` |
| Queue | `blyp-domain-events-v1` |
| Poll interval | `1000 ms`, minimum `100 ms` |
| Batch size | `50`, bounded to `1–200` |
| Claim lease | Two minutes |
| Publish attempts before dead letter | Ten |
| Shutdown | `SIGTERM`/`SIGINT`, then queue, Redis and database cleanup |

API and worker processes should be deployed as separate process roles from the same build artifact. At least one worker must be running before any downstream workstream relies on domain events. Dead-letter replay is implemented as a service function; exposing it through an audited administrator operation belongs to the Admin Operations workstream.

## 8. Feature controls

Feature definitions are durable PostgreSQL records with a global enabled state, kill switch, deterministic rollout percentage and explicit subject allow/deny lists. Evaluation occurs on the server against the canonical subject. Client projections contain only evaluated values, not rollout rules or private lists.

The mobile compatibility module preserves existing helpers while replacing environment-only authority with a deny-by-default server cache. It refreshes after canonical authentication and can notify subscribed UI. Existing viewer flags are seeded disabled, so introduction of the platform spine cannot accidentally enable a viewer mode.

## 9. Environment contract

No local `.env` file or secret is committed. The platform spine reuses the existing validated PostgreSQL and Redis settings.

| Variable | Requirement | Purpose |
|---|---|---|
| `POSTGRES_URL` | Required by existing infrastructure | Migration ledger, identity links, flags, idempotency and outbox. |
| `REDIS_URL` | Required by existing infrastructure | BullMQ event queue and existing service behavior. |
| `COGNITO_REGION` | Required in production | Expected Cognito issuer region. |
| `COGNITO_USER_POOL_ID` | Required in production | Expected issuer user pool. |
| `COGNITO_APP_CLIENT_IDS` | Preferred; comma-separated | Accepted Cognito access-token clients. |
| `COGNITO_APP_CLIENT_ID` / `COGNITO_CLIENT_ID` | Single-client compatibility aliases | Used only when the plural variable is absent. |
| `ADMIN_ALLOWLIST_SUBS` | Required to authorize administrators | Comma-separated canonical Cognito subjects. Empty means no administrators. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Required only for legacy Firebase linking | Server-side Firebase ID-token verification. |
| `EXPO_PUBLIC_API_BASE_URL` | Required in the mobile build | Base URL used by the versioned platform transport. |
| `EXPO_PUBLIC_CLIENT_VERSION` | Recommended in the mobile build | Explicit client-version header; package version is the fallback. |
| `JSON_BODY_LIMIT` | Optional; default `1mb` | Bounded JSON request body. |
| `DOMAIN_EVENT_QUEUE` | Optional | BullMQ queue override. |
| `OUTBOX_POLL_MS` | Optional; default `1000` | Worker idle polling interval. |
| `OUTBOX_BATCH_SIZE` | Optional; default `50` | Claimed outbox batch size. |
| `ALLOW_DEGRADED_STARTUP` | Non-production emergency use only | Allows startup without database readiness outside production. |
| `ALLOW_PLATFORM_MIGRATION_ROLLBACK` | Operational guard only | Permits rollback attempts for future reversible migrations. |

Production must not set `ALLOW_DEGRADED_STARTUP=true`. The API intentionally fails startup when PostgreSQL is unavailable or migration application fails.

## 10. Rollout sequence and gates

The platform spine should be deployed without moving existing product data on the same release. This separates infrastructure validation from later domain cutovers.

| Gate | Required evidence | Stop condition |
|---|---|---|
| 1. Configuration | Cognito issuer/client values, database, Redis and administrator subjects reviewed | Any placeholder or empty production authority value. |
| 2. Preflight | Build and platform contract tests pass; migration status is readable | Compiler/test failure or database cannot acquire migration lock. |
| 3. Schema | Migrations apply once and report clean status | Unexpected schema drift or migration failure. |
| 4. API canary | Capabilities and feature flags succeed with a real access token; invalid ID token is rejected | Wrong issuer/client accepted, errors expose internals, or unknown flags enable. |
| 5. Worker canary | Test event reaches BullMQ; outbox clears; no dead-letter growth | Repeated publish errors, stuck locks or queue unavailability. |
| 6. Mobile canary | Login persists, foreground refresh succeeds, sign-out clears API authority | Sticky identity, Firebase fallback authority or repeated session polling. |
| 7. Expansion | Correlation IDs visible across API logs; rate limits and idempotency verified | Untraceable failures or duplicate mutation effects. |

Database backup is required before Gate 3 because `0002_platform_spine` is intentionally irreversible. If a release must be withdrawn after migration, roll back the application binaries while retaining the additive tables; do not delete identity, outbox or idempotency records.

## 11. Validation evidence

The isolated branch passed the repository’s existing compiler and linter plus new platform contract tests.

| Validation | Result |
|---|---|
| Targeted ESLint across all changed mobile JavaScript | Passed; zero errors. |
| Full repository `tsc --noEmit` with existing backend dependencies visible | Passed. |
| Backend `npm run build` | Passed. |
| `npm run test:platform` | Passed: 4 tests, 0 failures. |
| Event registry | Valid payload/type accepted; unregistered, malformed and version-mismatched events rejected. |
| Pagination contract | Opaque cursor round-trip accepted; malformed cursors and invalid limits rejected. |

Runtime integration against production Cognito, Firebase, PostgreSQL and Redis was not attempted from the isolated development worktree. The rollout gates above are mandatory before production enablement.

## 12. Boundaries and follow-on work

WS-01 intentionally does not convert every legacy mobile service or backend route in one change. Subsequent workstreams should integrate incrementally through the new transport and canonical principal.

| Follow-on owner | Required use of WS-01 |
|---|---|
| Feed and Discovery | Versioned cursor pagination, server flags and canonical actor IDs. |
| AI Composer and Blip Bar | Shared API errors, idempotency for mutations, usage events in the registry. |
| Chat, Rooms, Live and Games | Canonical `sub`, versioned events and kill switches; no hard-coded actor IDs. |
| Dating, Team and Messenger | Verified identity, privacy flags and transactional events. |
| Economy and Monetisation | Canonical identity links before ledger ownership cutover; mutation idempotency. |
| Identity, Privacy and Safety | Expand verified attributes and lifecycle rules on the canonical identity model. |
| Admin Operations | Cognito subject allowlist, audited dead-letter/flag operations and no password-session fallback. |

Before a new event is emitted, its name, version and payload schema must be registered in `eventRegistry.ts` and covered by a compiled contract test. Before a new mutation is exposed, it must use the shared API envelope, canonical actor, bounded validation, explicit authorization and idempotency where duplicate execution could cause harm.

## 13. Primary implementation files

| Area | Files |
|---|---|
| Mobile session | `src/lib/auth/userPool.js`, `src/lib/auth/cognitoSession.js`, `src/hooks/useCommon.js`, `App.js` |
| Mobile transport | `src/services/platformApiClient.js`, `src/services/platformIdentityService.js` |
| Mobile flags | `src/config/FeatureFlags.js` |
| API contract | `src/platform/apiContract.ts`, `gatewayMiddleware.ts`, `pagination.ts`, `idempotency.ts` |
| Identity verification | `src/auth/verifyCognitoJwt.ts`, `cognitoJwtMiddleware.ts`, `src/config/firebaseAdmin.ts` |
| Routes | `src/platform/routes.ts`, backend `src/index.ts` |
| Migrations | `src/platform/migrations/*` |
| Events and worker | `src/platform/events/*`, `src/worker.ts` |
| Tests | `test/platform-contract.test.cjs` |
