/** Web coin packs — same grants as Play IAP catalog (web Stripe SKUs). */
export const WEB_COIN_PACKS = [
  {
    id: "web.coinpack.100",
    coins: 100,
    label: "100 coins",
    priceUsd: 0.99,
    blurb: "Starter pack",
  },
  {
    id: "web.coinpack.550",
    coins: 550,
    label: "550 coins",
    priceUsd: 4.99,
    blurb: "500 + 50 bonus",
  },
  {
    id: "web.coinpack.1150",
    coins: 1150,
    label: "1,150 coins",
    priceUsd: 9.99,
    blurb: "1000 + 150 bonus",
  },
  {
    id: "web.coinpack.3000",
    coins: 3000,
    label: "3,000 coins",
    priceUsd: 19.99,
    blurb: "2500 + 500 bonus",
  },
  {
    id: "web.coinpack.6500",
    coins: 6500,
    label: "6,500 coins",
    priceUsd: 39.99,
    blurb: "5000 + 1500 bonus",
  },
] as const;
