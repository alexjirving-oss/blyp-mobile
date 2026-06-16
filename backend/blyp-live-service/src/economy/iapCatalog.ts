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
 * coins_granted = total coins delivered to the wallet (base + bonus).
 * SKUs MUST match the Google Play in-app product IDs and the client coin packs
 * in src/services/BlypCoinService.js exactly.
 */

export type IapPlatform = 'ANDROID' | 'IOS';

export type IapCatalogEntry = {
  platform: IapPlatform;
  sku: string;
  coinsGranted: number;
  label: string;
  priceUsd: number;
};

export const ANDROID_IAP_CATALOG: ReadonlyArray<IapCatalogEntry> = Object.freeze([
  { platform: 'ANDROID', sku: 'blyp.android.proof.coinpack.100', coinsGranted: 100, label: '100 coins', priceUsd: 0.99 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.550', coinsGranted: 550, label: '500 + 50 bonus', priceUsd: 4.99 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.1150', coinsGranted: 1150, label: '1000 + 150 bonus', priceUsd: 9.99 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.3000', coinsGranted: 3000, label: '2500 + 500 bonus', priceUsd: 19.99 },
  { platform: 'ANDROID', sku: 'blyp.android.coinpack.6500', coinsGranted: 6500, label: '5000 + 1500 bonus', priceUsd: 39.99 },
]);

export const IAP_CATALOG: ReadonlyArray<IapCatalogEntry> = Object.freeze([
  ...ANDROID_IAP_CATALOG,
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
