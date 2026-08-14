/**
 * Authoritative web (Stripe) coin pack catalog.
 *
 * Rule (product-locked):
 * - 1 coin = 1 penny face value on the base grant (same as app IAP base).
 * - Web purchases grant base + ~15% bonus coins (web perk). App IAP is base-only.
 *
 * Never trust client-supplied coin amounts — resolve packId here.
 */

export type WebCoinPackEntry = {
  packId: string;
  baseCoins: number;
  bonusCoins: number;
  /** Total credited = base + bonus */
  coinsGranted: number;
  label: string;
  priceGbp: number;
};

export const WEB_COIN_CATALOG: ReadonlyArray<WebCoinPackEntry> = Object.freeze([
  {
    packId: 'web.coinpack.100',
    baseCoins: 100,
    bonusCoins: 15,
    coinsGranted: 115,
    label: '115 coins',
    priceGbp: 1,
  },
  {
    packId: 'web.coinpack.500',
    baseCoins: 500,
    bonusCoins: 75,
    coinsGranted: 575,
    label: '575 coins',
    priceGbp: 5,
  },
  {
    packId: 'web.coinpack.1000',
    baseCoins: 1000,
    bonusCoins: 150,
    coinsGranted: 1150,
    label: '1,150 coins',
    priceGbp: 10,
  },
  {
    packId: 'web.coinpack.2500',
    baseCoins: 2500,
    bonusCoins: 375,
    coinsGranted: 2875,
    label: '2,875 coins',
    priceGbp: 25,
  },
  {
    packId: 'web.coinpack.5000',
    baseCoins: 5000,
    bonusCoins: 750,
    coinsGranted: 5750,
    label: '5,750 coins',
    priceGbp: 50,
  },
]);

export function findWebCoinPack(packId: string): WebCoinPackEntry | null {
  const id = String(packId || '').trim();
  if (!id) return null;
  return WEB_COIN_CATALOG.find((p) => p.packId === id) || null;
}
