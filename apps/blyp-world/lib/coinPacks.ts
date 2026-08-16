/**
 * Web coin packs — GBP face value at 1 coin = 1 penny base, plus a web-only bonus.
 *
 * App IAP grants base only (strict 1p). Web Stripe grants base + bonusCoins.
 * Bonus ≈ +15% rounded to clean integers — labeled in UI, not framed as store-tax avoidance.
 */
export const WEB_COIN_PACKS = [
  {
    id: "web.coinpack.100",
    baseCoins: 100,
    bonusCoins: 15,
    coins: 115,
    label: "115 coins",
    priceGbp: 1,
    blurb: "100 base + 15 bonus coins",
  },
  {
    id: "web.coinpack.500",
    baseCoins: 500,
    bonusCoins: 75,
    coins: 575,
    label: "575 coins",
    priceGbp: 5,
    blurb: "500 base + 75 bonus coins",
  },
  {
    id: "web.coinpack.1000",
    baseCoins: 1000,
    bonusCoins: 150,
    coins: 1150,
    label: "1,150 coins",
    priceGbp: 10,
    blurb: "1,000 base + 150 bonus coins",
  },
  {
    id: "web.coinpack.2500",
    baseCoins: 2500,
    bonusCoins: 375,
    coins: 2875,
    label: "2,875 coins",
    priceGbp: 25,
    blurb: "2,500 base + 375 bonus coins",
  },
  {
    id: "web.coinpack.5000",
    baseCoins: 5000,
    bonusCoins: 750,
    coins: 5750,
    label: "5,750 coins",
    priceGbp: 50,
    blurb: "5,000 base + 750 bonus coins",
  },
] as const;

export type WebCoinPack = (typeof WEB_COIN_PACKS)[number];
