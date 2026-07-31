# Wave 0 Implementation Baseline

**Recorded:** 31 July 2026
**Purpose:** Protect the active Blyp working tree while the first implementation batch is developed and validated in isolation.

## Protected active repository

| Field | Value |
|---|---|
| Path | `C:\Users\Alex\Blyp26` |
| Branch | `release/render-update-gate-2026304682-v2` |
| Baseline commit | `8bc0dcb2a1da1b21368c5536aaeef829d587f316` |
| Tracked unstaged change | `backend/blyp-live-service/src/economy/infra.ts` |
| Staged changes | None |
| Untracked files observed | 789 |
| Repository instructions | No `AGENTS.md` was found at the project root |

The tracked `economy/infra.ts` change is the user's in-progress PostgreSQL TLS work. It must not be overwritten, staged, reverted, reformatted, or merged accidentally. The untracked files include diagnostics, forensic artefacts, generated output, and local configuration; they must not be swept into an implementation commit.

## Isolated Wave 0 worktree

| Field | Value |
|---|---|
| Path | `C:\Users\Alex\Blyp26_ws00_wave0` |
| Branch | `workstream/ws00-wave0-containment-20260731` |
| Starting commit | `8bc0dcb2a1da1b21368c5536aaeef829d587f316` |
| Initial status | Clean |

## Guardrails

1. All Wave 0 edits occur only in the isolated worktree.
2. No command may reset, clean, stash, stage, or commit the protected active repository.
3. Each change must be scoped to a named Wave 0 task and validated before staging.
4. Generated files, screenshots, secrets, keystores, local environment files, diagnostics, and forensic artefacts must not enter commits.
5. Shared bootstrap and navigation changes require explicit integration review.
6. Production code must not manufacture users, followers, activity, comments, engagement counts, money, purchase success, or third-party publication success.
7. Consequential state must be server-authoritative; prototype-only controls must be removed from production routes or disabled by deny-by-default configuration.
8. This branch must not be merged into the active release branch until the user reviews the handoff and all regression checks pass.

## Planned Wave 0 scope

The first implementation batch addresses the production-integrity hazards identified in the source audit: fake follower and currency boosters, generated AI comments, invented actor identities, synthetic search/discovery data in production paths, misleading cross-post controls, and the insecure admin login entry point. Shared platform contracts and automated integrity checks will then be added as a separate, reviewable foundation.
