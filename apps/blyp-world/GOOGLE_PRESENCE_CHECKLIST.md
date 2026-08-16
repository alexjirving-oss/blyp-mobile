# Google presence checklist — Blyp (B-L-Y-P)

**Goal:** When people Google **Blyp**, the company / website / app should compete for the top organic results.

**Honest caveat:** Nobody can guarantee #1. Rankings depend on Google’s index, competing uses of the word “Blyp”, backlinks, brand searches over time, Play Store signals, and Business Profile eligibility. This checklist is everything feasible: ship solid on-site SEO, then complete Google’s property steps. No ads spend, no fake reviews, no black-hat SEO.

**Primary site:** https://blyp.world (`apps/blyp-world`)  
**Android app:** https://play.google.com/store/apps/details?id=com.blyp.mobile  
**Admin (not a consumer SEO target):** https://admin.blyp.world — keep out of consumer brand campaigns; do not submit as the main Search Console property.

---

## Already done in code (this ship)

After deploy of `apps/blyp-world`, these should be live:

| Item | Where |
| --- | --- |
| Title / description / Open Graph / Twitter defaults | `app/layout.tsx`, homepage + key routes |
| Canonical URLs (`metadataBase` + per-route `alternates.canonical`) | layout + `/`, `/about/`, `/download/`, `/live/`, `/foryou/`, `/wallet/` |
| `robots.txt` | Generated → https://blyp.world/robots.txt |
| `sitemap.xml` (submit-ready) | Generated → https://blyp.world/sitemap.xml |
| JSON-LD Organization + WebSite + SoftwareApplication / MobileApplication | `components/JsonLd.tsx` |
| FAQ JSON-LD | `/about/` |
| Brand spelling **Blyp** (B-L-Y-P) in copy + schema | About, footer, site constants |
| About / brand page with contacts | https://blyp.world/about/ |
| Download / Play landing | https://blyp.world/download/ |
| Internal links home → About / Download / Play | Homepage CTAs + site footer |
| Favicon + OG image | `/favicon.svg`, `/favicon.png`, `/og/og-default.jpg` |
| Search Console HTML verification file | `/google8831d0621217f010.html` (carried from legacy landing) |
| `noindex` on login / inbox / upload / following | robots meta + robots.txt disallow |

**Alex still must do** the Google Console / Business / Play steps below — code cannot finish those without his accounts.

---

## 1. Google Search Console (do this first)

