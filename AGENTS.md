# Blyp accountability protocol

The repository uses two deliberately separate enforcement layers:

1. `.cursor/hooks.json` contains fail-closed, single-session Cursor guardrails.
2. `tools/accountability/` is the durable multi-agent controller and signed authority.

IDE agents are workers, not judges. They may report that work is ready for verification, but
they may not certify their own changes. Only deterministic verification plus independent
reviewers can produce an `ACCEPTED` controller result.

## Commands

```powershell
npm run accountability:acceptance
npm run accountability:verify-session
npm run accountability:smoke
npm run accountability:validate -- tools/accountability/contracts/example.task.json
npm run accountability -- tools/accountability/contracts/example.task.json --repo .
```

Generate signing keys with `npm run accountability:keygen`. Keep the private key outside the
repository. Verify a signed run ledger with `npm run accountability:verify-ledger -- <path>`.

## Stop behavior

The Cursor stop hook builds the controller, runs a fresh session verification, writes a strict
receipt under `.accountability/sessions/`, and validates that receipt in a second process.

Missing, malformed, stale, mismatched, timed-out, crashed, or non-passing verification blocks
clean completion. There is no advisory retry limit that eventually converts failure into pass.

The controller records every SDK agent ID, run ID, role, result, and candidate in its signed
ledger. Local session receipts are integrity evidence, not cryptographic authority; signed
controller ledgers remain the cross-session source of truth.

## Multi-agent runs

Each task contract requires independent analyst, builder, and reviewer roles. Builders use
isolated worktrees. Reviewers are read-only. The controller freezes candidate commits, runs
deterministic gates, and signs a hash-chained ledger.

Local controllers acquire an atomic task lease. GitHub Actions also serializes runs by task
contract. A lease conflict is `BLOCKED`, never accepted.

The controller never merges, pushes, publishes, submits, deploys, or silently chooses between
multiple passing candidates unless the reviewed contract explicitly selects the smallest diff.

## Control-plane maintenance

Swarm candidates cannot modify `.cursor/**`, `.accountability/**`, `tools/accountability/**`,
or accountability workflows; the controller enforces this independently of agent claims.

IDE hooks run under the same operating-system identity as the IDE agent and therefore cannot
make their own source tamper-proof. Hook maintenance requires explicit user authorization,
temporary registry disablement, a Cursor restart, full accountability acceptance, and restoring
`.cursor/hooks.json` as the final write.
