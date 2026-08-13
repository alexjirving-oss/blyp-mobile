/**
 * Authoritative, server-side IAP product catalog.
 *
 * This is the single source of truth for how many coins each store SKU grants.
 * It is consumed in two places:
 *   1) schema.ts seeds the `iap_products` table from it on startup.
 *   2) economyService.verifyIapPurchaseAndGrant falls back to it (and self-heals
 *      the table) if a row is somehow missing — e.g. the seed never ran on an
 *      older deployment. This guarantees a verified Google Play purchase can
 *      always resolve a grant instead of failing with NOT_FOUND.
 *
 * coins_granted = website BASE only (1 coin = £0.01 / 1p). App never grants web +15% bonus.
 * SKU product ids may keep legacy Play names (.550 etc.); titles/grants are base.
 * Client packs in src/services/BlypCoinService.js must match these grants + GBP prices.
 *
 * Play Console default prices (GBP) MUST match priceGbp or Google will charge a
 * different amount than the in-app catalog shows.
 */

export type IapPlatform = 'ANDROID' | 'IOS';

export type IapCatalogEntry = {
  platform: IapPlatform;
  sku: string;
  coinsGranted: number;
  /** Must match Play Console / App Store product title (no oversell). */
  playTitle: string;
  label: string;
  /** Exact GBP at 1p/coin (100 coins = £1.00). */
  priceGbp: number;
};

export const ANDROID_IAP_CATALOG: ReadonlyArray<IapCatalogEntry> = Object.freeze([
  { platform: 'ANDROID', sku: 'blyp.android.proof.coinpack.100', coinsGranted: 100, playTitle: '100 coins', label: '100 coins', priceGbp: 1.0 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.550', coinsGranted: 500, playTitle: '500 coins', label: '500 coins', priceGbp: 5.0 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.1150', coinsGranted: 1000, playTitle: '1000 coins', label: '1000 coins', priceGbp: 10.0 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.3000', coinsGranted: 2500, playTitle: '2500 coins', label: '2500 coins', priceGbp: 25.0 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.6500', coinsGranted: 5000, playTitle: '5000 coins', label: '5000 coins', priceGbp: 50.0 },
]);

/** iOS App Store product IDs — mirror Android grants; create matching IAPs in App Store Connect. */
export const IOS_IAP_CATALOG: ReadonlyArray<IapCatalogEntry> = Object.freeze([
  { platform: 'IOS', sku: 'blyp.ios.proof.coinpack.100', coinsGranted: 100, playTitle: '100 coins', label: '100 coins', priceGbp: 1.0 },
  { platform: 'IOS', sku: 'blyp.ios.coinpack.550', coinsGranted: 500, playTitle: '500 coins', label: '500 coins', priceGbp: 5.0 },
  { platform: 'IOS', sku: 'blyp.ios.coinpack.1150', coinsGranted: 1000, playTitle: '1000 coins', label: '1000 coins', priceGbp: 10.0 },
  { platform: 'IOS', sku: 'blyp.ios.coinpack.3000', coinsGranted: 2500, playTitle: '2500 coins', label: '2500 coins', priceGbp: 25.0 },
  { platform: 'IOS', sku: 'blyp.ios.coinpack.6500', coinsGranted: 5000, playTitle: '5000 coins', label: '5000 coins', priceGbp: 50.0 },
]);

export const IAP_CATALOG: ReadonlyArray<IapCatalogEntry> = Object.freeze([
  ...ANDROID_IAP_CATALOG,
  ...IOS_IAP_CATALOG,
]);

/**
 * Resolve a catalog entry for a given platform + sku. Returns null when the SKU
 * is not part of the trusted server-side catalog (never trust client amounts).
 */
export function findIapCatalogEntry(platform: string, sku: string): IapCatalogEntry | null {
  const p = String(platform || '').trim().toUpperCase();
  const s = String(sku || '').trim();
  if (!p || !s) return null;
  return IAP_CATALOG.find((e) => e.platform === p && e.sku === s) || null;
}
