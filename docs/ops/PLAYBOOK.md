# Blyp Anti-Regression Playbook

## Purpose
This playbook defines the operating rules that prevent regression, drift, and process damage in the Blyp repo. It is a repo-controlled memory layer so execution does not depend on chat continuity.

## Scope
This document governs engineering and operational work across app code and operational infrastructure.

## Operating Principles
1. Source of truth is in-repo evidence, not memory from prior chats.
2. Confidence must be evidence-backed.
3. Changes must be narrow, intentional, and reversible.
4. Protected operational assets are high-risk and must be treated as controlled infrastructure.
5. Current verified state overrides stale assumptions.

## Anti-Regression Rules
1. Proof-before-claim: do not claim fixed, passing, or safe without concrete evidence.
2. Narrow-change rule: touch the minimum required files and lines.
3. No broad regex or blind global edit: prohibited unless explicitly approved and reviewed.
4. Preserve baselines: do not mutate golden baselines or diagnostics artifacts.
5. Preserve procedures: do not casually alter rails, release flows, build/signing scripts, or execution procedures.

## Protected-Assets Rule
Protected assets are listed in `docs/ops/PROTECTED_FILES.md`. Any proposed change to protected assets requires:
1. Explicit approval or tightly scoped necessity.
2. Written justification before change.
3. Evidence after change proving no collateral regression.

## App Code vs Operational Infrastructure
- App code: product logic/UI/features under normal development paths.
- Operational infrastructure: rails, diagnostics packets, golden code, release/build/signing scripts, install/verify tooling, baseline recovery tooling.
- Infrastructure changes carry higher blast radius and require stronger controls.

## Mandatory Pre-Work Read Order
1. `docs/ops/HANDOVER_BLYP.md`
2. `docs/ops/PLAYBOOK.md`
3. `docs/ops/PROTECTED_FILES.md`
4. `docs/ops/CURRENT_STATE.md`
5. `docs/ops/ACTIVE_PROBLEMS.md`
6. `docs/ops/GOLDEN_BASELINES.md`
7. `docs/ops/VERIFICATION_MATRIX.md`
8. `docs/ops/PROOF_PATHS.md`
9. `docs/ops/CHANGELOG_AGENT.md` (latest entries)

## Proof-Layer Gate Before Meaningful Fix Work
1. Judge active issues against `docs/ops/VERIFICATION_MATRIX.md` before planning or applying a fix.
2. Check proof-route strength in `docs/ops/PROOF_PATHS.md` before meaningful fix work.
3. If proof path status is `Missing` or `Contradictory`, treat certainty as unproven and record the gap.

## Stop Conditions
Pause work before any code edits when any of the following is true:
1. Repo truth is unclear or contradictory.
2. Issue evidence is missing or not reproducible.
3. Protected assets appear implicated.
4. Requested change is broad, cross-cutting, or poorly scoped.
5. Claimed fix cannot be proven with concrete evidence.

## Proof Standard
Use these labels explicitly in planning and reporting:
1. Historical anchor: past evidence proving what was true at that time.
2. Current verified truth: present-state claim supported by fresh, reproducible evidence.
3. Suspected but unproven: plausible hypothesis without proof.
4. User-reported but not yet reproduced: externally reported behavior not yet reproduced by operator.

## Required Reporting Format After Work
Use this structure in every completion report:
1. Scope: what was changed and why.
2. Files changed: exact file list.
3. Evidence: commands/logs/artifacts proving outcome.
4. Risk check: regression risks introduced or avoided.
5. Unknowns: explicit "Needs verification" items.
6. Protected assets: confirm touched or untouched.

## Forbidden Behaviors
1. Claiming success without proof.
2. Broad, speculative edits across unrelated files.
3. Editing protected assets without approval/necessity/evidence.
4. Reopening closed/deprioritized work without clear reason.
5. Treating assumptions as facts.
6. Hiding uncertainty instead of marking "Needs verification".

## Enforcement Note
If urgency conflicts with process, process still applies. Speed without control causes regression.
