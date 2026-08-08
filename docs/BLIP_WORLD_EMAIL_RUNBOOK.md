# blip.world human email runbook

**Goal:** give Alex a working `@blip.world` mailbox service (human inboxes + aliases), without confusing it with the product domain `blyp.world` (Cognito / SES transactional).

**Brand note:** product brand is **Blyp**; Alex stated ownership of **`blip.world`**. This runbook uses `blip.world` as he stated. Product URLs and legal mail in the app currently use **`blyp.world`**.

---

## Live DNS snapshot (checked 2026-08-08)

| Domain | Registrar DNS | Human MX | SPF | SES (AWS eu-west-2) |
|---|---|---|---|---|
| **blip.world** | GoDaddy (`ns09`/`ns10.domaincontrol.com`) | **Google** (`aspmx.l.google.com` + alts) | GoDaddy flatten → `include:_spf.google.com` | No SES identity |
| **blyp.world** | GoDaddy (`ns77`/`ns78.domaincontrol.com`) | **None** | Site verification TXT only | Identity **FAILED** (DKIM DNS missing) — see `EMAIL_DELIVERABILITY_RUNBOOK.md` |

Also on `blip.world` already:

- Two `google-site-verification=` TXT records (Workspace / Search Console style)
- `_dmarc` TXT `p=none` (**duplicate** records — clean to one later)
- `klaviyo-site-verification` (marketing stack, not human mail)
- No Google DKIM CNAME/TXT published yet (`google._domainkey` etc. empty)

**Implication:** inbound mail for `blip.world` is already pointed at Google. Finish (or activate) **Google Workspace**, do not flip MX to Zoho/Cloudflare unless you intentionally abandon this path.

---

## Recommendation (ranked)

### 1. Google Workspace on `blip.world` (recommended)

**Why:** MX + SPF + Google verification TXT are already in place. Real inboxes, mobile apps, free aliases/groups, catch-all routing, and familiar admin. Agent can prepare lists/DNS checklists; Alex must log into admin.google.com and GoDaddy.

**Cost ballpark (USD, annual billing, ~2026):** Business Starter Ôëê **$7 / user / month**. Aliases and Google Groups do not add seats. Example: 7 people Ôëê **~$49/mo**. Trial often available.

### 2. Zoho Mail (free Ôëñ5 users, or Mail Lite ~Ôé¼0.90/user/mo)

Only if you want cheapest hosted mail **and** are willing to **replace** the current Google MX. Free tier is web/mobile-app limited (no IMAP on free). Worse fit given DNS already points at Google.

### 3. Cloudflare Email Routing → personal Gmail

Free inbound forwarding only. Requires moving DNS to Cloudflare. Sending as `@blip.world` still needs a separate SMTP provider. Fine for solo hobby; weak for a product team that needs shared ops addresses and send-from-domain.

### 4. Microsoft 365

Parity with Workspace, but requires MX cutover away from Google. No advantage here unless the team already lives in M365.

### 5. Amazon WorkMail

Possible given AWS already in use, but pricier per seat and weaker day-to-day UX than Workspace for a small team.

### Split architecture (keep this)

| Layer | Domain | Provider | Purpose |
|---|---|---|---|
| Human + shared + aliases | **blip.world** | Google Workspace | People and ops mail |
| Transactional app mail | **blyp.world** | Amazon SES → Cognito | Sign-up / reset codes (`no-reply@blyp.world`) — existing runbook |

Do **not** put Cognito codes on Workspace, and do **not** expect SES alone to give human inboxes.

---

## Address types (clarify)

| Type | What it is | Send? | Receive? | Example |
|---|---|---|---|---|
| **Human mailbox** | Paid Workspace user seat | Yes | Yes | `alex@blip.world` |
| **Alias** | Extra address on a mailbox (free) | Optional | Yes → owner | `william@` → Alex's mailbox until William has a seat |
| **Shared inbox / Group** | Multi-person destination (Google Group recommended) | Via group settings | Yes → members | `support@`, `sales@` |
| **Transactional-only sender** | App/API sends; humans should not use as primary inbox | System only | Prefer none / discard | `noreply@` |

**Catch-all policy (recommended):** route unknown `*@blip.world` to `alex@blip.world` (or a `catchall@` alias on Alex) during early ops; turn off once phishing risk grows.

---

## Proposed address list (`@blip.world`)

### Human mailboxes (create as Workspace users when each person needs login)

| Address | Purpose | Notes |
|---|---|---|
| `alex@blip.world` | Founder / primary | Create first; admin |
| `sue@blip.world` | Team member | Seat when Sue needs send/login |
| `william@blip.world` | Team member | Seat or alias→Alex until then |
| `melody@blip.world` | Team member | Seat or alias→Alex until then |
| `scully@blip.world` | Team member | Seat or alias→Alex until then |
| `ru@blip.world` | Team member | Seat or alias→Alex until then |
| `alan@blip.world` | Team member | Seat or alias→Alex until then |

Until a person needs to send mail themselves, create their address as an **alias on Alex** (or a shared group) to save seats.

### Public / product shared (prefer Google Groups → team members)

| Address | Purpose |
|---|---|
| `sales@blip.world` | Sales / partnerships inbound |
| `contact@blip.world` | General contact form / website |
| `help@blip.world` | User help (can mirror support) |
| `support@blip.world` | Product support |
| `hello@blip.world` | Friendly general inbound |
| `press@blip.world` | Media / press |
| `careers@blip.world` | Hiring (optional early; create when needed) |

### Ops / compliance (Groups or aliases → Alex + relevant people)

