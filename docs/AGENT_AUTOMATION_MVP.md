# Automated agent management (web / Cloud Run)

Boss + Mel oversight on **https://admin.blyp.world/agents**. Default mode **`suggest_only`** with human approve → execute for comments. Auto-**post** stays hard-disabled.

## What’s live vs still suggest-only

| Capability | Status |
|------------|--------|
| Propose comments (followed creators’ recent posts) | **Live** — `agentProposalWorker` cron |
| Boss/Mel approve → write comment to Firestore | **Live** — approve path + `agent-execute` retry cron |
| Per-user settings / phrase bank / force pause | **Live** — `/agents/:userId` |
| Directory + pending queue + executed log + activity | **Live** — `/agents` |
| Mel (`admin` role) mutate agents | **Live** — `agents.oversight` (no `economy.credit`) |
| `auto_with_limits` comment auto-send | **Live but gated** — only when global `forceSuggestOnly=false`, daily cap + ≤3/hour |
| Auto-post / create posts | **Hard-off** |
| Gifts / wallet / coin actions | **Never** |
| Creator self-serve (non-admin) / mobile toggles | **Not shipped** |
| Assigned-staff scoping (Mel only sees “their” users) | **Not shipped** — Mel sees full ops directory |

Default global config: **`forceSuggestOnly=true`** until Boss/Mel clicks **Allow auto_with_limits**.

## Shipped

| Piece | Location |
|-------|----------|
| Schema | `user_agent_settings`, `user_agent_phrases`, `agent_action_proposals`, `agent_action_log` |
| Service | `backend/blyp-live-service/src/admin/agentAutomationService.ts` |
| Proposal worker | `agentProposalWorker.ts` |
| Execute worker | `agentExecuteWorker.ts` (Firestore `posts/{id}/comments`) |
| Crons | `POST /internal/cron/agent-proposals`, `POST /internal/cron/agent-execute` |
| Admin APIs | `/admin/agents*` |
| UI | `admin/src/pages/Agents.tsx`, `AgentDetail.tsx` |
| Permission | `agents.oversight` — **owner** + **admin (Mel)** |

## APIs

```http
GET  /admin/agents
GET  /admin/agents/global
POST /admin/agents/global                    # pause / forceSuggestOnly
GET  /admin/agents/proposals?status=pending|approved|executed|all
GET  /admin/agents/activity
POST /admin/agents/proposals
POST /admin/agents/proposals/:id/approve     # approve + execute comment when possible
POST /admin/agents/proposals/:id/reject
GET  /admin/agents/:userId
POST /admin/agents/:userId/settings
POST /admin/agents/:userId/phrases
POST /admin/agents/phrases/:phraseId/delete
GET  /admin/agents/:userId/log

POST /internal/cron/agent-proposals
POST /internal/cron/agent-execute
```

## Worker behavior

**Propose**

- Enabled agents, mode ≠ `off`, `allowComment`
- Global pause / quiet hours / daily cap / phrase banks / topics avoid
- Context required: follows creator + recent (~48h) live post
- Dedupes per `(user, post)`
- If `mode=auto_with_limits` and `forceSuggestOnly=false`: auto-approve + execute under caps

**Execute**

- Comments only → `posts/{postId}/comments` as the user (Admin SDK)
- Increments `commentCount` / `comments`
- Blocks gift/wallet spam text
- `targetId=demo` or missing → mark executed with skip (no Firestore write)
- Posts / gifts never execute

## Mel permissions (sensible, no financial)

- **Has** `agents.oversight`: settings, phrases, approve/reject, global pause / forceSuggestOnly
- **Does not have** `economy.credit` (owner-only coin/gem gifting)

Staff surface is admin.blyp.world (no separate creator self-serve yet). Boss does not need to impersonate — manage via `/agents/:userId`.

## How to test

1. Open **https://admin.blyp.world/agents** (Owner or Mel).
2. Ensure global is **RUNNING**.
3. Open **Manage** on a user → enable, `suggest_only`, allow comment, add phrases.
4. Trigger proposal sweep (or wait ~15m):

   ```powershell
   gcloud scheduler jobs run agent-proposals --project=blyp-master --location=us-central1
   ```

5. Approve a pending proposal with a **real** `targetId` → comment should appear on the post.
6. Optional retry cron: create scheduler job `agent-execute` → `POST …/internal/cron/agent-execute` every 5–15 minutes.

## Deploy

```powershell
gcloud run deploy blyp-live-service --source backend/blyp-live-service --region us-central1 --project blyp-master

cd admin; npm run build
netlify deploy --prod --dir=dist --site f31b62f8-deae-4110-afb9-b6863900336c
```

Create execute scheduler if missing (same secret as other internal crons). **Do not** bake Play AAB for this slice.

## Remaining

- Creator self-serve web / mobile toggles (needs product surface + likely AAB)
- Staff “assigned users” scoping
- Reply/react capabilities
- Push-approve on device
