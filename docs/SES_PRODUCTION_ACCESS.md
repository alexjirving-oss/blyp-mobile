# SES production access — Alex action

## Status (2026-08-08)

| Item | State |
|---|---|
| Domain `blyp.world` SES | **Verified** (DKIM SUCCESS, MAIL FROM SUCCESS) |
| Cognito email | **DEVELOPER** From `Blyp <no-reply@blyp.world>` |
| SES sandbox exit | **DENIED** — review case `178124536700726` |
| CLI re-request | `put-account-details` returns `ConflictException` while prior review is DENIED |

## What Alex must do

1. Open **AWS Support Center** (account `030569357413`) → case **178124536700726**
2. Reply / appeal with:
   - Transactional only (Cognito signup + password reset)
   - Domain verified + DKIM + MAIL FROM + DMARC
   - From `no-reply@blyp.world`, reply-to `support@blyp.world`
   - No marketing lists; volume ≪ 200/day initially
3. Or file a new **SES sending limits / production access** case if the old thread is closed
4. After AWS sets `ProductionAccessEnabled=true`, verification emails reach any inbox (not only SES-verified addresses)

Until then: sandbox can only deliver to **verified** recipient identities — that’s why many real Gmail/etc. users still miss codes or see spammy defaults if anything falls back.

Check:

```powershell
aws sesv2 get-account --region eu-west-2 --query "{ProductionAccessEnabled:ProductionAccessEnabled,Review:Details.ReviewDetails}"
```
