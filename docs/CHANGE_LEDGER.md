# Change Ledger (#1-#19)

Status values: TODO | DONE | BLOCKED | PARKED

| Item | Status | Packet | Notes | Evidence |
|---:|---|---|---|---|
| #1 | DONE | P1 | Persist Cognito auth session across hard close (force hydrate sync storage mirror on startup; add one-shot restore logs; add Jest mock for expo-video-thumbnails to allow tests). | See `docs/RELEASE_CHECKPOINT_REPORT.md` (Checkpoint 1) |
| #2 | TODO |  |  |  |
| #3 | TODO |  |  |  |
| #4 | TODO |  |  |  |
| #5 | TODO |  |  |  |
| #6 | TODO |  |  |  |
| #7 | TODO |  |  |  |
| #8 | TODO | P2 |  |  |
| #9 | TODO | P2 |  |  |
| #10 | TODO | P2 |  |  |
| #11 | TODO |  |  |  |
| #12 | TODO | P4 |  |  |
| #13 | TODO |  |  |  |
| #14 | TODO |  |  |  |
| #15 | TODO | P2 |  |  |
| #16 | TODO | P2 |  |  |
| #17 | TODO | P2 |  |  |
| #18 | TODO | P2 |  |  |
| #19 | TODO | P3 |  |  |

## Phase A discovery evidence (2026-01-21)

- Env inventories + presence matrix (no values):
	- [docs/_env_keys_used_in_code.txt](_env_keys_used_in_code.txt)
	- [docs/_vite_keys_used_in_code.txt](_vite_keys_used_in_code.txt)
	- [docs/_env_key_presence.csv](_env_key_presence.csv)
- Entry-point hit inventories (broad grep lists):
	- [docs/_hits_auth.txt](_hits_auth.txt)
	- [docs/_hits_live.txt](_hits_live.txt)
	- [docs/_hits_comments.txt](_hits_comments.txt)
	- [docs/_hits_gifting.txt](_hits_gifting.txt)
	- [docs/_hits_ai.txt](_hits_ai.txt)

## Current blockers/risks (discovery)

- Comments resolver requires a Functions-like base URL; IVS/live-service mode can break comments unless a Functions base URL is provided.
	- Evidence: [docs/MISSING_INPUTS.md](MISSING_INPUTS.md#comments)
- Live-service backend requires Cognito + IVS Real-Time env vars.
	- Evidence: [docs/MISSING_INPUTS.md](MISSING_INPUTS.md#live-service-required-env-backendblyp-live-service)
- Economy backend requires Postgres + Redis env vars.
	- Evidence: [docs/MISSING_INPUTS.md](MISSING_INPUTS.md#backend-env-economy)

## Parking Plan

- PARKED items should be grouped into future packets with a short rationale and pointers to files/lines.
