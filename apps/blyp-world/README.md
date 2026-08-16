# blyp.world (Next.js)

Day-one web product: For You, `/v/[id]`, Cognito login, Stage `/u/[username]`, LIVE directory/watch, Stripe coin top-up.

**Live deploy:** https://blyp-world-app.netlify.app  
(Static `blyp.world` landing remains on Netlify site `blyplive-landing` until DNS cutover.)

## Dev

```bash
cd apps/blyp-world
npm install
npm run dev
```

## Build / deploy

```bash
npm run build          # static export → out/
netlify deploy --prod --dir out --functions netlify/functions
```

## Env Alex must set (Netlify)

| Var | Why |
| --- | --- |
| `STRIPE_SECRET_KEY` | Required for `/.netlify/functions/checkout` |
| `STRIPE_WEBHOOK_SECRET` | Required for `/.netlify/functions/stripe-webhook` fulfill |
| `INTERNAL_SHARED_SECRET` | Netlify → live-service credit (`/internal/economy/credit-web-coins`) |
| `LIVE_SERVICE_URL` | Optional override (defaults to Cloud Run live-service) |
| `STRIPE_PRICE_WEB_COINPACK_*` | Optional Stripe Price IDs (GBP). Fallback uses `price_data` GBP |
| `NEXT_PUBLIC_SITE_URL` | Checkout redirects / OG (`https://blyp-world-app.netlify.app` now) |

**Economy:** 1 coin = 1p base everywhere. Web packs grant base + ~15% bonus coins. App IAP is base-only.

**Stripe webhook (canonical):**  
`POST https://blyp-live-service-innn3d7yqq-uc.a.run.app/webhooks/stripe`  

Must include event **`checkout.session.completed`** (plus Connect/dispute events).  
Optional secondary: Netlify `https://blyp-world-app.netlify.app/.netlify/functions/stripe-webhook`  
(requires `STRIPE_WEBHOOK_SECRET` + `INTERNAL_SHARED_SECRET` on Netlify). Both paths are idempotent on session id.

Public Cognito + Firebase IDs default from `eas.json` production.
