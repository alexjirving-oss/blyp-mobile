# Protected Files and Assets

## Purpose
Define high-risk assets that must not be changed casually because they control execution integrity, release safety, and regression traceability.

## Protected Categories

## Diagnostics and Evidence Packets
- Examples: `diagnostics/**`
- Why protected: these are immutable evidence trails and audit references.
- Policy: append-only evidence generation is allowed by procedure; editing historical packets is not.

## Golden Code and Baselines
- Examples: `diagnostics/golden_code/**`, `golden_code/**`
- Why protected: these are known anchors for recovery, comparison, and validation.
- Policy: do not overwrite, mutate, or repurpose baseline artifacts.

## Rails, Megarails, Autopilot, and Execution Procedures
- Examples: `diagnostics/megarail/**`, `tools/autopilot/**`, execution rail scripts/procedures.
- Why protected: they encode repeatable verification and release-critical behavior.
- Policy: no edits without explicit approval or tightly scoped operational necessity.

## Release, Build, and Signing Scripts
- Examples: release wrappers, AAB/APK build scripts, signing/config handling.
- Why protected: changes can silently break release integrity or deployability.
- Policy: require written justification and post-change proof.

## Install and Verify Tooling
- Examples: install scripts, verification scripts, artifact checks.
- Why protected: these establish whether outputs are trustworthy.
- Policy: preserve behavior unless change is approved and validated.

## Baseline Recovery Tools
- Examples: scripts used to restore known-good operational state.
- Why protected: they are last-resort controls during incidents.
- Policy: no change without explicit approval and recovery proof.

## Edit Policy for Protected Assets
1. Default: do not edit.
2. Exception path: explicit approval or tightly scoped necessity.
3. Preconditions: state reason, blast radius, rollback path.
4. Postconditions: provide concrete evidence that behavior is preserved or improved.
5. Documentation: log all approved protected-asset edits in `docs/ops/CHANGELOG_AGENT.md`.

## Approval Rule (Explicit)
Diagnostics, rails, megarail, autopilot, release/build/signing, install/verify, baseline recovery tools, and golden code are protected operational assets.
1. They must not be casually edited to chase app symptoms.
2. Edits require explicit approval or tightly scoped necessity.
3. Any approved edit must include before/after evidence.

## Practical Rule
If a file can affect rails, builds, release validity, diagnostics trust, or baseline comparability, treat it as protected.
