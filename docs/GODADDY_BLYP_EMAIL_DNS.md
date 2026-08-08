# GoDaddy DNS — fix Blyp verification email spam (one page)

**Why:** Cognito default sender lands in spam. Production path is SES on `blyp.world` (DKIM + SPF + DMARC), then Cognito `DEVELOPER` / SES From `Blyp <no-reply@blyp.world>`.

## Current status (2026-08-08)

| Item | State |
|---|---|
| DKIM CNAMEs at GoDaddy | Present (same tokens) |
| MAIL FROM `mail.blyp.world` | SUCCESS |
| SES domain verify / DKIM | **SUCCESS** (identity recreated to clear June FAILED stickiness) |
| Cognito → SES cutover | **Done** — From `Blyp <no-reply@blyp.world>` |
| SES production access | **DENIED** (case `178124536700726`) — Alex must appeal; see `docs/SES_PRODUCTION_ACCESS.md` |

If SES ever regresses to FAILED, confirm these DNS rows still exist, then recreate/recheck the identity.

---

## 1) GoDaddy → Domains → `blyp.world` → DNS → Manage DNS

Enter CNAME **Host without** `.blyp.world` (GoDaddy appends it).

### DKIM (3 × CNAME)

| Type | Host | Points to |
|---|---|---|
| CNAME | `675d4hobjo4hqphzoctmyzpcqahqsl6n._domainkey` | `675d4hobjo4hqphzoctmyzpcqahqsl6n.dkim.amazonses.com` |
| CNAME | `7vk7qtk37o3aqidjm4bfaskhgxp6ra6n._domainkey` | `7vk7qtk37o3aqidjm4bfaskhgxp6ra6n.dkim.amazonses.com` |
| CNAME | `paagbxuh3c267mey7utyk5v2la6lguju._domainkey` | `paagbxuh3c267mey7utyk5v2la6lguju.dkim.amazonses.com` |

### MAIL FROM

| Type | Host | Value | Priority |
|---|---|---|---|
| MX | `mail` | `feedback-smtp.eu-west-2.amazonses.com` | 10 |
| TXT | `mail` | `v=spf1 include:amazonses.com ~all` | — |

### DMARC

GoDaddy may already publish `_dmarc` (`p=quarantine`). Optional Blyp-owned monitor record:

| Type | Host | Value |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@blyp.world; fo=1` |

---

## 2) Confirm SES green

```powershell
aws sesv2 get-email-identity --email-identity blyp.world --region eu-west-2 `
  --query "{verify:VerificationStatus,dkim:DkimAttributes.Status,mailfrom:MailFromAttributes.MailFromDomainStatus,ready:VerifiedForSendingStatus}"
```

## 3) Wire Cognito → SES

```powershell
powershell -File tools/email/wire_cognito_ses.ps1 -CheckOnly
powershell -File tools/email/wire_cognito_ses.ps1 -Apply
```

## 4) SES production access

```powershell
aws sesv2 get-account --region eu-west-2 --query ProductionAccessEnabled
```

Until `true`, sandbox only delivers to verified recipients.

Full detail: `docs/EMAIL_DELIVERABILITY_RUNBOOK.md`.
