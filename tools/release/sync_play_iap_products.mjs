#!/usr/bin/env node
/**
 * Sync Android coin packs to Google Play Console (oneTimeProducts API).
 *
 * Pricing rule (locked): **1 coin = 1 penny GBP**.
 * GB price = coinsGranted × £0.01 exactly (from grant amount, never from SKU digit string).
 * Example: 100→£1.00, 500→£5.00, 1000→£10.00, 2000→£20, 2500→£25, 5000→£50, 10000→£100.
 *
 * - Creates missing SKUs from the Android IAP ladder below (batchUpdate + allowMissing)
 * - Activates DRAFT purchase options (purchaseOptions:batchUpdateStates)
 * - PATCHes listings so titles/descriptions match grants (no oversell wording)
 * - Syncs regional prices: exact GB from grant; other regions via monetization.convertRegionPrices
 *   (Play Autoconvert equivalent). GB is always forced exact after convert (convert may charm).
 *
 * Auth: android-service-account.json (repo root) or C:\keys\eas-play-publisher.json
 * Never prints key contents.
 *
 * Usage:
 *   node tools/release/sync_play_iap_products.mjs
 *   node tools/release/sync_play_iap_products.mjs --dry-run
 *   node tools/release/sync_play_iap_products.mjs --list-only
 */

import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_NAME = 'com.blyp.mobile';
const DRY_RUN = process.argv.includes('--dry-run');
const LIST_ONLY = process.argv.includes('--list-only');
const REGIONS_VERSION = { version: '2025/03' };

/** Pennies per coin in GBP (Alex lock: 1p / coin). */
const GBP_PENNIES_PER_COIN = 1;

/** Must stay aligned with backend/.../iapCatalog.ts ANDROID_IAP_CATALOG. */
const ANDROID_PACKS = [
  {
    sku: 'blyp.android.proof.coinpack.100',
    coinsGranted: 100,
    playTitle: '100 coins',
    purchaseOptionId: 'buy-100-coins',
    create: false,
  },
  {
    sku: 'blyp.android.coinpack.550',
    coinsGranted: 500,
    playTitle: '500 coins',
    purchaseOptionId: 'buy',
    create: false,
  },
  {
    sku: 'blyp.android.coinpack.1150',
    coinsGranted: 1000,
    playTitle: '1000 coins',
    purchaseOptionId: 'buy',
    create: false,
  },
  {
    sku: 'blyp.android.coinpack.2000',
    coinsGranted: 2000,
    playTitle: '2000 coins',
    purchaseOptionId: 'buy',
    create: true,
  },
  {
    sku: 'blyp.android.coinpack.3000',
    coinsGranted: 2500,
    playTitle: '2500 coins',
    purchaseOptionId: 'buy',
    create: false,
  },
  {
    sku: 'blyp.android.coinpack.6500',
    coinsGranted: 5000,
    playTitle: '5000 coins',
    purchaseOptionId: 'buy',
    create: false,
  },
  {
    sku: 'blyp.android.coinpack.10000',
    coinsGranted: 10000,
    playTitle: '10000 coins',
    purchaseOptionId: 'buy',
    create: true,
  },
];

/** Exact GBP Money from grant: coins × 1p. Never derive from SKU digits. */
function gbpMoneyFromGrant(coinsGranted) {
  const pennies = Number(coinsGranted) * GBP_PENNIES_PER_COIN;
  if (!Number.isFinite(pennies) || pennies < 0 || Math.floor(pennies) !== pennies) {
    throw new Error(`Invalid grant for GBP pricing: ${coinsGranted}`);
  }
  const units = Math.floor(pennies / 100);
  const nanos = (pennies % 100) * 10_000_000;
  return { currencyCode: 'GBP', units: String(units), nanos };
}

function formatMoney(m) {
  if (!m?.currencyCode) return 'n/a';
  const units = Number(m.units || 0);
  const nanos = Number(m.nanos || 0);
  const whole = units + nanos / 1e9;
  return `${m.currencyCode} ${whole.toFixed(2)}`;
}

function moneyEquals(a, b) {
  if (!a || !b) return false;
  return (
    String(a.currencyCode) === String(b.currencyCode) &&
    String(a.units || '0') === String(b.units || '0') &&
    Number(a.nanos || 0) === Number(b.nanos || 0)
  );
}