| Address | Purpose |
|---|---|
| `admin@blip.world` | Domain / infra admin notices |
| `billing@blip.world` | Invoices, payment providers |
| `legal@blip.world` | Legal correspondence |
| `privacy@blip.world` | Privacy / GDPR-style requests |
| `abuse@blip.world` | Abuse / trust & safety reports |
| `security@blip.world` | Security disclosures (recommended) |
| `dmarc@blip.world` | DMARC aggregate reports (`rua`) |

### Transactional-only (Workspace: create as alias that discards, or Group with no members + archive)

| Address | Purpose |
|---|---|
| `noreply@blip.world` | Automated senders only; do not staff as inbox |
| `no-reply@blip.world` | Same role; alias of `noreply` for typo consistency |

App Cognito still targets **`no-reply@blyp.world`** via SES — keep that on `blyp.world`, not here, unless you deliberately migrate product mail.

### Optional later

| Address | Purpose |
|---|---|
| `safety@blip.world` | Trust & safety (product legal pages currently cite `safety@blyp.world`) |
| `finance@blip.world` | Bookkeeping if billing gets noisy |
| `partners@blip.world` | B2B partnerships if sales splits |

---

## Alex runbook — finish Google Workspace on blip.world

Agent **cannot** complete this without Alex's Google admin + GoDaddy logins (no DNS API / Workspace admin credentials in repo).

### A. Subscribe / activate (Alex)

1. Open [https://admin.google.com](https://admin.google.com) with the account that owns the Workspace trial/org for `blip.world`.
2. If no org yet: [https://workspace.google.com](https://workspace.google.com) → start Business Starter → claim **`blip.world`**.
3. Confirm domain verification (TXT already present — Workspace should see it).
4. Confirm MX status in Admin → Apps → Google Workspace → Gmail → **MX records** = verified.

### B. DNS at GoDaddy (Alex) — only what's still missing

Path: **GoDaddy → Domains → blip.world → DNS**.

| Action | Detail |
|---|---|
| Keep MX | Do **not** remove Google MX |
| Keep SPF | Current flatten already includes `_spf.google.com` — OK |
| Add DKIM | In Workspace Admin → Gmail → Authenticate email → generate DKIM → add the TXT (or CNAME) at GoDaddy → Start authentication |
| Clean DMARC | Delete **one** of the duplicate `_dmarc` TXT records; keep a single `v=DMARC1; p=none; rua=mailto:dmarc@blip.world; fo=1` |
| Later | After 1–2 weeks of clean mail, tighten DMARC to `p=quarantine` then `p=reject` |

If Klaviyo (or SES) later sends from `blip.world`, **merge** their `include:` into SPF (one SPF TXT only).

### C. Create mailboxes & aliases (Alex in Admin console)

1. **Users** → add `alex@` (super admin).
2. For each teammate who needs login: add user **or** add as **alias** on Alex temporarily.
3. **Groups** → create `support@`, `sales@`, `contact@`, `help@`, `hello@`, `press@`, `privacy@`, `legal@`, `billing@`, `abuse@`, `admin@`, `security@`, `dmarc@`, `careers@` (optional) → members = Alex (+ others).
4. **noreply@** / **no-reply@**: alias on a mailbox with auto-delete filter, or Group that does not notify anyone.
5. **Routing** → optional catch-all → `alex@blip.world`.

### D. Client setup (each human)

- Web: [https://mail.google.com](https://mail.google.com) signed in as `@blip.world`
- Mobile: Gmail app → add Google account
- Optional: Outlook/Apple Mail via Google IMAP (Workspace paid)

### E. Do **not** confuse with product SES (`blyp.world`)

Still blocked on GoDaddy DKIM for `blyp.world` — see `docs/EMAIL_DELIVERABILITY_RUNBOOK.md`. That path is Cognito spam fix, not human inboxes.

---

## What was configured in this pass vs Alex-owned

| Item | Status |
|---|---|
| Repo search / DNS live check | Done (this doc) |
| Address + type plan | Done (this doc) |
| Google Workspace subscription / users | **Alex** (admin.google.com) — agent browser MCP could not open a usable Google login session (tabs reset / no session). **Next Alex click:** open [admin.google.com](https://admin.google.com) (or [workspace.google.com](https://workspace.google.com) if no org), complete login + 2FA, then create aliases/Groups per ┬ºC |
| GoDaddy DKIM + DMARC cleanup | **Alex** — after Workspace shows DKIM records; delete one duplicate `_dmarc` TXT |
| SES / Cognito on `blyp.world` | Unchanged; still needs Alex DNS per existing SES runbook |
| App code mailto domains | **Not changed** (still mostly `@blyp.world` / `support@blyp.app`) |

### Agent session note (2026-08-08 GOGO)

Cursor browser automation reached `about:blank` / empty tab list only — **could not** complete Workspace mailbox creation. No credentials invented. Once Alex is logged into Admin console, re-run agent or finish ┬ºC manually (aliases → alex + Groups for shared).

---

## Domain mismatch summary (repo)

| In repo / product | On Alex's stated mailbox domain |
|---|---|
| `blyp.world` — landing, admin, privacy, share links, SES | `blip.world` — Google MX ready for human mail |
| Cited: `privacy@`, `hello@`, `support@`, `safety@`, `no-reply@` **@blyp.world** | Create parallel `@blip.world` set now; later decide whether public pages should switch or keep product domain |
| `support@blyp.app` in Help screen | Separate legacy; not configured here |
| Zero `blip.world` string matches in eas-modern codebase | Product never referenced blip in code |

**Practical split:** use **`@blip.world` for people and ops**, keep **`@blyp.world` for public product / SES** until you deliberately unify branding in copy and DNS.
