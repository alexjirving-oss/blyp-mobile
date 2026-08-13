# Creator withdrawals (cash-out) — ops runbook

Creator GEM earnings → **PayPal Payouts** (works while Stripe Connect is in
review) and/or **Stripe Connect Express** bank transfer. Purchased COIN and
admin BONUS_COIN are never cashable.

**Go-live checklist (new Stripe account):** `_agent/stripe-20260806/STRIPE_GO_LIVE.md`

## Current production posture (do not skip)

| Knob | Prod today | Ready-to-enable target |
|------|------------|------------------------|
| `ENABLE_WITHDRAWALS` | `1` | Keep `1` while Stripe and/or PayPal can settle |
| `STRIPE_SECRET_KEY` | Secret Manager `blyp-stripe-secret-key` | Preserve live key |
| `STRIPE_WEBHOOK_SECRET` | Secret Manager `blyp-stripe-webhook-secret` | Live Connect webhook signing secret |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | Secret Manager `blyp-paypal-client-id` / `blyp-paypal-client-secret` | REST app with **Payouts** |
| `PAYPAL_MODE` | `live` | `sandbox` only for QA |
| `PENDING_GEMS_HOLD_SECONDS` | `604800` (7 days) | keep `604800` |
| Client `EXPO_PUBLIC_ENABLE_WITHDRAWALS` | `1` (CTA visible; default ON) | Keep `1`; set `0` only to hide CTA |
| `ADMIN_ALLOWLIST_SUBS` | set — **preserve** | unchanged |
| `WITHDRAW_TEST_SUBS` | Owner launch-test sub set | Preserve for controlled Owner testing |

Code enables cash-out when **`ENABLE_WITHDRAWALS=1`** and **at least one** of
Stripe secret or PayPal client credentials is present. Admin control plane
reports Stripe/PayPal readiness without exposing secrets.

### Why the Withdraw button vanished (2026-08)

Client gated the Wallet CTA on `EXPO_PUBLIC_ENABLE_WITHDRAWALS` with a **false
default** when `expo.extra` failed to load in some tip/phonesigned builds. That
hid **Withdraw earnings** even though Cloud Run had `ENABLE_WITHDRAWALS=1`.
Fix: default the client flag **ON**, bake `EXPO_PUBLIC_ENABLE_WITHDRAWALS=1`
into `.env.production` / EAS, and open the withdraw sheet with **PayPal** as the
default destination while Stripe Connect is still in review.

## PayPal Business — what Alex enables

1. Log into **PayPal Business** (the account that will send creator payouts).
2. **Developer Dashboard** → create / open a **REST API app** (Live).
3. Enable product **Payouts** on that app (PayPal may require Business verification
   / Payouts approval — until approved, use Admin → mark-paid-manual after a
   manual PayPal send).
4. Copy **Client ID** + **Secret** into Secret Manager (do not paste into chat):
   - `blyp-paypal-client-id` → Cloud Run `PAYPAL_CLIENT_ID`
   - `blyp-paypal-client-secret` → Cloud Run `PAYPAL_CLIENT_SECRET`
5. Keep `PAYPAL_MODE=live` on Cloud Run.
6. Fund the PayPal Business balance enough to cover gem payouts (£0.01/gem, 0% platform fee).

App flow: Wallet → **Withdraw earnings** → PayPal → enter PayPal email → submit
→ `pending_review` → Admin **Approve** (calls Payouts API) or
`POST /admin/withdrawals/:id/mark-paid-manual` after a manual send.

Stripe bank remains available once Connect platform review clears; creators can
still choose Bank (Stripe) when `payouts_enabled`.

## Env vars (Cloud Run `blyp-live-service`, us-central1)

```text
ENABLE_WITHDRAWALS=1
STRIPE_SECRET_KEY=<Secret Manager: blyp-stripe-secret-key>
STRIPE_WEBHOOK_SECRET=<Secret Manager: blyp-stripe-webhook-secret>
PAYPAL_CLIENT_ID=<Secret Manager: blyp-paypal-client-id>
PAYPAL_CLIENT_SECRET=<Secret Manager: blyp-paypal-client-secret>
PAYPAL_MODE=live
STRIPE_PLATFORM_CURRENCY=GBP
STRIPE_CONNECT_RETURN_URL=https://blyp.world/withdraw/connect-return
STRIPE_CONNECT_REFRESH_URL=https://blyp.world/withdraw/connect-refresh
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
2. Enable Stripe Connect (Express + transfers). Finish platform questionnaire if Stripe still shows “in review”.
3. Configure webhook signing secret in `blyp-stripe-webhook-secret` (same script).
4. Confirm PayPal REST app has **Payouts** + secrets mapped (above).
5. Confirm Admin → Economy shows Stripe secret **live** + webhook **yes**.
6. Smoke webhook from Stripe Dashboard (expect 200).
7. Set `ENABLE_WITHDRAWALS=1` only after at least one settle rail is ready:
   - Helper: `.\tools\stripe\ENABLE_WITHDRAWALS_IF_LIVE.ps1`
8. Ship mobile with `EXPO_PUBLIC_ENABLE_WITHDRAWALS=1` (default ON).
9. Ops: Admin → Economy → pending review → Approve / Reject / mark-paid-manual.

## How to test

1. Backend: `ENABLE_WITHDRAWALS=1`, PayPal credentials present (and/or Stripe).
2. Gift flow → gems in `gem_pending` until hold → `gem_available`.
3. App: Coin Store / Profile Wallet → **Withdraw earnings** → PayPal email → ≥1000 gems.
4. Admin console → Economy → Approve (PayPal Payouts or Stripe transfer) or mark-paid-manual.

## Admin API

```http
GET  /admin/ops/control-plane          # stripeKeyMode, webhookConfigured (no secrets)
GET  /admin/withdrawals?status=pending_review
POST /admin/withdrawals/:withdrawalId/approve
POST /admin/withdrawals/:withdrawalId/mark-paid-manual  { "note"?, "externalReference"? }
POST /admin/withdrawals/:withdrawalId/reject   { "reason": "optional" }
```

## `PROVIDER_ERROR`: insufficient Stripe platform balance

Withdrawals use `stripe.transfers.create` to move GBP from the Blyp **platform
available balance** to the creator's connected account. A connected account can
have payouts enabled and a valid bank account while this transfer still fails if
the platform balance is empty.

- 1,000 gems = £10.00 at 1p/gem with **0% platform fee** = **£10.00 transfer** (rail fees if any are separate).
- Google Play proceeds do not automatically fund the Stripe platform balance.
- In Stripe Dashboard, open **Balances → Add funds**, fund enough GBP for the
  transfer plus a buffer, and wait until it is **available** (not pending).
- Keep the platform payout schedule manual if Stripe balance is reserved for
  marketplace withdrawals; otherwise automatic platform payouts can sweep it.
- Do not replace the transfer with `payouts.create`: a payout only moves an
  account's existing Stripe balance to its bank and does not fund that balance.

The API returns a safe `detail.reason` / `detail.userMessage` for the app and
retains the exact Stripe provider message in structured logs and withdrawal
metadata for operators.

## Deploy

```powershell
gcloud run deploy blyp-live-service --source backend/blyp-live-service --region us-central1 --project blyp-master

gcloud run services update blyp-live-service --region us-central1 --project blyp-master `
  --update-env-vars "PENDING_GEMS_HOLD_SECONDS=604800,ENABLE_WITHDRAWALS=1,LIVE_MARBLE_RACE_ENABLED=1,PAYPAL_MODE=live"

cd admin; npm ci; npm run build
```