function resolveKeyFile() {
  const candidates = [
    path.join(REPO_ROOT, 'android-service-account.json'),
    'C:\\keys\\eas-play-publisher.json',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Missing Play service account JSON. Place at android-service-account.json or C:\\keys\\eas-play-publisher.json'
  );
}

function listingFor(pack) {
  const n = pack.coinsGranted;
  return {
    languageCode: 'en-GB',
    title: pack.playTitle,
    description: `${n} Blyp coins for gifts and in-app features. Grants ${n} coins.`,
  };
}

function createBody(pack, regionalConfigs, newRegionsConfig) {
  return {
    packageName: PACKAGE_NAME,
    productId: pack.sku,
    listings: [listingFor(pack)],
    taxAndComplianceSettings: {
      regionalProductAgeRatingInfos: [
        { regionCode: 'US', productAgeRatingTier: 'PRODUCT_AGE_RATING_TIER_EVERYONE' },
      ],
    },
    purchaseOptions: [
      {
        purchaseOptionId: pack.purchaseOptionId,
        // Created as DRAFT; activated via purchaseOptions:batchUpdateStates.
        state: 'ACTIVE',
        buyOption: { legacyCompatible: true },
        regionalPricingAndAvailabilityConfigs: regionalConfigs,
        newRegionsConfig,
      },
    ],
  };
}

function gbPriceFromProduct(product) {
  const opt = (product?.purchaseOptions || [])[0] || {};
  const configs = opt.regionalPricingAndAvailabilityConfigs || [];
  const gb = configs.find((c) => c.regionCode === 'GB');
  return gb?.price || null;
}

