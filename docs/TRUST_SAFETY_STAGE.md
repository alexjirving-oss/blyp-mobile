# Trust & Safety stage (tip)

Shipped on `feat/full-tip-package-20260809` as a usable gate + report/block + chat NLP + mod kill + audit trail. Vision provider remains optional.

## Live now

| Capability | How |
|---|---|
| **A. SafetyGate** | `SafetyGateModal` + `SafetyGateService` — versioned ToS + Community Guidelines (`SAFETY_POLICY_BUNDLE_VERSION`) + age. Blocks Create / Review publish / Go Live until accepted. |
| **B. Age assurance** | Birth year → `birthYear`, `ageAssuredAt`, `ageBand`. Under 18 cannot upload or broadcast. |
| **C. Report** | Profile overflow + live header **flag** button → `reports` + `safetyAuditLogs` (`report_create`). |
| **D. Block** | `users/{uid}/blocks/{target}` (rules fixed) + audit; DMs/messenger already filter blocks. |
| **E. Live chat NLP** | `LiveChatNlp` + `contentFilter` — drop toxic/hate before send; `chat_flag` audit. |
| **F. Mod kill** | Admin Live → Force end; optional **ban host**. `POST /admin/live/:sessionId/force-end` with `{ banHost }`. Audited in `admin_audit_log`. |
| **G. Audit logs** | Append-only Firestore `safetyAuditLogs` (create only; no update/delete). Actions: `terms_accept`, `age_declare`, `report_create`, `block_user`, `chat_flag`, `live_scan_flag`. |

## Vision / audio scanners (residual)

| Piece | Status |
|---|---|
| `LiveSafetyScanner` interface + `useLiveSafetyScanner` periodic hook | **Wired** on host live |
| Without provider keys | Returns `pending_review` + `providerNeeded: true` — does **not** pretend a real scan |
| With keys | Set `EXPO_PUBLIC_LIVE_SAFETY_PROVIDER` to `aws_rekognition` \| `google_vision` \| `hive` and implement `/internal/live-safety/scan` on live-service with secrets |
| Auto kill | Only when provider returns `high_severity` with `canAutoKill` and `providerNeeded=false` |

## How to test

1. **Terms / age** — Clear app data or use a fresh account. Tap **+** → Photo/Go Live → SafetyGate sheet. Accept both checkboxes, enter birth year ≥ 18 years ago → Continue. Under-18 year should lock.
2. **Report** — Open another user’s profile → ⋯ → Report. On a live as viewer → red **flag** in header → pick reason.
3. **Block** — Profile → Block; confirm thread disappears from Messenger; unblock from profile.
4. **Chat NLP** — In live chat send a blocked slur / `kys` → message dropped + toast.
5. **Kill** — Admin console Live → Force end → optional ban host. Confirm stream ends and audit row appears.

## Files (primary)

- `src/services/safety/*`, `src/components/safety/SafetyGateModal.js`
- `src/hooks/useLiveSafetyScanner.js`
- `src/components/CreatePostButton.js`, `src/screens/ReviewScreen.js`
- Thin overlays: `LiveStreamScreen.js`, `LiveViewerHeader.js`
- `firestore.rules` — `blocks`, `safetyAuditLogs`, `moderationFlags`
- `backend/.../adminRoutes.ts` force-end + ban
- `docs/TRUST_SAFETY_STAGE.md` (this file)

## Deploy note

Deploy Firestore rules for blocks + audit writes to succeed in production. Live-service deploy needed for force-end `banHost` field.
