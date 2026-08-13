# Sync Play Console IAP titles + GBP prices (1p/coin)

Authoritative grants + prices live in `backend/blyp-live-service/src/economy/iapCatalog.ts`
(`coinsGranted`, `playTitle`, `priceGbp`). App labels/prices use
`src/services/BlypCoinService.js` `getCoinPackages()` — **1 coin = £0.01**.

| SKU (legacy id OK) | Grant / Play title | Play default price (GBP) |
|---|---|---|
| blyp.android.proof.coinpack.100 | 100 coins | **£1.00** |
| blyp.android.coinpack.550 | 500 coins | **£5.00** |
| blyp.android.coinpack.1150 | 1000 coins | **£10.00** |
| blyp.android.coinpack.3000 | 2500 coins | **£25.00** |
| blyp.android.coinpack.6500 | 5000 coins | **£50.00** |

In Play Console → Monetize → In-app products:

1. Set each product **Title** to the grant string above (not 550/1150/3000/6500).
2. Set **default price (GBP)** to the exact amount in the table (not £0.99 / £4.99).
3. SKU ids may remain legacy.

Until Play Console prices match, Google’s purchase sheet may still show the old
store price even though the Blyp wallet UI shows catalog GBP.

Service account: `android-service-account.json` or `C:\keys\eas-play-publisher.json`
(never commit). Optional future automation can call Android Publisher API
`inappproducts.update` using `playTitle` / `priceGbp` from the catalog.
