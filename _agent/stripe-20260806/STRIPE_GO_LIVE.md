# Stripe go-live — Blyp creator withdrawals

**Date:** 2026-08-06  
**Service:** Cloud Run `blyp-live-service` (us-central1)  
**URL:** `https://blyp-live-service-innn3d7yqq-uc.a.run.app`  
**Admin:** https://admin.blyp.world → Economy

## What Stripe is used for today

| Surface | Stripe? | Notes |
|---------|---------|--------|
| Creator GEM cash-out | **Yes — Connect Express + Transfers** | Only path. Platform fee + net transfer to creator connected account |
| Coin / IAP purchase | **No** | Google Play Billing (+ Apple IAP path). Verified via `/iap/verify` |
| Checkout / PaymentIntents / Billing Portal | **No** | Not implemented |
| Publishable key (`pk_live_`) | **Not required** for current app | Onboarding uses server-created Account Links; mobile opens the URL |

**Connect is required** for creator payouts. Without Express accounts + Transfers capability, withdrawals cannot settle.

## Current production posture (audited 2026-08-06)

| Knob | Value |
|------|--------|
| `ENABLE_WITHDRAWALS` | `0` (kill-switch **OFF**) |
| `STRIPE_SECRET_KEY` | Secret Manager `blyp-stripe-secret-key` → **`sk_test_…eflZ`** (test) |
| `STRIPE_WEBHOOK_SECRET` | Secret Manager `blyp-stripe-webhook-secret` → **`whsec_…YzHf`** present |
| `PENDING_GEMS_HOLD_SECONDS` | `604800` (7d) |
| Cloud Run revision | `blyp-live-service-00142-9ln` |
| Webhook route | `POST /webhooks/stripe` (raw body + signature verify) |

**Withdrawals cannot be enabled yet** — live `sk_live_` is not on Cloud Run.

---

## Checklist for Alex’s new Stripe account

### 1. Dashboard setup

1. Complete Stripe account activation (business details, bank for platform balance).
2. **Settings → Connect → Get started** → enable **Express** accounts.
3. Ensure platform can create **Transfers** to connected accounts (Connect settings / capabilities).
4. Prefer **GBP** platform currency to match `STRIPE_PLATFORM_CURRENCY=GBP`.

### 2. API keys to create

| Key | Where it goes | Required? |
|-----|---------------|-----------|
| **Secret key live** `sk_live_…` | Secret Manager `blyp-stripe-secret-key` → Cloud Run `STRIPE_SECRET_KEY` | **Yes** |
| **Webhook signing secret** `whsec_…` | Secret Manager `blyp-stripe-webhook-secret` → Cloud Run `STRIPE_WEBHOOK_SECRET` | **Yes** |
| Publishable `pk_live_…` | Optional / not wired in app today | No for withdrawals |
| Test `sk_test_` / `whsec_` | Keep for local QA only | Do not leave on prod when enabling cash-out |

### 3. Webhook endpoint (register in Stripe Dashboard)

**Endpoint URL (exact):**

```text
https://blyp-live-service-innn3d7yqq-uc.a.run.app/webhooks/stripe
```

**Mode:** Live  
**API version:** leave Stripe default (server uses `stripe` Node SDK 17.x)

**Events to subscribe:**

| Event | Purpose |
|-------|---------|
| `account.updated` | Sync Express `payouts_enabled` / `details_submitted` |
| `transfer.created` | Mark withdrawal `paid` when metadata has `withdrawal_id` |
| `transfer.updated` | Same |
| `transfer.failed` | Restore gems / mark failed |
| `transfer.reversed` | Restore gems / mark failed |
| `charge.dispute.created` | Increment user `openChargebackCount` (blocks withdraw) |
| `charge.dispute.funds_withdrawn` | Same |
| `charge.dispute.closed` | Decrement open chargeback flag |
| `charge.dispute.funds_reinstated` | Decrement |
| `radar.early_fraud_warning.created` | Fraud review flag when user mappable |

