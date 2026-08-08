# Automated agent MVP (web / Cloud Run)

Boss oversight on **https://admin.blyp.world/agents**. Default mode **`suggest_only`** with a human **approve queue**. Auto-post is hard-disabled. No mobile AAB required for this slice.

## Shipped

| Piece | Location |
|-------|----------|
| Schema | `user_agent_settings`, `user_agent_phrases`, `agent_action_proposals`, `agent_action_log` via `adminSchema.ts` |
| Service | `backend/blyp-live-service/src/admin/agentAutomationService.ts` |
| Proposal worker | `backend/blyp-live-service/src/admin/agentProposalWorker.ts` |
| Cron | `POST /internal/cron/agent-proposals` (Cloud Scheduler → Cloud Run) |
| Admin APIs | `/admin/agents*` on live-service (see below) |
| Boss UI | `admin/src/pages/Agents.tsx` → nav **Agent oversight** |
| Permission | `agents.oversight` (Owner via ALL_PERMS; Mel view-only on GETs) |

## APIs

```http
GET  /admin/agents
GET  /admin/agents/global
POST /admin/agents/global                    # agents.oversight — pause / force suggest_only
GET  /admin/agents/proposals?status=pending
POST /admin/agents/proposals                 # agents.oversight — seed/propose (context required)
POST /admin/agents/proposals/:id/approve
POST /admin/agents/proposals/:id/reject
GET  /admin/agents/:userId
POST /admin/agents/:userId/settings
POST /admin/agents/:userId/phrases
POST /admin/agents/phrases/:phraseId/delete
GET  /admin/agents/:userId/log

POST /internal/cron/agent-proposals          # x-internal-secret; Cloud Scheduler
```

### Proposal worker behavior

- Scans `user_agent_settings` where `enabled=true` and mode ≠ `off`
- Requires `allowComment` (comments only — no gifts/wallet/posts)
- Respects global pause, quiet hours, `maxActionsPerDay`, deny/allow phrase banks, `topicsAvoid`
- Needs real context: user follows creator + creator has a recent (~48h) live post
- Dedupes per `(user, post)` for pending/approved/executed
- Writes `pending` proposals only — **never posts**

Approve marks ready for a future executor; **nothing posts** until an executor ships.

## How Alex tests one proposal in admin

1. Open **https://admin.blyp.world/agents** (Owner).
2. Ensure global is **RUNNING** (not paused).
3. Enable an agent for a Cognito sub that **follows** at least one creator with a recent live post:
   - Seed settings via the page form, or `POST /admin/agents/:userId/settings` with `enabled: true`, `mode: "suggest_only"`, `allowComment: true`.
4. Optionally add allow phrases under that user (else defaults are used).
5. Wait for the scheduler (~15 min) or trigger once:
   ```powershell
   # uses same internal secret as rankings-materialize — do not print it
   gcloud scheduler jobs run agent-proposals --project=blyp-master --location=us-central1
   ```
6. Refresh **/agents** — pending queue should show a comment proposal with context about the followed creator’s post.
7. Approve/Reject as Boss (still does not publish).

Manual seed (no follow graph needed): use **Seed demo proposal** on the same page.

## Deploy

```powershell
gcloud run deploy blyp-live-service --source backend/blyp-live-service --region us-central1 --project blyp-master
# admin UI (if Agents page changed):
cd admin; npm run build
netlify deploy --prod --dir=dist --site f31b62f8-deae-4110-afb9-b6863900336c
```

Scheduler job: `agent-proposals` → `POST …/internal/cron/agent-proposals` every 15 minutes.

## Remaining

- Richer drill-in (phrase editor, rate-limit hits, audit timeline)
- Creator self-serve web settings (non-admin)
- Executor worker (after approve) — still not shipped
- Mobile toggles / push-approve (needs AAB)