1. Open [Google Search Console](https://search.google.com/search-console).
2. Add a **URL-prefix** property: `https://blyp.world` **or** a **Domain** property: `blyp.world` (Domain is stronger; needs DNS TXT).
3. **Verify**
   - Prefer **Domain** property: add the TXT record Google shows at GoDaddy for `blyp.world`.
   - Or keep **HTML file** verification: file is already shipped at  
     `https://blyp.world/google8831d0621217f010.html`  
     Confirm it returns 200 after deploy, then click Verify.
   - Optional meta tag: paste Google’s token into `app/layout.tsx` → `metadata.verification.google` (only use the exact token from Console).
4. **Submit sitemap:** Sitemaps → `https://blyp.world/sitemap.xml` → Submit.
5. **URL Inspection:** inspect `https://blyp.world/`, `/about/`, `/download/` → Request indexing (once each; don’t spam).
6. **Settings → users:** add any co-owner emails Alex trusts.
7. **Performance:** after days/weeks, filter queries for `blyp` / `blyp app` / `blyp.world` and note impressions/clicks.

**CLI note:** There is no safe automated GSC submit in-repo without OAuth credentials. If Alex later adds a service account with Search Console access, sitemap ping can be scripted; until then use the Console UI.

---

## 2. Google Business Profile (only if a real address)

- Blyp is documented as **online-first** (no public walk-in storefront on `/about/`).
- **If** there is a real registered business address Alex is willing to publish:
  1. Create/claim a [Google Business Profile](https://business.google.com/).
  2. Category: e.g. Software company / Internet company (pick the closest accurate one).
  3. Website: `https://blyp.world`
  4. Phone / hours only if real and staffed.
  5. Same brand spelling: **Blyp**.
- **If online-only with no disclosable address:** skip GBP (or use Google’s “service-area / online only” options carefully). Do **not** invent a fake storefront address — that risks suspension and hurts trust.

---

## 3. Google Play Console — store listing SEO

Package: `com.blyp.mobile`

1. Play Console → Blyp app → **Main store listing**.
2. **App name:** include **Blyp** (keep within Play’s character limits; do not keyword-spam).
3. **Short description:** lead with “Blyp” + what it is (short video + LIVE + gifts).
4. **Full description:** clear paragraphs; mention website `https://blyp.world`; no fake competitor stuffing.
5. **Graphics:** high-quality icon, feature graphic, phone screenshots (For You, LIVE, gifts).
6. **Contact / website:** set website to `https://blyp.world` (and privacy URL when the live privacy page is confirmed).
7. **Store listing experiments** (optional): test titles/descriptions that keep “Blyp” first.
8. Ensure the listing is **published** on a track users can find (production or at least open testing with discoverability as intended).

Play ranking for the query “Blyp” is separate from Google web search, but a strong listing + website link reinforces brand entity matching.

---

## 4. Optional: Google Ads brand campaign (do not spend without approval)

- Exact-match or phrase campaigns on **Blyp** can defend the SERP if competitors bid on the name.
- **Cost:** ongoing CPC; only Alex can approve budget.
- **This checklist does not authorize spend.** If approved later: brand exact match, sitelinks to `/about/` and `/download/`, Play extension if available.

---

## 5. Knowledge panel / entity signals

Usually **not feasible short-term:**

- Wikipedia / Wikidata need independent notability — do not create promotional stubs that get deleted.
- Knowledge panel often follows consistent NAP + sameAs + news/coverage over time.

**Doable now:**

- Keep Organization JSON-LD accurate (`components/JsonLd.tsx`).
- When real official social accounts exist, add their HTTPS URLs to `SAME_AS` in `lib/site.ts` (Instagram, X, YouTube, LinkedIn, TikTok — only real profiles).
- Use **Blyp** consistently everywhere (site, Play, email From names, press).

---

## 6. Optional: Bing Webmaster Tools

1. [Bing Webmaster](https://www.bing.com/webmasters) → Add `https://blyp.world`.
2. Import from Google Search Console **or** verify via XML/meta/DNS.
3. Submit `https://blyp.world/sitemap.xml`.

---

## Post-deploy smoke checks (Alex or agent)

After Netlify prod deploy:

```text
https://blyp.world/
https://blyp.world/about/
https://blyp.world/download/
https://blyp.world/robots.txt
https://blyp.world/sitemap.xml
https://blyp.world/google8831d0621217f010.html
https://blyp.world/og/og-default.jpg
```

View source on homepage: expect `<title>` containing Blyp, meta description, `application/ld+json`, canonical.

---

## Deploy (blyp.world)

From README (`apps/blyp-world`):

```bash
cd apps/blyp-world
npm install
npm run build
netlify deploy --prod --no-build --dir out --site 3a4c3522-08f4-417f-a4ca-1a3b046fb5c0 --functions netlify/functions
```

Requires Netlify CLI auth on the machine. Do **not** deploy from a dirty unrelated tree mix-up — build this app folder only.

---

## What will *not* be done from this repo

- Guaranteeing Google #1 for “Blyp”
- Buying links, fake reviews, cloaking, doorway pages
- Spending Ads budget without Alex’s approval
- Creating Wikipedia/Wikidata entries
- Claiming a Google Business address that is not real
- Treating admin.blyp.world as the public brand homepage

---

## Suggested order for Alex (30–60 minutes)

1. Deploy this web SEO ship (if not already live).
2. Search Console verify + submit sitemap + request index on `/`, `/about/`, `/download/`.
3. Align Play store listing title/short/full + website field.
4. Decide GBP: real address → claim; else skip.
5. Add official social URLs to `SAME_AS` when accounts exist.
6. Optional Bing; optional Ads only with budget approval.
7. Re-check Google for `Blyp` in 1–2 weeks (incognito) and note what’s ranking.