> Coin IAP chargebacks from **Google Play** are still **manual** (Admin → Economy → Chargebacks / user fraud flags). Stripe disputes only apply when a Stripe charge/Connect account maps to a Blyp user.

After creating the endpoint, copy the **Signing secret** (`whsec_…`) into Secret Manager.

### 4. Paste keys into GCP (do not commit)

From repo root (`Blyp26-eas-modern`):

```powershell
# Interactive — prompts for sk_live_ and whsec_; never echoes full secrets
.\tools\stripe\SET_STRIPE_LIVE_SECRETS.ps1
```

Or manually:

```powershell
# After you have the values in clipboard / secure paste:
$sk = Read-Host "sk_live_…"   # paste
$wh = Read-Host "whsec_…"     # paste

$sk | gcloud secrets versions add blyp-stripe-secret-key --data-file=-
$wh | gcloud secrets versions add blyp-stripe-webhook-secret --data-file=-

# Force new revision to pick up latest secret versions (already bound as /latest)
gcloud run services update blyp-live-service `
  --region us-central1 --project blyp-master `
  --update-secrets="STRIPE_SECRET_KEY=blyp-stripe-secret-key:latest,STRIPE_WEBHOOK_SECRET=blyp-stripe-webhook-secret:latest"
```

Verify **without printing secrets** (admin control plane after deploy of readiness fields):

- Admin → Config / Economy → Stripe secret shows **live**, webhook **yes**
- Or: `GET /admin/ops/control-plane` → `withdrawals.stripeKeyMode === "live"`

### 5. Smoke webhook (before enabling withdrawals)

1. Stripe Dashboard → Developers → Webhooks → endpoint → **Send test event** (`account.updated`).
2. Expect HTTP 200 from Cloud Run.
3. Confirm no signature failures in Cloud Run logs.

### 6. Enable withdrawals (ONLY after live key confirmed)

**Do not run until `stripeKeyMode` is `live` on Cloud Run.**

```powershell
gcloud run services update blyp-live-service `
  --region us-central1 --project blyp-master `
  --update-env-vars "ENABLE_WITHDRAWALS=1"
```

Preserve existing flags (`LIVE_MARBLE_RACE_ENABLED`, `ADMIN_ALLOWLIST_SUBS`, hold seconds).

Then ship mobile with `EXPO_PUBLIC_ENABLE_WITHDRAWALS=1` (EAS prod) so the Coin Store CTA appears.

### 7. Ops path

1. Creator: Coin Store → Withdraw → Stripe Express onboard (`blyp://withdraw/connect-return`).
2. Request ≥ policy minimum cleared gems → may land `pending_review`.
3. Admin (Owner): Economy → Approve (Connect Transfer) / Reject (gems restored).

---

## Env reference (Cloud Run)

```text
ENABLE_WITHDRAWALS=0          # flip to 1 only after sk_live_ verified
STRIPE_SECRET_KEY=<Secret Manager: blyp-stripe-secret-key>
STRIPE_WEBHOOK_SECRET=<Secret Manager: blyp-stripe-webhook-secret>
STRIPE_PLATFORM_CURRENCY=GBP
WITHDRAW_GEM_MINOR_UNITS=1
PENDING_GEMS_HOLD_SECONDS=604800
# Optional overrides (client usually sends deep links in onboard body):
# STRIPE_CONNECT_RETURN_URL=blyp://withdraw/connect-return
# STRIPE_CONNECT_REFRESH_URL=blyp://withdraw/connect-refresh
```

## Safe next messages

1. **Now:** Paste `sk_live_…` and `whsec_…` (from the new account’s live webhook) into chat or run `SET_STRIPE_LIVE_SECRETS.ps1`.
2. **After keys verified live on Cloud Run:** Reply **enable withdrawals**.

## Related

- Ops runbook: `docs/WITHDRAWALS_OPS.md`
- Code: `backend/blyp-live-service/src/economy/withdrawalService.ts`
- Webhook mount: `backend/blyp-live-service/src/index.ts` → `POST /webhooks/stripe`
