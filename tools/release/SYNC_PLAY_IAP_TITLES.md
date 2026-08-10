# Sync Play Console IAP titles to grants (no oversell)

Authoritative grants live in `backend/blyp-live-service/src/economy/iapCatalog.ts`
(`coinsGranted` + `playTitle`). App labels use `src/services/BlypCoinService.js`
`getCoinPackages().coins`.

| SKU (legacy id OK) | Grant / Play title |
|---|---|
| blyp.android.proof.coinpack.100 | 100 coins |
| blyp.android.coinpack.550 | 500 coins |
| blyp.android.coinpack.1150 | 1000 coins |
| blyp.android.coinpack.3000 | 2500 coins |
| blyp.android.coinpack.6500 | 5000 coins |

In Play Console → Monetize → In-app products, set each product **Title** to the
grant string above (not 550/1150/3000/6500). SKU ids may remain legacy.

Service account: `android-service-account.json` or `C:\keys\eas-play-publisher.json`
(never commit). Optional future automation can call Android Publisher API
`inappproducts.update` using `playTitle` from the catalog.
