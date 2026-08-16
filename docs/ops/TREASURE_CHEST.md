# Daily treasure chest (verified accounts)

## Product

- **Who:** verified Blyp accounts only
- **Base grant:** `TREASURE_CHEST_BASE_COINS` (default **15**, clamped 5–25)
- **Bonus grant:** `TREASURE_CHEST_BONUS_COINS` (default **10**) after posting a **new video** the same UTC day
- **Reset:** **00:00 UTC** (same day key convention as `/economy/daily-reward`)
- **Idempotency:** `treasure:base:<uid>:<UTC-day>` and `treasure:bonus:<uid>:<UTC-day>` on `ledger_entries`

## Verified detection (OR)

1. Postgres `user_admin_state.metadata.verification.isVerified` (Mel / admin capabilities)
2. Firestore `users/{uid}.verified` **or** `isVerified` **or** `verificationStatus === 'verified'` (public badge from `blypVerificationSubmit`)

## API (live-service, Cognito JWT)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/economy/treasure-chest` | Peek eligibility + claimable amounts |
| POST | `/economy/treasure-chest/claim` | Base claim |
| POST | `/economy/treasure-chest/bonus` | Bonus claim (`{ postId? }`) |

## Client

- Screen: `TreasureChest` (`blyp://treasure`)
- Home Base quick action: **Treasure**
- Push `data.type = treasure_chest` routes to `TreasureChest`

## Notifications

- **On grant:** live-service writes `notifications/{id}` (`type: system`, body “You got N coins”) → existing FCM dispatcher
- **Available reminder:** Cloud Function `treasureChestReminderSweep` at **00:15 UTC** (capped fan-out). Primary UX is still the in-app chest entry + peek badge.
- Pref category: **system** (default ON). Not a second push stack.

## Env (Cloud Run — update, don’t wipe)

```powershell
gcloud run services update blyp-live-service `
  --region us-central1 `
  --project blyp-master `
  --update-env-vars "TREASURE_CHEST_ENABLED=1,TREASURE_CHEST_BASE_COINS=15,TREASURE_CHEST_BONUS_COINS=10"
```

## How to test

1. Verified account: `GET /economy/treasure-chest` → `verified:true`, `claimableBase:15`
2. Unverified: `POST .../claim` → 403 `not_verified`
3. Claim twice same UTC day → second response `alreadyClaimed:true`, `reward:0`
4. Bonus without video → 409 `video_post_required`
5. Post video same UTC day → `POST .../bonus` credits once; replay idempotent
6. Unit: `cd backend/blyp-live-service && npm test` (includes `treasureChestLogic.test.js`)

## IAP freeze

Does **not** edit Play SKUs, `iapCatalog`, `BlypCoinService`, CoinStore, or BuyCoinsOverlay. Credits via live-service ledger only.
