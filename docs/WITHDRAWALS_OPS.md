# Creator withdrawals (cash-out) — ops runbook

Creator GEM earnings → Stripe Connect Express transfer. Purchased COIN and
admin BONUS_COIN are never cashable.

**Go-live checklist (new Stripe account):** `_agent/stripe-20260806/STRIPE_GO_LIVE.md`

## Current production posture (do not skip)

| Knob | Prod today | Ready-to-enable target |
|------|------------|------------------------|
| `ENABLE_WITHDRAWALS` | `0` (kill-switch off) | `1` only after live Stripe + hold |
| `STRIPE_SECRET_KEY` | Secret Manager `blyp-stripe-secret-key` (**currently `sk_test_…`**) | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | Secret Manager `blyp-stripe-webhook-secret` | Live Connect webhook signing secret |
| `PENDING_GEMS_HOLD_SECONDS` | `604800` (7 days) | keep `604800` |
| Client `EXPO_PUBLIC_ENABLE_WITHDRAWALS` | unset / false (CTA hidden) | `1` in EAS prod profile **after** backend flag |
| `ADMIN_ALLOWLIST_SUBS` | set — **preserve** | unchanged |
| `LIVE_MARBLE_RACE_ENABLED` | `1` — **preserve** | unchanged |

Code refuses to treat withdrawals as enabled unless **both**
`ENABLE_WITHDRAWALS=1` **and** a non-empty `STRIPE_SECRET_KEY` are present.
Admin control plane reports `stripeKeyMode` (`test` / `live` / `absent`) without exposing secrets.

## Env vars (Cloud Run `blyp-live-service`, us-central1)

```text
ENABLE_WITHDRAWALS=0
STRIPE_SECRET_KEY=<Secret Manager: blyp-stripe-secret-key>
STRIPE_WEBHOOK_SECRET=<Secret Manager: blyp-stripe-webhook-secret>
STRIPE_PLATFORM_CURRENCY=GBP
STRIPE_CONNECT_RETURN_URL=blyp://withdraw/connect-return
STRIPE_CONNECT_REFRESH_URL=blyp://withdraw/connect-refresh
WITHDRAW_GEM_MINOR_UNITS=1
PENDING_GEMS_HOLD_SECONDS=604800
```

Webhook: `POST https://blyp-live-service-innn3d7yqq-uc.a.run.app/webhooks/stripe`

Subscribe: `account.updated`, `transfer.created`, `transfer.updated`, `transfer.failed`, `transfer.reversed`,
`charge.dispute.created`, `charge.dispute.funds_withdrawn`, `charge.dispute.closed`,
`charge.dispute.funds_reinstated`, `radar.early_fraud_warning.created`.

## Enable checklist (Alex)

1. Replace `blyp-stripe-secret-key` with **live** key (`sk_live_…`) that can create Express accounts + Transfers.
   - Helper: `.\tools\stripe\SET_STRIPE_LIVE_SECRETS.ps1`
2. Enable Stripe Connect (Express + transfers).
3. Configure webhook signing secret in `blyp-stripe-webhook-secret` (same script).
4. Confirm Admin → Economy shows Stripe secret **live** + webhook **yes**.
5. Smoke webhook from Stripe Dashboard (expect 200).
6. Set `ENABLE_WITHDRAWALS=1` only after live key verified:
   - Helper: `.\tools\stripe\ENABLE_WITHDRAWALS_IF_LIVE.ps1`
7. Ship mobile with `EXPO_PUBLIC_ENABLE_WITHDRAWALS=1`.
8. Ops: Admin → Economy → pending review → Approve / Reject.

## How to test

1. Backend: `ENABLE_WITHDRAWALS=1`, `STRIPE_SECRET_KEY=sk_test_…` (hold can be `60` for QA only).
2. Gift flow → gems in `gem_pending` until hold → `gem_available`.
3. App with `EXPO_PUBLIC_ENABLE_WITHDRAWALS=1`: Coin Store → Withdraw → Stripe Express onboard.
4. Request ≥ 1000 cleared gems. Large / new-payout / velocity → `pending_review`.
5. Admin console → Economy → Approve (Stripe transfer) or Reject (gems restored).

## Admin API

```http
GET  /admin/ops/control-plane          # stripeKeyMode, webhookConfigured (no secrets)
GET  /admin/withdrawals?status=pending_review
POST /admin/withdrawals/:withdrawalId/approve
POST /admin/withdrawals/:withdrawalId/reject   { "reason": "optional" }
```

## Deploy

```powershell
gcloud run deploy blyp-live-service --source backend/blyp-live-service --region us-central1 --project blyp-master

gcloud run services update blyp-live-service --region us-central1 --project blyp-master `
  --update-env-vars "PENDING_GEMS_HOLD_SECONDS=604800,ENABLE_WITHDRAWALS=0,LIVE_MARBLE_RACE_ENABLED=1"

cd admin; npm ci; npm run build
netlify deploy --prod --dir=dist --site f31b62f8-deae-4110-afb9-b6863900336c
```

Do **not** set `ENABLE_WITHDRAWALS=1` until Stripe secret is `sk_live_` and Connect is verified.
