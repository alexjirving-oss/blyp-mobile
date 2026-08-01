# WS-09 Server-Authoritative Economy Convergence

**Status:** Implemented on isolated branch `workstream/ws09-economy-convergence-20260801`

**Parent checkpoint:** `integration/first-batch-20260801` at `9fba41a321ad824a839929e8f92fe6fe51eb78e8`

**Scope:** remove mobile and Firestore authority over balances, ledger entries, gifts, rewards, and simulated purchases; expose the existing PostgreSQL economy through the authenticated versioned gateway; migrate supported mobile reads and gifts to that contract; and fail closed where no server-authoritative operation exists.

## 1. Outcome

WS-09 establishes the backend economy service and PostgreSQL ledger as the sole authority for wallet state. A modified client can no longer use the active coin or gem services, legacy Firestore collections, the Coin Store, or Daily Rewards to create or spend value locally.

| Decision | Authoritative implementation | Consequence |
|---|---|---|
| Wallet and balances | PostgreSQL economy wallet and ledger | Mobile reads normalized server balances; it cannot initialize or alter a wallet. |
| Catalog | Backend economy catalog | Coin and gift presentation no longer trusts hard-coded client prices or quantities. |
| Gifts | Authenticated backend gift transaction | Actor identity comes only from the verified Cognito subject; the mutation is idempotent. |
| Store purchases | Backend receipt-verification operation | No coin or gem grant occurs without platform-specific store proof. |
| Generic credits, debits, and rewards | No client operation | Unsupported legacy calls fail with `CLIENT_ECONOMY_MUTATION_DISABLED`. |
| Legacy Firestore economy data | Explicit client deny rules | Authenticated and anonymous clients cannot read or mutate server-managed economy collections. |

## 2. Canonical versioned API

The canonical router is mounted below `/api/v1/economy`. Every route inherits request context, correlation IDs, client-version enforcement, Cognito authentication, bounded rate limits, and the shared success/error envelope.

| Method and route | Purpose | Authority controls |
|---|---|---|
| `GET /api/v1/economy/catalog` | Return the server catalog | Read-only; bounded query validation |
| `GET /api/v1/economy/wallet` | Return the caller’s canonical balances | Actor derived only from `req.user.sub` |
| `GET /api/v1/economy/ledger` | Return bounded cursor-based ledger history | Actor derived only from `req.user.sub`; opaque cursor and bounded page size |
| `POST /api/v1/economy/gifts` | Send a catalog gift in a canonical stream context | Strict body, canonical actor, rate limit, and matching body/header idempotency key |
| `POST /api/v1/economy/purchases/verify` | Verify an App Store or Play Store purchase and apply the authoritative result | Platform-specific proof, strict schema, rate limit, and matching body/header idempotency key |

Unknown request fields are rejected. Mutation identity cannot be supplied by the mobile client. The existing legacy economy routes remain mounted temporarily for migration compatibility; new mobile code uses only the versioned gateway.

## 3. Mobile convergence

`src/services/economyApiService.js` is the canonical mobile transport. It uses the shared authenticated platform client and normalizes the server wallet into coin, bonus-coin, spendable-coin, available-gem, and pending-gem values. Wallet subscriptions are bounded polling over authenticated reads, not Firestore listeners.

The compatibility services preserve existing read-oriented call shapes while changing their authority:

| Surface | New behavior |
|---|---|
| `BlypCoinService.getBalance`, history, catalog, and supported gift flow | Delegates to the canonical economy API |
| Coin wallet subscription | Polls canonical wallet state with a bounded interval and error callback |
| `GemService` balance and subscription | Reads canonical wallet gem fields |
| Generic coin or gem add/spend/transfer/reward methods | Fail closed with a stable machine-readable authority error |
| Implicit starter balances | Removed |
| Client-authored transaction and ledger documents | Removed |

## 4. Product-path changes

The active product paths no longer imply authority that the backend cannot verify.

| Product path | Converged behavior |
|---|---|
| Coin Store | Loads the backend catalog and wallet; simulated local purchases and hard-coded value packages are removed. Checkout remains unavailable until a real store receipt can be supplied to the verification endpoint. |
| Gift System | Loads server catalog rows, maps them to the existing presentation model, requires a canonical stream identifier, and sends through the authenticated gift endpoint. |
| Wallet modal | Displays canonical wallet and ledger data; client-computed daily-reward eligibility and grants are removed. |
| Daily Rewards | Explicitly disabled until an abuse-resistant server reward contract exists. |

Disabling an unsupported operation is intentional containment, not feature completion. A later rewards implementation must define eligibility, streak state, rate limits, fraud controls, idempotency, ledger reasons, audit evidence, and rollback before the UI can be re-enabled.

## 5. Firestore authority boundary

Client reads and writes are explicitly denied for these legacy economy collections:

| Server-managed collection | Client policy |
|---|---|
| `wallets` | Deny read and write |
| `gems` | Deny read and write |
| `transactions` | Deny read and write |
| `ledger_entries` | Deny read and write |
| `gift_catalog` | Deny read and write |
| `gift_events` | Deny read and write |
| `iap_products` | Deny read and write |