async function main() {
  const keyFile = resolveKeyFile();
  console.log(
    `[sync-play-iap] keyFile=${path.basename(keyFile)} package=${PACKAGE_NAME} dryRun=${DRY_RUN} listOnly=${LIST_ONLY}`
  );
  console.log(
    `[sync-play-iap] RULE: 1 coin = ${GBP_PENNIES_PER_COIN}p GBP (price from coinsGranted, not SKU digits)`
  );

  const auth = new GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = tokenResult?.token;
  if (!token) throw new Error('Failed to obtain access token');

  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/oneTimeProducts`;
  const convertUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/pricing:convertRegionPrices`;

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    return { status: res.status, json };
  }

  async function buildPricingFromGrant(coinsGranted) {
    const gbpExact = gbpMoneyFromGrant(coinsGranted);
    const converted = await api('POST', convertUrl, { price: gbpExact });
    if (converted.status !== 200) {
      throw new Error(
        `convertRegionPrices failed (${converted.status}): ${JSON.stringify(converted.json).slice(0, 400)}`
      );
    }
    const map = converted.json.convertedRegionPrices || {};
    const regionalConfigs = Object.keys(map)
      .sort()
      .map((regionCode) => {
        const entry = map[regionCode];
        // Force GB to exact grant×£0.01 — convert may tax-charm (e.g. £5 → £5.99).
        const price = regionCode === 'GB' ? gbpExact : entry.price;
        return {
          regionCode,
          price,
          availability: 'AVAILABLE',
        };
      });
    if (!regionalConfigs.some((c) => c.regionCode === 'GB')) {
      regionalConfigs.push({ regionCode: 'GB', price: gbpExact, availability: 'AVAILABLE' });
    }
    const other = converted.json.convertedOtherRegionsPrice || {};
    const newRegionsConfig = {
      usdPrice: other.usdPrice || { currencyCode: 'USD', units: String(Math.floor(coinsGranted / 100)), nanos: 0 },
      eurPrice: other.eurPrice || { currencyCode: 'EUR', units: String(Math.floor(coinsGranted / 100)), nanos: 0 },
      availability: 'AVAILABLE',
    };
    const regionsVersion = converted.json.regionVersion || REGIONS_VERSION;
    return { gbpExact, regionalConfigs, newRegionsConfig, regionsVersion };
  }

  const listed = await api('GET', base);
  if (listed.status !== 200) {
    console.error('[sync-play-iap] LIST failed', listed.status, JSON.stringify(listed.json).slice(0, 500));
    process.exit(1);
  }
  const existing = new Map(
    (listed.json.oneTimeProducts || []).map((p) => [String(p.productId || ''), p])
  );
  console.log(`[sync-play-iap] existing=${existing.size}`);

  console.log('[sync-play-iap] BEFORE (GB vs required)');
  for (const pack of ANDROID_PACKS) {
    const required = gbpMoneyFromGrant(pack.coinsGranted);
    const current = existing.get(pack.sku);
    const gb = current ? gbPriceFromProduct(current) : null;
    const state = current?.purchaseOptions?.[0]?.state || 'MISSING';
    const ok = gb && moneyEquals(gb, required);
    console.log(
      `  ${pack.sku} | grant=${pack.coinsGranted} | GB=${formatMoney(gb)} | need=${formatMoney(required)} | ${state} | ${ok ? 'OK' : 'DRIFT'}`
    );
  }

  if (LIST_ONLY) {
    console.log('[sync-play-iap] list-only; exiting');
    return;
  }

  const results = [];
  const toActivate = [];

  for (const pack of ANDROID_PACKS) {
    const current = existing.get(pack.sku);
    const has = !!current;
    let pricing;
    try {
      pricing = await buildPricingFromGrant(pack.coinsGranted);
    } catch (err) {
      console.error(`[sync-play-iap] pricing build failed ${pack.sku}`, err?.message || err);
      results.push({ sku: pack.sku, action: 'pricing-build-failed', error: String(err?.message || err) });
      continue;
    }

    if (!has && pack.create) {
      console.log(
        `[sync-play-iap] CREATE ${pack.sku} → ${pack.coinsGranted} coins @ ${formatMoney(pricing.gbpExact)}`
      );
      if (DRY_RUN) {
        results.push({ sku: pack.sku, action: 'create-dry-run', gbp: formatMoney(pricing.gbpExact) });
        continue;
      }
      const created = await api('POST', `${base}:batchUpdate`, {
        requests: [
          {
            oneTimeProduct: createBody(pack, pricing.regionalConfigs, pricing.newRegionsConfig),
            updateMask: 'listings,purchaseOptions,taxAndComplianceSettings',
            allowMissing: true,
            latencyTolerance: 'PRODUCT_UPDATE_LATENCY_TOLERANCE_LATENCY_TOLERANT',
            regionsVersion: pricing.regionsVersion || REGIONS_VERSION,
          },
        ],
      });
      if (created.status !== 200) {
        console.error(
          `[sync-play-iap] CREATE failed ${pack.sku}`,
          created.status,
          JSON.stringify(created.json).slice(0, 800)
        );
        results.push({ sku: pack.sku, action: 'create-failed', status: created.status });
        continue;
      }
      const product = (created.json.oneTimeProducts || [])[0] || {};
      const state = product.purchaseOptions?.[0]?.state;
      console.log(`[sync-play-iap] CREATE ok ${pack.sku} state=${state}`);
      results.push({ sku: pack.sku, action: 'created', state, gbp: formatMoney(pricing.gbpExact) });
      existing.set(pack.sku, product);
      if (state !== 'ACTIVE') toActivate.push(pack);
      continue;
    }

    if (!has) {
      console.log(`[sync-play-iap] SKIP missing non-create ${pack.sku}`);
      results.push({ sku: pack.sku, action: 'missing-skipped' });
      continue;
    }

    const curListing =
      (current.listings || []).find((l) => l.languageCode === 'en-GB') ||
      (current.listings || [])[0] ||
      {};
    const nextListing = listingFor(pack);
    const needsTitle =
      String(curListing.title || '') !== nextListing.title ||
      String(curListing.description || '') !== nextListing.description;

    const opt = (current.purchaseOptions || [])[0] || {};
    const optionId = opt.purchaseOptionId || pack.purchaseOptionId;
    const gbNow = gbPriceFromProduct(current);
    const needsPrice = !moneyEquals(gbNow, pricing.gbpExact);

    const updateMaskParts = [];
    const oneTimeProduct = {
      packageName: PACKAGE_NAME,
      productId: pack.sku,
    };

    if (needsTitle) {
      console.log(
        `[sync-play-iap] TITLE sync ${pack.sku}: "${curListing.title}" → "${nextListing.title}"`
      );
      oneTimeProduct.listings = [nextListing];
      updateMaskParts.push('listings');
    }

    if (needsPrice) {
      console.log(
        `[sync-play-iap] PRICE sync ${pack.sku}: ${formatMoney(gbNow)} → ${formatMoney(pricing.gbpExact)} (grant=${pack.coinsGranted})`
      );
      oneTimeProduct.purchaseOptions = [
        {
          purchaseOptionId: optionId,
          buyOption: opt.buyOption || { legacyCompatible: true },
          regionalPricingAndAvailabilityConfigs: pricing.regionalConfigs,
          newRegionsConfig: pricing.newRegionsConfig,
        },
      ];
      updateMaskParts.push('purchaseOptions');
    }

    if (updateMaskParts.length) {
      if (!DRY_RUN) {
        const patched = await api('POST', `${base}:batchUpdate`, {
          requests: [
            {
              oneTimeProduct,
              updateMask: updateMaskParts.join(','),
              allowMissing: false,
              latencyTolerance: 'PRODUCT_UPDATE_LATENCY_TOLERANCE_LATENCY_TOLERANT',
              regionsVersion: pricing.regionsVersion || REGIONS_VERSION,
            },
          ],
        });
        if (patched.status !== 200) {
          console.error(
            `[sync-play-iap] PATCH failed ${pack.sku}`,
            patched.status,
            JSON.stringify(patched.json).slice(0, 800)
          );
          results.push({
            sku: pack.sku,
            action: 'patch-failed',
            status: patched.status,
            mask: updateMaskParts.join(','),
          });
        } else {
          const updated = (patched.json.oneTimeProducts || [])[0];
          if (updated) existing.set(pack.sku, updated);
          results.push({
            sku: pack.sku,
            action: needsPrice ? 'price-synced' : 'title-synced',
            gbp: formatMoney(pricing.gbpExact),
            mask: updateMaskParts.join(','),
          });
        }
      } else {
        results.push({
          sku: pack.sku,
          action: 'patch-dry-run',
          gbp: formatMoney(pricing.gbpExact),
          mask: updateMaskParts.join(','),
        });
      }
    } else {
      results.push({
        sku: pack.sku,
        action: 'price-ok',
        gbp: formatMoney(pricing.gbpExact),
      });
    }

    const state = current.purchaseOptions?.[0]?.state;
    if (state && state !== 'ACTIVE') {
      toActivate.push({ ...pack, purchaseOptionId: optionId });
    }
  }

  if (toActivate.length) {
    console.log(`[sync-play-iap] ACTIVATE ${toActivate.map((p) => p.sku).join(', ')}`);
    if (!DRY_RUN) {
      const activated = await api('POST', `${base}/-/purchaseOptions:batchUpdateStates`, {
        requests: toActivate.map((pack) => ({
          activatePurchaseOptionRequest: {
            packageName: PACKAGE_NAME,
            productId: pack.sku,
            purchaseOptionId: pack.purchaseOptionId,
          },
        })),
      });
      if (activated.status !== 200) {
        console.error(
          '[sync-play-iap] ACTIVATE failed',
          activated.status,
          JSON.stringify(activated.json).slice(0, 800)
        );
        results.push({ action: 'activate-failed', status: activated.status });
      } else {
        for (const p of activated.json.oneTimeProducts || []) {
          results.push({
            sku: p.productId,
            action: 'activated',
            state: p.purchaseOptions?.[0]?.state,
          });
        }
      }
    } else {
      results.push({ action: 'activate-dry-run', skus: toActivate.map((p) => p.sku) });
    }
  }

  const finalList = await api('GET', base);
  const finalMap = new Map(
    (finalList.json.oneTimeProducts || []).map((p) => [String(p.productId || ''), p])
  );
  console.log('[sync-play-iap] AFTER (GB vs required)');
  let allOk = true;
  for (const pack of ANDROID_PACKS) {
    const required = gbpMoneyFromGrant(pack.coinsGranted);
    const product = finalMap.get(pack.sku);
    const gb = product ? gbPriceFromProduct(product) : null;
    const state = product?.purchaseOptions?.[0]?.state || 'MISSING';
    const ok = gb && moneyEquals(gb, required) && state === 'ACTIVE';
    if (!ok) allOk = false;
    console.log(
      `  ${pack.sku} | grant=${pack.coinsGranted} | GB=${formatMoney(gb)} | need=${formatMoney(required)} | ${state} | ${ok ? 'PASS' : 'FAIL'}`
    );
  }
  console.log('[sync-play-iap] ACTIONS', JSON.stringify(results));
  console.log(`[sync-play-iap] 1p/coin lock: ${allOk ? 'CONFIRMED' : 'INCOMPLETE'}`);
  if (!allOk && !DRY_RUN) process.exit(2);
}

main().catch((err) => {
  console.error('[sync-play-iap] FATAL', err?.message || String(err));
  process.exit(1);
});
