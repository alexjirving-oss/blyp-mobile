#!/usr/bin/env node
/**
 * Sync Android coin packs to Google Play Console (oneTimeProducts API).
 *
 * - Creates missing SKUs from the Android IAP ladder below (batchUpdate + allowMissing)
 * - Activates DRAFT purchase options (purchaseOptions:batchUpdateStates)
 * - PATCHes listings so titles/descriptions match grants (no oversell wording)
 * - Does NOT rewrite prices on existing products (Play remains SoT)
 *
 * Auth: android-service-account.json (repo root) or C:\keys\eas-play-publisher.json
 * Never prints key contents.
 *
 * Usage:
 *   node tools/release/sync_play_iap_products.mjs
 *   node tools/release/sync_play_iap_products.mjs --dry-run
 */

import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_NAME = 'com.blyp.mobile';
const DRY_RUN = process.argv.includes('--dry-run');
const REGIONS_VERSION = { version: '2025/03' };

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
    // Create defaults only — Play Billing remains the charged price SoT.
    gbp: { currencyCode: 'GBP', units: '14', nanos: 990000000 },
    usd: { currencyCode: 'USD', units: '14', nanos: 990000000 },
    eur: { currencyCode: 'EUR', units: '14', nanos: 990000000 },
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
    gbp: { currencyCode: 'GBP', units: '69', nanos: 990000000 },
    usd: { currencyCode: 'USD', units: '69', nanos: 990000000 },
    eur: { currencyCode: 'EUR', units: '69', nanos: 990000000 },
  },
];

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

function createBody(pack) {
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
        regionalPricingAndAvailabilityConfigs: [
          {
            regionCode: 'GB',
            price: pack.gbp,
            availability: 'AVAILABLE',
          },
        ],
        newRegionsConfig: {
          usdPrice: pack.usd,
          eurPrice: pack.eur,
          availability: 'AVAILABLE',
        },
      },
    ],
  };
}

async function main() {
  const keyFile = resolveKeyFile();
  console.log(`[sync-play-iap] keyFile=${path.basename(keyFile)} package=${PACKAGE_NAME} dryRun=${DRY_RUN}`);

  const auth = new GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = tokenResult?.token;
  if (!token) throw new Error('Failed to obtain access token');

  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/oneTimeProducts`;

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

  const listed = await api('GET', base);
  if (listed.status !== 200) {
    console.error('[sync-play-iap] LIST failed', listed.status, JSON.stringify(listed.json).slice(0, 500));
    process.exit(1);
  }
  const existing = new Map(
    (listed.json.oneTimeProducts || []).map((p) => [String(p.productId || ''), p])
  );
  console.log(`[sync-play-iap] existing=${existing.size}`);

  const results = [];
  const toActivate = [];

  for (const pack of ANDROID_PACKS) {
    const current = existing.get(pack.sku);
    const has = !!current;

    if (!has && pack.create) {
      console.log(`[sync-play-iap] CREATE ${pack.sku} → ${pack.coinsGranted} coins`);
      if (DRY_RUN) {
        results.push({ sku: pack.sku, action: 'create-dry-run' });
        continue;
      }
      const created = await api('POST', `${base}:batchUpdate`, {
        requests: [
          {
            oneTimeProduct: createBody(pack),
            updateMask: 'listings,purchaseOptions,taxAndComplianceSettings',
            allowMissing: true,
            latencyTolerance: 'PRODUCT_UPDATE_LATENCY_TOLERANCE_LATENCY_TOLERANT',
            regionsVersion: REGIONS_VERSION,
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
      results.push({ sku: pack.sku, action: 'created', state });
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
    if (needsTitle) {
      console.log(
        `[sync-play-iap] TITLE sync ${pack.sku}: "${curListing.title}" → "${nextListing.title}"`
      );
      if (!DRY_RUN) {
        const patched = await api('POST', `${base}:batchUpdate`, {
          requests: [
            {
              oneTimeProduct: {
                packageName: PACKAGE_NAME,
                productId: pack.sku,
                listings: [nextListing],
              },
              updateMask: 'listings',
              allowMissing: false,
              regionsVersion: REGIONS_VERSION,
            },
          ],
        });
        if (patched.status !== 200) {
          console.error(
            `[sync-play-iap] TITLE sync failed ${pack.sku}`,
            patched.status,
            JSON.stringify(patched.json).slice(0, 800)
          );
          results.push({ sku: pack.sku, action: 'title-sync-failed', status: patched.status });
        } else {
          results.push({ sku: pack.sku, action: 'title-synced' });
        }
      } else {
        results.push({ sku: pack.sku, action: 'title-sync-dry-run' });
      }
    } else {
      results.push({ sku: pack.sku, action: 'title-ok' });
    }

    const state = current.purchaseOptions?.[0]?.state;
    const optionId = current.purchaseOptions?.[0]?.purchaseOptionId || pack.purchaseOptionId;
    if (state && state !== 'ACTIVE') {
      toActivate.push({ ...pack, purchaseOptionId: optionId });
    }
  }

  if (toActivate.length) {
    console.log(`[sync-play-iap] ACTIVATE ${toActivate.map((p) => p.sku).join(', ')}`);
    if (!DRY_RUN) {
      const activated = await api(
        'POST',
        `${base}/-/purchaseOptions:batchUpdateStates`,
        {
          requests: toActivate.map((pack) => ({
            activatePurchaseOptionRequest: {
              packageName: PACKAGE_NAME,
              productId: pack.sku,
              purchaseOptionId: pack.purchaseOptionId,
            },
          })),
        }
      );
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
  const finalProducts = (finalList.json.oneTimeProducts || []).map((p) => {
    const listing = (p.listings || [])[0] || {};
    return {
      productId: p.productId,
      title: listing.title,
      state: (p.purchaseOptions || [])[0]?.state,
    };
  });
  console.log('[sync-play-iap] FINAL');
  for (const row of finalProducts.sort((a, b) => String(a.productId).localeCompare(String(b.productId)))) {
    console.log(`  ${row.productId} | ${row.title} | ${row.state}`);
  }
  console.log('[sync-play-iap] ACTIONS', JSON.stringify(results));
}

main().catch((err) => {
  console.error('[sync-play-iap] FATAL', err?.message || String(err));
  process.exit(1);
});
