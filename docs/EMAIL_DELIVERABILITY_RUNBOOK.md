# Email Deliverability Runbook (P11.1 / P11.2)

**Goal:** stop Cognito sign-up / verification / password-reset emails landing in
spam by sending them through Amazon SES from an authenticated `blyp.world`
address (SPF + DKIM + DMARC aligned), instead of the generic Cognito default
sender.

This runbook is the hand-off for the steps that require **DNS access (GoDaddy)**
and an **AWS SES production-access request** — neither of which can be done from
the codebase. Everything is pre-investigated; you just apply the records and flip
two switches.

---

## Current state (re-verified 2026-08-08, region `eu-west-2`, account `030569357413`)

| Thing | State | Meaning |
|---|---|---|
| SES account | **Sandbox** (`ProductionAccessEnabled=false`) | Can only email *verified* recipients until AWS approves production access (request already filed). |
| SES domain identity `blyp.world` | **SUCCESS** (DKIM + verified for sending) | Recreated 2026-08-08 to clear a stuck June `HOST_NOT_FOUND` failure; GoDaddy DKIM CNAMEs were already correct. |
| SES MAIL FROM `mail.blyp.world` | **SUCCESS** | Custom return-path aligned. |
| Cognito pool `eu-west-2_ITX07Zvnt` | `EmailSendingAccount: DEVELOPER` From `Blyp <no-reply@blyp.world>` | Wired via `tools/email/wire_cognito_ses.ps1 -Apply`. |
| DNS provider | GoDaddy (`ns77.domaincontrol.com`) | One-pager: `docs/GODADDY_BLYP_EMAIL_DNS.md`. |

> **What is automated already:** the SES production-access request has been
> submitted via CLI, and a safe one-command Cognito cutover script is staged at
> `tools/email/wire_cognito_ses.ps1`. The **only** thing that cannot be automated
> is adding the GoDaddy DNS records in Step 1 (no DNS API credentials). Once those
> propagate, run the script and email is done.

Check progress at any time (read-only):

```powershell
pwsh tools/email/wire_cognito_ses.ps1 -CheckOnly
```

---

## Step 1 — Add the DNS records at GoDaddy (blyp.world)

Add these in **GoDaddy → Domains → blyp.world → DNS → Manage DNS**.
When adding a CNAME, GoDaddy appends the domain automatically, so enter the
**Host** WITHOUT `.blyp.world` (shown in parentheses).

### 1a. DKIM — 3 × CNAME (required for verification + signing)

| Type | Host (Name) | Value (Points to) |
|---|---|---|
| CNAME | `675d4hobjo4hqphzoctmyzpcqahqsl6n._domainkey` | `675d4hobjo4hqphzoctmyzpcqahqsl6n.dkim.amazonses.com` |
| CNAME | `7vk7qtk37o3aqidjm4bfaskhgxp6ra6n._domainkey` | `7vk7qtk37o3aqidjm4bfaskhgxp6ra6n.dkim.amazonses.com` |
| CNAME | `paagbxuh3c267mey7utyk5v2la6lguju._domainkey` | `paagbxuh3c267mey7utyk5v2la6lguju.dkim.amazonses.com` |

> If GoDaddy rejects a CNAME because a conflicting record exists, delete the old
> one first. Do NOT add a trailing dot. TTL 1 hour is fine.

### 1b. MAIL FROM domain `mail.blyp.world` (improves alignment)

| Type | Host (Name) | Value | Priority |
|---|---|---|---|
| MX | `mail` | `feedback-smtp.eu-west-2.amazonses.com` | 10 |
| TXT | `mail` | `v=spf1 include:amazonses.com ~all` | — |

### 1c. DMARC (recommended — start in monitor mode)

| Type | Host (Name) | Value |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@blyp.world; fo=1` |

> Keep `p=none` for ~2 weeks while watching the `rua` reports, then tighten to
> `p=quarantine` and later `p=reject` once all legit mail is DKIM/SPF-aligned.

### 1d. (Optional) root-domain SPF
Only if `blyp.world` itself also sends mail directly. If a TXT SPF record already
exists on the root, MERGE rather than duplicate (only one SPF TXT per host):

| Type | Host (Name) | Value |
|---|---|---|
| TXT | `@` | `v=spf1 include:amazonses.com ~all` |

---

## Step 2 — Re-trigger SES verification (after DNS propagates)

DNS usually propagates in 15–60 min (can be up to 24–48h on GoDaddy). Then:

```bash
# Status should flip FAILED -> PENDING -> SUCCESS, DKIM Status -> SUCCESS
aws sesv2 get-email-identity --email-identity blyp.world --region eu-west-2 \
  --query "{verify:VerificationStatus,dkim:DkimAttributes.Status,mailfrom:MailFromAttributes.MailFromDomainStatus}"
