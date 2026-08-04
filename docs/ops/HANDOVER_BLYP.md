# Blyp Handover for New Agents

## What Blyp Is
Blyp is a premium creator-focused social video platform with short-form feed, creator profiles, likes/comments, live streaming, guest participation flows, creator monetization, coin/gem economy, promotion systems, and broader premium ecosystem ambitions.

## What This Repo Contains
1. React Native / Expo mobile application work.
2. Android-focused testing, diagnostics, and release flows.
3. Backend/service integrations and live-service infrastructure.
4. Firestore-related runtime flows.
5. Release/build/signing/config handling.
6. Automation rails, diagnostics packets, and golden code baselines.

## Why the Anti-Regression Playbook Exists
This repo has a known process instability pattern: regressions caused by broad fixes, context loss between chats, protected procedures changed too casually, and confidence language without proof. `docs/ops` exists to enforce controlled execution and evidence-backed reporting.

## Operational Failures This Layer Prevents
1. Drift between actual repo state and assumed state.
2. Damage to protected rails/release/build/diagnostic infrastructure.
3. Reopening issues without evidence-driven triage.
4. Declaring success without reproducible proof.

## Read First (Required Order)
1. `docs/ops/HANDOVER_BLYP.md`
2. `docs/ops/PLAYBOOK.md`
3. `docs/ops/PROTECTED_FILES.md`
4. `docs/ops/CURRENT_STATE.md`
5. `docs/ops/ACTIVE_PROBLEMS.md`
6. `docs/ops/GOLDEN_BASELINES.md`
7. `docs/ops/VERIFICATION_MATRIX.md`
8. `docs/ops/PROOF_PATHS.md`
9. `docs/ops/CHANGELOG_AGENT.md`

## First 5 Minutes In This Repo
1. Read the required order above without skipping.
2. Identify whether requested work touches protected assets in `docs/ops/PROTECTED_FILES.md`.
3. Classify each claim as historical anchor, current verified truth, suspected but unproven, or user-reported not yet reproduced.
4. Do not jump from issue report straight to code patching.
5. Check `docs/ops/ACTIVE_PROBLEMS.md`, then `docs/ops/VERIFICATION_MATRIX.md`, then `docs/ops/PROOF_PATHS.md` before proposing changes.
6. Decide whether a usable proof path exists or whether verification infrastructure is missing.
7. If evidence is missing or scope is broad, stop and narrow scope before any code edit.

## How to Behave in This Repo
1. Make narrow, intentional changes only.
2. Protect operational infrastructure and baselines.
3. Report evidence for every claim.
4. Mark uncertainty as `Needs verification`.
5. Prefer new timestamped evidence over mutating historical artifacts.

## What Not to Touch Casually
1. `diagnostics/**` evidence packets.
2. Golden baselines under `diagnostics/golden_code/**` and related anchors.
3. Rails/megarail/autopilot/execution procedure scripts.
4. Release/build/signing/install/verify scripts.
5. Baseline recovery tooling.

## Known Baseline Anchors
1. Live system audit packet: `diagnostics/live_audit/LIVE_SYSTEM_AUDIT_20260223_004958`.
2. Firestore proof baseline: `diagnostics/event_notification_runtime/EVENT_NOTIFICATION_RUNTIME_V5_FIRESTORE_20260223_040302` (`20_firestore_proof.txt`).
3. Live execution trace baseline + golden copy:
   - `diagnostics/live_execution_trace_baseline/`
   - `diagnostics/golden_code/LIVE_EXEC_TRACE_BASELINE_20260223_052925`
4. Go-live backend loopback fix baseline: `diagnostics/go_live_backend/GO_LIVE_BACKEND_20260223_091311`.
5. Deployment rail baseline: `diagnostics/golden_code/RAIL_V1_GOLDEN_20260301_194049`.
6. Two-device autopilot reference with host disconnect failure:
   - `RUN_LIVE_AUTOPILOT_REALPASS_20260304_181448`
   - linked `LIVE_E2E_AUTOPILOT_20260304_181453`
7. User-run command reference:
   - `powershell -NoProfile -ExecutionPolicy Bypass -File "diagnostics\megarail\MEGA_RAIL_V2_AUTOMATION_LOCKED.ps1" 2>&1 | Out-String`

## Known Current Issue Examples
1. Like system still not working properly. Current status: Active.
2. For Me page comments showing grey avatar instead of user profile picture. Current status: Active.
3. Profile page video display still too zoomed in. Current status: Active.
4. Repeated errors/regressions caused by attempted fixes. Current status: Active.

## Tone and Claim Rule
Never speak with confidence unless proof exists. Use explicit evidence references. If proof is missing, state `Needs verification`.
