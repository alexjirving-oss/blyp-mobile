# Sync Play Console IAP titles + 1p/coin GBP prices

Authoritative **coin grants** live in `backend/blyp-live-service/src/economy/iapCatalog.ts`
(`coinsGranted` + `playTitle`). App labels use `src/services/BlypCoinService.js`
`getCoinPackages().coins`. SKUs must match products already configured in
Google Play Console → Monetize → In-app products.

## Pricing lock (do not drift)

**1 coin = 1 penny GBP.** Price from **grant amount**, never from the SKU digit string
(e.g. `.550` / `.3000` are legacy ids — grants are 500 / 2500).

| Grant | Required GB price |
|------:|------------------:|
| 100 | £1.00 |
| 500 | £5.00 |
| 1000 | £10.00 |
| 2000 | £20.00 |
| 2500 | £25.00 |
| 5000 | £50.00 |
| 10000 | £100.00 |

`tools/release/sync_play_iap_products.mjs` enforces this: sets **GB** to
`coinsGranted × £0.01` exactly, then uses `pricing:convertRegionPrices` for other
regions / new-region USD+EUR (Autoconvert equivalent). Convert may tax-charm GB;
the script always **overrides GB** back to the exact grant price.

**Store prices:** Google Play Billing remains the source of truth for what the user
is charged and for the wallet UI when `getAndroidProductDetails` returns
`formattedPrice`. Local `price` fields in the client catalog are **fallback only**
(offline / non-Android) and should match the same 1p/coin GBP amounts for
display-before-Play. Do **not** invent a lock that ignores Play `formattedPrice`
when Play returns.

| SKU (legacy id OK) | Grant / Play title | Required GBP |
|---|---|---:|
| blyp.android.proof.coinpack.100 | 100 coins | £1.00 |
| blyp.android.coinpack.550 | 500 coins | £5.00 |
| blyp.android.coinpack.1150 | 1000 coins | £10.00 |
| blyp.android.coinpack.2000 | 2000 coins | £20.00 |
| blyp.android.coinpack.3000 | 2500 coins | £25.00 |
| blyp.android.coinpack.6500 | 5000 coins | £50.00 |
| blyp.android.coinpack.10000 | 10000 coins | £100.00 |

In Play Console → Monetize → In-app products, set each product **Title** to the
grant string above (not 550/1150/3000/6500). SKU ids may remain legacy.

Service account: `android-service-account.json` or `C:\keys\eas-play-publisher.json`
(never commit).

## Automation

```powershell
# List / create missing / sync titles + 1p/coin GB prices (oneTimeProducts API)
node .\tools\release\sync_play_iap_products.mjs
# Dry-run:
node .\tools\release\sync_play_iap_products.mjs --dry-run
# List current GB vs required only:
node .\tools\release\sync_play_iap_products.mjs --list-only
```

Uses Android Publisher `oneTimeProducts` (legacy `inappproducts` API returns
migrate error). Creates missing SKUs via `oneTimeProducts:batchUpdate`
(`allowMissing` + per-request `regionsVersion`), activates DRAFT purchase
options via `purchaseOptions:batchUpdateStates`, syncs listings so
titles/descriptions match grants, and syncs regional prices to the 1p/coin rule.

After a Play price change, Fold / Play Billing may need a store refresh (kill app /
clear Play Store cache) before `formattedPrice` updates on device. No app bake is
required for price-only Console changes.
