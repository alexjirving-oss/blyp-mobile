# Blyp admin console

Vite + React admin UI for `blyp-live-service` admin APIs. Deployed to Netlify at **https://admin.blyp.world**.

## Auth (current)

1. Open **https://admin.blyp.world** (or local `npm run dev`).
2. Sign in with **Cognito** email/password (MFA challenge supported).
3. The console exchanges the Cognito ID token at `POST /admin/auth/login` and calls all `/admin/*` APIs with `Authorization: Bearer <idToken>`.
4. Cloud Run must set **`ADMIN_ALLOWLIST_SUBS`** to a comma-separated list of Cognito **subs**. Empty allowlist refuses all admin access.

Retired (do not use / do not document as live):

- Shared password login / `ADMIN_LOGIN_ACCOUNTS`
- `blyplive.com` password admin paths
- `x-admin-session` / in-memory admin sessions

## Commands

```bash
npm ci
npm run lint
npm run build
npm run dev
```

## Deploy

`netlify.toml` uses relative `base` / `publish` paths (no machine-absolute paths).

## Elevated powers

| Action | How | Auth |
|--------|-----|------|
| Dashboard coin credit | Person detail → Wallet → `POST /admin/users/:id/credit-coins` | Allowlist + RBAC `economy.credit` (**owner** only; stripped from `admin` / Mel). Credits **BONUS_COIN** (non-withdrawable). |
| Agent oversight | `/agents` + `/agents/:userId` — propose/approve/execute comments | `agents.oversight` (**owner** + **admin**/Mel). No financial powers. |
| Withdrawal settle | Economy → pending review → Approve/Reject | `ADMIN_ALLOWLIST_SUBS`; Approve needs Stripe secrets |
| Direct economy credit | `POST /economy/admin/credit-coins` | `ECONOMY_ADMIN_CREDIT_ENABLED=1` **and** `ECONOMY_ADMIN_ALLOWLIST_SUBS` |
| In-app (mobile) admin | Person detail → Role `admin`/`manager` → Save capabilities | Syncs Firestore `users/{cognitoSub}` (`roles` + `isAdmin`) via Admin SDK |
| Manual in-app grant | `node tools/seed/grant_admin.js` with ADC | Writes the same Firestore fields |

Ops note: dashboard coin credit does **not** require the economy allowlist. Keep `ECONOMY_*` set only if you still call the economy endpoint outside the console.

## Honest limits (Firestore `isAdmin`)

`firestore.rules` currently allows an owner to `create`/`update` their own `users/{userId}` document **without** freezing `isAdmin` / `roles`. The mobile app trusts those fields for `useIsAdmin`.

- Server-side sync from the admin console (and `grant_admin.js`) is the supported grant path.
- A client could theoretically self-elevate unless rules are tightened later.
- Tightening rules is deferred on purpose: a naive `diff().affectedKeys()` block risks breaking legitimate profile updates. Prefer a careful rules change with device tests before deploying.

Reports collection: clients may create/read their own reports; only Admin SDK (dashboard) can resolve/dismiss.