Firebase Admin and trusted servers are not governed by client rules. Unrelated Firestore domains still use the legacy authenticated catch-all and remain a production release blocker until their collection-specific policies are delivered.

## 6. Idempotency and failure behavior

Gift and purchase-verification calls use one canonical idempotency key in both the request body and `Idempotency-Key` header. Mismatches and missing keys are rejected at the gateway. The shared transport retains bounded retry intent only for operations carrying an idempotency key.

Unsupported legacy mutations fail locally before any network or Firestore write. API failures preserve the shared bounded error contract, and wallet polling reports errors without substituting a fabricated balance.

## 7. Rollout sequence

| Gate | Required evidence | Stop condition |
|---|---|---|
| 1. Database backup | Restorable PostgreSQL backup and migration status captured | No verified restore path or schema drift |
| 2. Preflight | Backend build/contracts, root CI, typecheck, and emulator rules pass | Any compiler, contract, security, lint, test, or policy regression |
| 3. API canary | Real authenticated subject can read only its wallet and ledger | Actor spoofing, envelope drift, unsafe errors, or unbounded pagination |
| 4. Gift canary | Catalog gift posts once under replay and produces matching ledger/outbox evidence | Double debit/credit, missing stream context, or missing idempotency evidence |
| 5. Purchase sandbox | Real Apple/Google sandbox receipt verifies once and replays safely | Client-only proof, duplicate grant, provider ambiguity, or reconciliation gap |
| 6. Mobile allowlist | Canonical wallet/catalog reads enabled for allowlisted subjects | Balance mismatch, stale-state regression, or elevated API failure rate |
| 7. Controlled rollout | Expand only with reconciliation, ledger, outbox, and error dashboards healthy | Unexplained balance variance, queue lag, fraud signal, or rollback uncertainty |

Coin or gem checkout must remain disabled until the store-specific purchase adapter supplies genuine receipt proof and the sandbox gate passes.

## 8. Validation evidence

| Validation | Result |
|---|---|
| Backend lockfile installation and TypeScript build | Passed |
| Aggregate backend contracts | Passed: 8 tests, 0 failures |
| Canonical economy route and schema contracts | Route allowlist, actor boundary, strict gifts, bounded pagination, platform proof, idempotency, and unknown-field rejection covered |
| Mobile economy adapter | Passed: 4 tests, 0 failures |
| Root production integrity, secret scan, dependency ratchet, lint, and Jest | Passed: 11 suites and 37 tests |
| Root TypeScript no-emit | Passed |
| Firestore and Storage emulator suite | Passed; authenticated client access to all seven server-managed economy collections denied |
| Final targeted ESLint and Git whitespace gate | Passed |

The dependency ratchet reports no regression, but the existing release debt remains: mobile has 13 high and 5 critical findings; backend has 9 high and 3 critical findings.

Live integration against production Cognito, PostgreSQL, Redis, Apple, Google, Firebase, or payment-provider systems was not attempted from the isolated worktree. The rollout gates remain mandatory.

## 9. Integration obligations

This branch must be integrated with the WS-02 Trust foundation before cross-user economy enforcement is considered complete. The canonical gift operation must invoke the Trust `transact` decision before applying a gift and retain bounded decision evidence with the transaction or audit trail.

| Follow-on work | Required outcome |
|---|---|
| Trust/economy integration | Active block, consent, age, and privacy policy deny prohibited gifts before ledger mutation |
| Store adapters | Genuine Apple and Google receipt acquisition, verification, acknowledgement, replay protection, and reconciliation |
| Rewards | Server eligibility, streak persistence, abuse controls, ledger reason taxonomy, and idempotent grant endpoint |
| Subscriptions and entitlements | Server-owned product, entitlement, renewal, cancellation, grace-period, and quota state |
| Payouts | KYC/AML boundary, double-entry accounting, holds, disputes, reconciliation, and operator controls |
| Legacy route retirement | Usage telemetry, migration completion, explicit deprecation window, then removal of non-versioned economy routes |
| Firestore programme | Replace the unrelated authenticated catch-all with collection-specific ownership, role, field, query, and transition rules |

## 10. Primary implementation files

| File | Responsibility |
|---|---|
| `backend/blyp-live-service/src/economy/economyApiRoutes.ts` | Canonical authenticated versioned economy gateway |
| `src/services/economyApiService.js` | Mobile wallet, ledger, catalog, gift, purchase, and polling adapter |
| `src/services/economyAuthority.js` | Stable fail-closed client-mutation error contract |
| `src/services/BlypCoinService.js` | Read-compatible coin adapter with client mutations removed |
| `src/services/GemService.js` | Read-compatible gem adapter with client mutations removed |
| `firestore.rules` | Explicit client denial for server-managed economy collections |
| `scripts/test-firestore-rules.js` | Emulator assertions for the economy authority boundary |
| `backend/blyp-live-service/test/economy-api-contract.test.cjs` | Backend route and schema contracts |
| `__tests__/economyApiService.test.js` | Mobile transport, normalization, and idempotency contracts |
