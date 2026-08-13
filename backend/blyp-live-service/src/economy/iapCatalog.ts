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
 * coins_granted = website BASE only (1 coin = 1p GBP). App never grants web +15% bonus.
 * Play GB price must be grant × £0.01 (from grant, never SKU digits). See
 * tools/release/SYNC_PLAY_IAP_TITLES.md + sync_play_iap_products.mjs.
 * SKU product ids may keep legacy Play names (.550 etc.); titles/grants are base.
 * Client packs in src/services/BlypCoinService.js must match these grants.
 * priceUsd is a numeric fallback hint aligned to the same 1p/coin pound amounts
 * (display-before-store only). Play / App Store formattedPrice remains SoT.
 */

export type IapPlatform = 'ANDROID' | 'IOS';

export type IapCatalogEntry = {
  platform: IapPlatform;
  sku: string;
  coinsGranted: number;
  /** Must match Play Console / App Store product title (no oversell). */
  playTitle: string;
  label: string;
  priceUsd: number;
};

export const ANDROID_IAP_CATALOG: ReadonlyArray<IapCatalogEntry> = Object.freeze([
  { platform: 'ANDROID', sku: 'blyp.android.proof.coinpack.100', coinsGranted: 100, playTitle: '100 coins', label: '100 coins', priceUsd: 1.0 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.550', coinsGranted: 500, playTitle: '500 coins', label: '500 coins', priceUsd: 5.0 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.1150', coinsGranted: 1000, playTitle: '1000 coins', label: '1000 coins', priceUsd: 10.0 },
  /** Mid pack between 1000 and 2500 grants (fills ladder gap for Baby Lion / mid gifts). */
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.2000', coinsGranted: 2000, playTitle: '2000 coins', label: '2000 coins', priceUsd: 20.0 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.3000', coinsGranted: 2500, playTitle: '2500 coins', label: '2500 coins', priceUsd: 25.0 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.6500', coinsGranted: 5000, playTitle: '5000 coins', label: '5000 coins', priceUsd: 50.0 },
  /** Larger pack above 5000 (covers Big Lion + extras in one purchase). */
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.10000', coinsGranted: 10000, playTitle: '10000 coins', label: '10000 coins', priceUsd: 100.0 },
]);

/** iOS App Store product IDs — mirror Android grants; create matching IAPs in App Store Connect. */
export const IOS_IAP_CATALOG: ReadonlyArray<IapCatalogEntry> = Object.freeze([
  { platform: 'IOS', sku: 'blyp.ios.proof.coinpack.100', coinsGranted: 100, playTitle: '100 coins', label: '100 coins', priceUsd: 1.0 },
  { platform: 'IOS', sku: 'blyp.ios.coinpack.550', coinsGranted: 500, playTitle: '500 coins', label: '500 coins', priceUsd: 5.0 },
  { platform: 'IOS', sku: 'blyp.ios.coinpack.1150', coinsGranted: 1000, playTitle: '1000 coins', label: '1000 coins', priceUsd: 10.0 },
  { platform: 'IOS', sku: 'blyp.ios.coinpack.2000', coinsGranted: 2000, playTitle: '2000 coins', label: '2000 coins', priceUsd: 20.0 },
  { platform: 'IOS', sku: 'blyp.ios.coinpack.3000', coinsGranted: 2500, playTitle: '2500 coins', label: '2500 coins', priceUsd: 25.0 },
  { platform: 'IOS', sku: 'blyp.ios.coinpack.6500', coinsGranted: 5000, playTitle: '5000 coins', label: '5000 coins', priceUsd: 50.0 },
  { platform: 'IOS', sku: 'blyp.ios.coinpack.10000', coinsGranted: 10000, playTitle: '10000 coins', label: '10000 coins', priceUsd: 100.0 },
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
