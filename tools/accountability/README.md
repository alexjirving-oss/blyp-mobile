# Blyp accountability controller

This controller runs a multi-agent coding workflow outside an IDE chat. Its authority model is deliberately asymmetric:

- analysts and reviewers are read-only;
- builders may change only contract-authorized paths;
- agents may not commit, push, merge, publish, or deploy;
- the controller alone freezes candidate commits;
- no agent may certify its own candidate;
- every authoritative event is Ed25519-signed and hash-chained;
- every result is bound to one task-contract hash, base commit, and candidate commit.

The controller produces candidate patches and evidence. It does **not** merge, deploy, or silently choose between multiple passing implementations.

## Workflow

1. Required analysts inspect the same base commit concurrently.
2. At least two builders work concurrently in separate disposable Git worktrees.
3. The controller rejects out-of-scope changes and freezes admissible files into controller-authored candidate commits.
4. Deterministic commands and independent reviewers evaluate each frozen commit.
5. Demonstrated defects may enter a bounded repair loop. Infrastructure uncertainty becomes `BLOCKED`, not a repair instruction.
6. One passing candidate can become `ACCEPTED`. Multiple passing candidates default to `NEEDS_DECISION`.

There is no majority vote. Every mandatory verifier and reviewer must pass.
Each task also acquires an atomic local lease. A second controller for the same task receives
`BLOCKED`; CI separately serializes workflow runs by task-contract path.

## Requirements

- Node.js 22.13 or newer
- Git
- a Cursor API key in `CURSOR_API_KEY`
- an Ed25519 private signing key in `ACCOUNTABILITY_SIGNING_PRIVATE_KEY`

Install the isolated controller dependencies:

```powershell
npm ci --prefix tools/accountability
```

Generate an Ed25519 keypair once. Put the private value in a protected secret store; distribute the public value to evidence verifiers:

```powershell
npm --prefix tools/accountability run --silent start -- keygen
```

The JSON output contains `privateKey`, `publicKey`, and the public `keyId`.
Never commit the private key. The CLI removes controller secrets from the process environment before starting worker agents.

## Create and validate a contract

Copy `contracts/example.task.json` and replace its objective, acceptance criteria, scope, verification commands, and roles.

```powershell
npm --prefix tools/accountability run start -- validate path\to\task.json
```

Contracts reject unknown fields rather than silently ignoring them. Verification uses allowlisted `npm` or `node` runners with argument arrays—never shell command strings—and cannot request push, merge, publish, submit, or deploy actions.
Task contracts and agent evidence are retained, so contracts must never contain credentials or personal secrets.
The contract is privileged control-plane input: review it like CI configuration. Keep package scripts, lockfiles, test configuration, and verifier-owned fixtures in `forbiddenPaths` unless a separately reviewed maintenance task genuinely needs to change them.

## Run the swarm

```powershell
$env:CURSOR_API_KEY = "<secret>"
$env:ACCOUNTABILITY_SIGNING_PRIVATE_KEY = "base64:<PKCS8-private-key>"
npm --prefix tools/accountability run start -- run path\to\task.json --repo .
```

The local process can run unattended from a terminal, service, self-hosted runner, or CI job. Cursor chat does not need to remain open.

## Results

Run evidence is written under `.accountability/runs/<run-id>/` by default:

- `contract.json` — canonical authoritative task contract
- `ledger.ndjson` — signed append-only event chain
- `agents/` — role, agent ID, run ID, model, token usage, status, and final output
- `candidates/<id>/candidate.patch` — portable candidate diff
- `candidates/<id>/commands/` — exact stdout and stderr receipts
- `candidates/<id>/reviewers/` — structured independent review decisions
- `summary.json` — terminal classification and selected candidate, if any

Candidate Git objects are retained under `refs/accountability/<run-id>/<candidate-id>` in the source repository.

Cursor session verification emits strict `blyp.verification-receipt` v1 documents under
`.accountability/sessions/<session-id>/<receipt-id>/`. Receipt validation rejects unknown
fields, stale Git/session bindings, changed file content, missing or altered command artifacts,
payload-hash mismatches, timeouts, crashes, and contradictory outcomes.

Exit codes:

- `0` — `ACCEPTED`
- `2` — `REJECTED`
- `3` — `NEEDS_DECISION`
- `4` — `BLOCKED` or controller/preflight failure

Verify a ledger independently:

```powershell
$env:ACCOUNTABILITY_SIGNING_PUBLIC_KEY = "base64:<SPKI-public-key>"
npm --prefix tools/accountability run start -- verify-ledger .accountability\runs\<run-id>\ledger.ndjson
```

## Meaning of terminal states

- `ACCEPTED`: every mandatory deterministic check and independent review passed for the selected commit.
- `REJECTED`: evidence demonstrated defects and the bounded repair budget was exhausted.
- `BLOCKED`: evidence is incomplete or indeterminate—for example an agent, verifier, model lookup, cleanup, or receipt operation failed.
- `NEEDS_DECISION`: multiple candidates passed and the contract requires a human choice.

`BLOCKED` is not treated as a code failure and never becomes acceptance.

## Trust boundary

Hash chaining detects modification. Ed25519 signatures let reviewers verify receipts using only the public key, without receiving the private key needed to rewrite history. Keep the private key outside the repository and inaccessible to workers.

Local Cursor SDK sandboxing is useful containment, but it is not equivalent to a separate operating-system identity. Run this controller on an ephemeral CI runner, container, VM, or restricted service account when workers must be isolated from host credentials.

The IDE stop hook is intentionally a separate layer. It produces unsigned local-session
receipts and fails closed, while controller run ledgers are Ed25519-signed. Local receipts prove
what the configured verifier observed; only signed ledgers provide cross-session authority.

The latest Cursor SDK is pinned by `package-lock.json`. As of 2026-08-02, its `@connectrpc/connect-node` dependency still brings `undici@5.29.0`, which npm reports with an unresolved high-severity advisory. The controller therefore should remain on ephemeral, time-bounded runners and should not be exposed as a network service until the upstream dependency is updated.
