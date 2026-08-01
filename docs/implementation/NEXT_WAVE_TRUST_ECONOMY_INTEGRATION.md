# Next-Wave Trust–Economy Integration

## Scope

This integration joins the validated Trust foundation (`b752b2e02d0d80cb524076a802f2f37a3f014357`) and economy convergence (`14e75cb60a42517e930e1686ee01313004e1880a`) through merge commit `0920ee32d03d92ae60a70d137cd9468ca70005be`. It preserves both immutable workstream histories and adds the cross-domain enforcement required before a new gift can transfer value.

The implementation remains isolated on `integration/next-wave-foundations-20260801`. It does not merge, reset, or modify the protected checkout.

## Authoritative Contract

Every new gift now invokes the shared Trust policy with capability `transact` inside the same PostgreSQL transaction that owns gift idempotency, wallets, ledger entries, gift events, and stream sequencing. A denied or unavailable Trust decision fails closed with `TRUST_POLICY_DENIED` before any wallet, ledger, gift-event, stream-counter, or realtime side effect can occur.

An exact idempotency replay returns its original committed result without reauthorising or creating a second side effect. This preserves the established economy idempotency contract while ensuring that every newly created value transfer is authorised against current Trust state.

The transaction-scoped Trust evaluator acquires deterministic advisory locks for both users' consent/privacy authorities and both directions of block and mute state. It then evaluates consent, privacy, age-band requirements when supplied, blocks, mutes, and target consent through the canonical policy primitives. Consent withdrawal or relationship changes therefore cannot race a new gift decision between policy evaluation and value transfer.

Ledger metadata records the Trust capability, actor policy-profile version, and target privacy version used for the successful decision. This provides versioned audit evidence without persisting unnecessary profile content in economy records.

## Validation

The integrated backend aggregate gate compiles successfully and passes all **20** platform, Trust, economy, and cross-domain contract tests. The cross-domain suite proves that the transaction-scoped assertion is exported, gift replay detection precedes Trust evaluation, Trust evaluation precedes wallet mutation, all consent and relationship lock keys are acquired, and denial remains fail closed.

The root TypeScript gate passes. The complete repository CI gate passes production-integrity inspection, secret scanning, dependency-ratchet enforcement, lint, and **12 Jest suites / 41 tests**. The pinned Firestore and Storage emulator suite passes with zero failed assertions, including authenticated denial of every server-managed economy collection.

## Rollout and Stop Rules

The Trust rollout flag remains disabled by default. Production enablement requires the ordered PostgreSQL migrations, configured authentication and database infrastructure, real identity and idempotency canaries, audit-event verification, and a tested rollback path.

No client may reintroduce direct wallet, gem, ledger, gift, purchase, or reward authority. No domain may bypass the shared Trust decision contract for interaction or transaction capabilities. Any inability to obtain required Trust state is a denial, not a permissive fallback.

## Remaining Release Debt

This integration does not waive the repository's dependency baseline. The validated ratchet still reports mobile findings of **7 low, 39 moderate, 13 high, and 5 critical**, and backend findings of **1 low, 33 moderate, 9 high, and 3 critical**. Critical and high production advisories remain release blockers.

Unrelated Firestore domains still depend on the legacy authenticated catch-all. Collection-specific ownership, role, field, query, and state-transition policies remain mandatory before production release.
