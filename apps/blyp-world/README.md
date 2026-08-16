# blyp.world (Next.js)

Day-one web product: For You, `/v/[id]`, Cognito login, Stage `/u/[username]`, LIVE directory/watch, Stripe coin top-up, **LIVE Studio** (`/live/studio`) with IVS Real-Time Web Broadcast host publish + guest accept.

## Live deploy

https://blyp.world (Netlify site `blyp-world-app`)

## SEO / Google presence

See **[GOOGLE_PRESENCE_CHECKLIST.md](./GOOGLE_PRESENCE_CHECKLIST.md)** for Search Console, Play listing, and Business Profile steps.

On-site: `/about/`, `/download/`, `robots.txt`, `sitemap.xml`, Organization JSON-LD.

## Dev

```bash
cd apps/blyp-world
npm install
npm run dev
```

## Build / deploy

```bash
npm run build          # static export → out/
netlify deploy --prod --no-build --dir out --site 3a4c3522-08f4-417f-a4ca-1a3b046fb5c0 --functions netlify/functions
```

## Env Alex must set (Netlify)

| Var | Why |
| --- | --- |
| `STRIPE_SECRET_KEY` | Required for `/.netlify/functions/checkout` |
| `STRIPE_PRICE_WEB_COINPACK_*` | Optional Stripe Price IDs |
| `NEXT_PUBLIC_SITE_URL` | Checkout redirects / OG (`https://blyp.world`) |

Public Cognito + Firebase IDs default from `eas.json` production.
