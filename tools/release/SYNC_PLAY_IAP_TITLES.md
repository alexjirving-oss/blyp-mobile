# Sync Play Console IAP titles to grants (no oversell)

Authoritative **coin grants** live in `backend/blyp-live-service/src/economy/iapCatalog.ts`
(`coinsGranted` + `playTitle`). App labels use `src/services/BlypCoinService.js`
`getCoinPackages().coins`. SKUs must match products already configured in
Google Play Console → Monetize → In-app products.

**Store prices:** Google Play Billing is the source of truth for what the user
is charged and for the wallet UI when `getAndroidProductDetails` returns
`formattedPrice`. Local `price` fields in the client catalog are **fallback
only** (offline / non-Android). Do **not** invent a parallel GBP table or drop
Play overlays that disagree with a local catalog — align the app to existing
Play products; do not ask Alex to re-price from scratch if products already exist.

| SKU (legacy id OK) | Grant / Play title | Notes |
|---|---|---|
| blyp.android.proof.coinpack.100 | 100 coins | existing |
| blyp.android.coinpack.550 | 500 coins | legacy SKU id |
| blyp.android.coinpack.1150 | 1000 coins | legacy SKU id |
| blyp.android.coinpack.2000 | 2000 coins | mid pack (new) |
| blyp.android.coinpack.3000 | 2500 coins | legacy SKU id |
| blyp.android.coinpack.6500 | 5000 coins | legacy SKU id |
| blyp.android.coinpack.10000 | 10000 coins | large pack (new) |

In Play Console → Monetize → In-app products, set each product **Title** to the
grant string above (not 550/1150/3000/6500). SKU ids may remain legacy.
Prices stay whatever is already configured in Console for those SKUs; new packs
use suggested GBP/USD base prices only as create defaults — Play remains SoT.

Service account: `android-service-account.json` or `C:\keys\eas-play-publisher.json`
(never commit).

## Automation

```powershell
# List / create missing / sync titles (oneTimeProducts API)
node .\tools\release\sync_play_iap_products.mjs
# Dry-run:
node .\tools\release\sync_play_iap_products.mjs --dry-run
```

Uses Android Publisher `oneTimeProducts` (legacy `inappproducts` API returns
migrate error). Creates missing SKUs via `oneTimeProducts:batchUpdate`
(`allowMissing` + per-request `regionsVersion`), activates DRAFT purchase
options via `purchaseOptions:batchUpdateStates`, and syncs listings so
titles/descriptions match grants (no oversell wording).