```

If it stays FAILED after 48h, the records are wrong — re-check Host/Value exactly
(common GoDaddy mistake: entering the full `...._domainkey.blyp.world` host, which
double-appends the domain). SES auto-rechecks periodically; no manual re-submit
needed.

> The DKIM tokens above are already attached to the existing identity, so you do
> NOT need to recreate it. If you ever do recreate it, pull fresh tokens with the
> same `get-email-identity` call.

---

## Step 3 — SES production access (exit sandbox) — ALREADY SUBMITTED

This was **submitted via CLI on 2026-06-12** (`aws sesv2 put-account-details`,
Transactional, `https://blyp.world`, the use-case text below). You do **not** need
to file it again — just wait for AWS approval (usually < 24h) and confirm:

```bash
aws sesv2 get-account --region eu-west-2 --query "ProductionAccessEnabled"
# expect: true   (currently false while in review)
```

> Use-case submitted: *"Blyp is a social live-streaming mobile app. Emails are
> strictly transactional via Cognito (sign-up verification codes, password-reset
> codes, security notifications), only to users who created an account with their
> own email. No marketing. Bounces/complaints auto-suppressed. DKIM + custom MAIL
> FROM + SPF + DMARC configured on blyp.world."*

If AWS replies asking for more detail, answer from the AWS Support Center; the
case will be under "Service limit increase / SES production access".

---

## Step 4 — Point Cognito at SES (DEVELOPER sending) — ONE COMMAND

Only after Step 2 shows `DKIM Status: SUCCESS`. A safe, idempotent cutover script
is staged. It reads the live pool config and changes **only** the email block (so
it can't clobber password policy / deletion protection / recovery / triggers), it
attaches the SES sending-authorization policy Cognito needs, and it **refuses to
run** until SES is actually verified:

```powershell
# Preview only (mutates nothing); prints exactly what it will submit:
pwsh tools/email/wire_cognito_ses.ps1

# Perform the cutover (only succeeds when SES is verified):
pwsh tools/email/wire_cognito_ses.ps1 -Apply
```

The FROM identity ARN it uses is `arn:aws:ses:eu-west-2:030569357413:identity/blyp.world`,
FROM `Blyp <no-reply@blyp.world>`, reply-to `support@blyp.world`.

> Prefer the script over the console: the raw `aws cognito-idp update-user-pool`
> API REPLACES top-level pool settings and silently resets anything you omit
> (notably `DeletionProtection` → `INACTIVE`). The script avoids that by
> re-submitting the live config verbatim. If you must use the console instead:
> **Cognito → pool `eu-west-2_ITX07Zvnt` → Messaging → Email → Edit →** "Send
> email with Amazon SES", pick the `blyp.world` identity, set the FROM/reply-to
> above — the console only edits the email block.

### Customise the templates (optional but recommended)
Cognito → Messaging → **Message templates** → verification + invitation: set a
branded subject/body so it reads like Blyp, not a raw code. Keep `{####}` /
`{username}` placeholders.

---

## Step 5 — Verify end-to-end

1. Sign up a brand-new test account in the app.
2. Confirm the email arrives **in the inbox** (not spam) from `no-reply@blyp.world`.
3. Inspect headers: `DKIM=pass`, `SPF=pass`, `DMARC=pass`.
4. Test password reset too (same sender path).

```bash
# Sanity: confirm Cognito now uses SES
aws cognito-idp describe-user-pool --user-pool-id eu-west-2_ITX07Zvnt \
  --region eu-west-2 --query "UserPool.EmailConfiguration"
# expect EmailSendingAccount: DEVELOPER + SourceArn for blyp.world
```

---

## Rollback
If SES sending breaks sign-ups, revert Cognito to the default sender (console →
Messaging → Email → "Send email with Cognito") to restore service while you
debug. Deliverability returns to the spam-prone default but sign-up still works.

## Ownership summary
- **Step 1 (DNS):** the ONE remaining manual action — add the GoDaddy records.
  Cannot be automated (no DNS API credentials).
- **Step 3 (production access):** DONE — request submitted via CLI 2026-06-12,
  awaiting AWS approval.
- **Steps 2, 4, 5 (verify, wire Cognito, test):** automated — run
  `tools/email/wire_cognito_ses.ps1 -CheckOnly` to watch verification, then
  `-Apply` to cut over. No console work required.
