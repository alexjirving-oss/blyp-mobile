import { Platform } from 'react-native';
import { getEconomyWallet, verifyAndroidIapPurchase } from '../api/economyLiveApi';
import { consumePurchase, queryPurchases } from '../services/AndroidPlayBillingService';
import BlypCoinService from '../services/BlypCoinService';
import { emitWalletUpdated } from './walletEvents';

const ENABLE_PURCHASES =
  String(process.env.EXPO_PUBLIC_ENABLE_PURCHASES || '') === '1' ||
  String(process.env.EXPO_PUBLIC_ENABLE_PURCHASES || '').toLowerCase() === 'true';

let inFlight = null;

/**
 * Re-verify + consume any Google Play coin packs that are owned but not yet
 * granted (or were granted but never consumed). Safe to call often — backend
 * dedupes on purchase token. Returns true if any purchase was recovered.
 */
export async function recoverPendingAndroidIapPurchases() {
  if (Platform.OS !== 'android') return false;
  if (!ENABLE_PURCHASES) return false;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const packages = BlypCoinService.getCoinPackages?.() || [];
      const validSkus = new Set(
        (packages || []).map((p) => String(p?.sku || '').trim()).filter(Boolean),
      );
      if (validSkus.size === 0) {
        validSkus.add('blyp.android.proof.coinpack.100');
      }

      const owned = await queryPurchases();
      if (!Array.isArray(owned) || owned.length === 0) return false;

      let recoveredAny = false;
      for (const p of owned) {
        const sku = String(p?.productId || '').trim();
        const token = String(p?.purchaseToken || '').trim();
        if (!sku || !token || !validSkus.has(sku) || Number(p?.purchaseState) !== 1) continue;
        try {
          const verification = await verifyAndroidIapPurchase({
            idempotencyKey: `iap-android:${sku}:${token}`,
            platform: 'ANDROID',
            sku,
            storeTransactionId: token,
            purchaseToken: token,
          });
          await consumePurchase(token);
          recoveredAny = true;
          if (verification?.wallet) emitWalletUpdated(verification.wallet);
        } catch (err) {
          console.warn('[IAP_RECOVERY] failed', sku, err?.message || String(err));
        }
      }

      if (recoveredAny) {
        try {
          const wallet = await getEconomyWallet();
          emitWalletUpdated(wallet);
        } catch {
          /* ignore */
        }
      }
      return recoveredAny;
    } catch (e) {
      console.warn('[IAP_RECOVERY] sweep failed', e?.message || String(e));
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
