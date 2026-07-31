# WS-02 Delivery Guardrails

**Branch:** `workstream/ws02-delivery-guardrails-20260731`

**Parent checkpoint:** `90de0495ff236a8c575ffd9b4beafc5f658403b3` (`feat(platform): establish canonical identity and delivery spine`)

**Date completed:** 2026-08-01

## Purpose

WS-02 converts the repository's previously partial validation into enforceable production-integrity, security, mobile, backend, and Firebase rules gates. It is deliberately isolated from the active checkout and builds on the committed Wave 0 containment and WS-01 platform spine.

## Implemented controls

| Control | Enforced behaviour |
|---|---|
| Production-integrity gate | Blocks reintroduction of follower/coin boosters, generated comments, synthetic feed/search fallbacks, plaintext administrator login, unverified canonical identity, unsafe non-idempotent retries, fail-open server flags, production auth bypasses, and unsupported third-party delivery claims. |
| Secret scanner | Scans tracked source with high-confidence credential patterns, redacts findings, writes machine-readable evidence, and exits non-zero on a finding. |
| Dependency audit ratchet | Runs production-only `npm audit` for mobile and backend lockfiles and fails on audit errors or any severity-count increase above the committed baseline. |
| Complete mobile lint | Runs ESLint across the complete `src` tree rather than a partial file list. |
| Deterministic mobile tests | Repairs cross-platform Jest discovery and optional native-module mocks; the CI suite runs serially with no hidden archived-tree discovery. |
| Backend contracts | Builds the TypeScript service and runs the compiled WS-01 event and pagination contract suite. |
| Cross-project typecheck | Installs both dependency trees and validates the root TypeScript project, including backend contracts. |
| Firebase policy tests | Uses strict Firestore and Storage emulator assertions that terminate CI on mismatch; Firebase Tools is pinned to `14.18.0`. |
| Workflow hardening | Uses read-only repository permissions, cancellation of superseded runs, bounded job timeouts, pinned major action versions, reproducible `npm ci`, and diagnostic artifacts on failures. |

## Repository-native commands

```text
npm run check:production-integrity
npm run scan:secrets
npm run audit:dependencies
npm run lint
npm run test:ci
npm run verify:ci

npm --prefix backend/blyp-live-service run build
npm --prefix backend/blyp-live-service run test:platform
npm run typecheck

firebase emulators:exec --non-interactive --only firestore,storage "npm run test:rules"
```

`verify:ci` covers the root integrity, secret, dependency, lint, and mobile-test gates. Backend build/contracts, cross-project typechecking, and emulator rules tests remain separate jobs so failures are attributable and can run in parallel.

## Validation evidence

| Validation | Result |
|---|---|
| Production-integrity invariants | Passed, with explicit legacy-policy warnings only |
| High-confidence secret scan | Passed with zero findings |
| Dependency audit ratchet | Passed; no severity count increased |
| Complete mobile lint | Passed with zero errors |
| Mobile Jest suite | **10 suites, 33 tests passed** |
| Backend TypeScript build | Passed |
| Backend platform contracts | **4 tests passed** |
| Cross-project TypeScript no-emit check | Passed |
| Firestore emulator assertions | Passed |
| Storage emulator assertions | Passed |

## Explicit release debt

The guardrails make existing debt visible and prevent it from becoming worse; they do **not** certify the repository as release-ready.

| Release blocker | Current measured baseline | Required closure |
|---|---:|---|
| Mobile production dependencies | 7 low, 39 moderate, 13 high, **5 critical** | Remediate critical and high advisories, rerun the audit, and lower the reviewed ratchet baseline. Do not raise the baseline. |
| Backend production dependencies | 1 low, 33 moderate, 9 high, **3 critical** | Remediate critical and high advisories, rerun the audit, and lower the reviewed ratchet baseline. Do not raise the baseline. |
| Firestore authorization | Legacy authenticated catch-all policy | Replace with collection-specific ownership, role, field, query, and state-transition rules plus emulator tests before production deployment. |
| Firebase/Cognito authority overlap | Canonical Cognito API identity exists, but legacy Firebase data paths remain | Complete verified identity linking and migrate every authoritative mutation behind the platform API before disabling legacy paths. |

The dependency baseline is stored at `config/dependency-audit-baseline.json`. Any legitimate reduction should update that file in the same reviewed change. A severity increase must fail rather than be accepted by changing the baseline.

## Protected active checkout

The active repository at `C:\Users\Alex\Blyp26` remains on commit `8bc0dcb2a1da1b21368c5536aaeef829d587f316`. Its pre-existing tracked edit to `backend/blyp-live-service/src/economy/infra.ts` is unchanged. WS-02 changes exist only in the isolated worktree and branch.

## Integration order

Review and integrate in this order:

1. `8ded663b78f8caf16d8f9d7a312be01b95f2e62a` — baseline guardrails.
2. `6ecb8b88bb098aa9b3f6a5cf414e3e182e29c6f4` — Wave 0 containment.
3. `90de0495ff236a8c575ffd9b4beafc5f658403b3` — WS-01 platform spine.
4. WS-02 delivery-guardrail commit created from this worktree.

Do not merge these commits into the active checkout until its TLS work and unrelated untracked files have been backed up or committed by their owner.
