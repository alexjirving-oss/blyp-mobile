import React, { useMemo, useRef, useState, useEffect } from 'react';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import BlypLogo, { BLYP_LOGO_GRADIENT_COLORS } from '../components/BlypLogo';
import { Alert, Dimensions, KeyboardAvoidingView, Linking, Modal, Platform, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';
import { COLORS } from '../styles/theme';
import {
  formatWithdrawalError,
  getEconomyWallet,
  getWithdrawConnectStatus,
  getWithdrawEligibility,
  makeIdempotencyKey,
  convertGemsToCoins,
  requestWithdrawGems,
  startWithdrawConnectOnboard,
  verifyAndroidIapPurchase,
} from '../api/economyLiveApi';
import { coinsFromGemsConvert, describeGemToCoinRate } from '../utils/gemToCoinConvert';
import { useAuth } from '../hooks/useCommon';
import { requireAccount } from '../services/guestSessionService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchAndroidPurchase, consumePurchase, getAndroidProductDetails } from '../services/AndroidPlayBillingService';
import { recoverPendingAndroidIapPurchases } from '../utils/recoverPendingAndroidIap';
import {
  ENABLE_PURCHASES,
  ENABLE_WITHDRAWALS,
  isClientEconomyMutationAllowed,
  shouldUseServerValidation
} from '../config/economyModel';
import { emitWalletUpdated, subscribeWalletUpdated } from '../utils/walletEvents';
import {
  getCachedWalletBalance,
  loadWalletBalanceFromStorage,
  setWalletBalanceCache,
} from '../services/walletBalanceCache';
import { shouldUseLiveServiceWallet } from '../utils/walletSource';

const { width } = Dimensions.get('window');

const ECONOMY_MUTATION_BLOCKED_BASE = Object.freeze({
  ok: false,
  blocked: true,
  code: 'ECONOMY_MUTATIONS_BLOCKED',
  reason: 'CLIENT_ECONOMY_MUTATIONS_DISABLED'
});

function getBlockedEconomyMutationResult(operation) {
  console.warn(`[ECONOMY][BLOCKED] ${operation}: EXPO_PUBLIC_ECONOMY_MUTATIONS_ENABLED is not enabled`);
  return {
    ...ECONOMY_MUTATION_BLOCKED_BASE,
    operation
  };
}

function isBlockedEconomyMutationResult(value) {
  return !!(value && value.blocked === true && value.code === 'ECONOMY_MUTATIONS_BLOCKED');
}

// Gem packages data
const getGemPackages = () => [
  {
    id: 'gems_1',
    gems: 50,
    bonus: 0,
    price: 0.99,
    icon: '\uD83D\uDC8E',
    popular: false
  },
  {
    id: 'gems_2',
    gems: 120,
    bonus: 20,
    price: 1.99,
    icon: '\uD83D\uDC8E',
    popular: true
  },
  {
    id: 'gems_3',
    gems: 300,
    bonus: 80,
    price: 4.99,
    icon: '\uD83D\uDC8E',
    popular: false
  },
  {
    id: 'gems_4',
    gems: 650,
    bonus: 200,
    price: 9.99,
    icon: '\uD83D\uDC8E',
    popular: false
  },
  {
    id: 'gems_5',
    gems: 1500,
    bonus: 600,
    price: 19.99,
    icon: '\uD83D\uDC8E',
    popular: false
  }
];

/**
 * @param {{
 *   navigation?: any,
 *   route?: any,
 *   embedded?: boolean,
 *   initialTab?: string,
 *   scrollToPackagesOnMount?: boolean,
 *   initialCoins?: number | null,
 *   initialGems?: number | null,
 * }} [props]
 */
const CoinStoreScreen = ({
  navigation,
  route = null,
  embedded = false,
  initialTab = 'coins',
  scrollToPackagesOnMount = false,
  initialCoins = null,
  initialGems = null,
} = {}) => {
  const insets = useSafeAreaInsets?.() || { top: 0, bottom: 0, left: 0, right: 0 };
  const scrollRef = useRef(null);
  const packagesSectionYRef = useRef(0);
  const withdrawResumeAtRef = useRef(0);

  const seedCoins = Number.isFinite(Number(initialCoins)) ? Number(initialCoins) : 0;
  const seedGems = Number.isFinite(Number(initialGems)) ? Number(initialGems) : 0;
  const [balance, setBalance] = useState(seedCoins);
  const [gemBalance, setGemBalance] = useState(seedGems);
  /** Cleared gems only (excludes pending) — cash withdraw debit this bucket. */
  const [gemAvailable, setGemAvailable] = useState(seedGems);
  const [loading, setLoading] = useState(false);
  const [balancesRefreshing, setBalancesRefreshing] = useState(false);
  const [selectedTab, setSelectedTab] = useState(initialTab || 'coins'); // 'coins' or 'gems'
  const [packages] = useState(BlypCoinService.getCoinPackages());
  const [gemPackages] = useState(() => getGemPackages());
  const purchasableCoinPackages = useMemo(() => {
    // Real IAP is Android-only for now — don't offer tappable packs on iOS.
    if (Platform.OS !== 'android') return [];
    const enabled = packages.filter((pkg) => String(pkg?.sku || '').trim().length > 0);
    return enabled.length > 0 ? enabled : packages;
  }, [packages]);
  const { uid, authReady, isAuthenticated } = useAuth();

  // Localized Play Store prices keyed by sku (e.g. "£1.00"). Falls back to
  // grant × £0.01 GBP when Play details unavailable (offline / non-Android).
  const [localizedPrices, setLocalizedPrices] = useState({});

  const formatGbpFallback = (price) => {
    const n = Number(price);
    if (!Number.isFinite(n)) return '£0.00';
    return `£${n.toFixed(2)}`;
  };

  const [overlayType, setOverlayType] = useState(null); // 'convert' | 'withdraw' | null
  const [overlayAmount, setOverlayAmount] = useState('');
  const [overlayError, setOverlayError] = useState('');
  const [withdrawMethod, setWithdrawMethod] = useState('paypal'); // 'paypal' | 'stripe'
  const [paypalEmail, setPaypalEmail] = useState('');
  const [stripeReady, setStripeReady] = useState(false);
  const headerTopPadding = useMemo(() => {
    if (embedded) return 12;
    return Math.max(12, (insets?.top || 0) + 12);
  }, [embedded, insets]);

  // Seed from parent / disk cache so Wallet never waits on Stripe or network.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!uid) return;
      const mem = getCachedWalletBalance(uid);
      if (mem && !cancelled) {
        setBalance(mem.coins);
        setGemBalance(mem.gems);
        return;
      }
      const disk = await loadWalletBalanceFromStorage(uid);
      if (!cancelled && disk) {
        setBalance(disk.coins);
        setGemBalance(disk.gems);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const closeOverlay = () => {
    setOverlayType(null);
    setOverlayAmount('');
    setOverlayError('');
  };

  const openConvertOverlay = () => {
    if (!uid) {
      Alert.alert('Error', 'Please log in first');
      return;
    }
    setOverlayType('convert');
    setOverlayAmount('');
    setOverlayError('');
  };

  const openWithdrawOverlay = async ({ fromResume = false } = {}) => {
    if (!uid) {
      Alert.alert('Error', 'Please log in first');
      return;
    }
    if (!ENABLE_WITHDRAWALS) {
      Alert.alert('Unavailable', 'Withdrawals are currently disabled.');
      return;
    }
    // Debounce deep-link + focus resume so we don't stack Connect alerts.
    if (fromResume) {
      const now = Date.now();
      if (now - withdrawResumeAtRef.current < 2000) return;
      withdrawResumeAtRef.current = now;
    }
    try {
      try {
        await getWithdrawConnectStatus();
      } catch {
        // Eligibility also refreshes Connect; continue.
      }
      const eligibility = await getWithdrawEligibility();
      const connect = eligibility?.connect || {};
      const stripeOk = !!connect.payoutsEnabled && !connect.needsOnboarding;
      setStripeReady(stripeOk);
      const savedPaypal = String(eligibility?.paypal?.savedEmail || '').trim();
      if (savedPaypal) setPaypalEmail(savedPaypal);

      // Prefer PayPal while Stripe Connect is in review / not ready.
      const preferPaypal = !stripeOk;
      setWithdrawMethod(preferPaypal ? 'paypal' : 'stripe');
      setOverlayType('withdraw');
      setOverlayAmount(String(eligibility.minPayoutGems || 1000));
      setOverlayError('');
    } catch (e) {
      const msg = e?.message || String(e);
      if (/WITHDRAWALS_DISABLED|STRIPE_NOT_CONFIGURED|PAYOUT_RAIL_NOT_CONFIGURED|disabled/i.test(msg)) {
        Alert.alert('Unavailable', 'Withdrawals are currently disabled on the server.');
        return;
      }
      // Still open PayPal path if eligibility fails for Connect-only reasons.
      setWithdrawMethod('paypal');
      setStripeReady(false);
      setOverlayType('withdraw');
      setOverlayAmount('1000');
      setOverlayError('');
      Alert.alert(
        'Withdraw',
        'Stripe bank payout may be unavailable right now. You can still request a PayPal withdrawal.',
      );
    }
  };

  const startStripeOnboard = async () => {
    try {
      const link = await startWithdrawConnectOnboard({
        returnUrl: 'https://blyp.world/withdraw/connect-return',
        refreshUrl: 'https://blyp.world/withdraw/connect-refresh',
      });
      if (link?.alreadyComplete || !link?.url) {
        openWithdrawOverlay();
        return;
      }
      await Linking.openURL(link.url);
    } catch (e) {
      const msg = e?.message || String(e);
      const code = e?.code || '';
      const needsPlatformSetup =
        code === 'STRIPE_CONNECT_SETUP_REQUIRED' ||
        /STRIPE_CONNECT_SETUP_REQUIRED|platform profile|questionnaire|Connect setup/i.test(msg);
      if (needsPlatformSetup) {
        Alert.alert(
          'Stripe Connect still in review',
          'Blyp Stripe Connect is not ready for bank payouts yet. Use PayPal withdraw instead (no Connect needed). When Stripe clears review, bank withdraw will work here too.',
          [
            { text: 'Use PayPal', onPress: () => setWithdrawMethod('paypal') },
            {
              text: 'Open Stripe',
              onPress: () => {
                Linking.openURL('https://dashboard.stripe.com/connect/accounts/overview').catch(() => {});
              },
            },
          ],
        );
        return;
      }
      Alert.alert('Connect failed', msg || 'Could not start Stripe onboarding');
    }
  };

  // Stripe Connect return deep link → force Connect status refresh, then resume withdraw.
  const connectReturnKey = `${route?.params?.openWithdraw ? '1' : '0'}:${route?.params?.withdrawReturn || ''}`;
  useEffect(() => {
    if (!route?.params?.openWithdraw || !uid) return undefined;
    let cancelled = false;
    (async () => {
      // Small delay so Stripe has a moment to settle account.updated before we retrieve.
      await new Promise((r) => setTimeout(r, 600));
      if (!cancelled) await openWithdrawOverlay({ fromResume: true });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectReturnKey, uid]);

  // App resume / screen focus after Connect: re-check status without requiring a fresh deep link.
  useEffect(() => {
    if (!navigation?.addListener || !uid || !ENABLE_WITHDRAWALS) return undefined;
    const unsub = navigation.addListener('focus', () => {
      if (String(route?.params?.withdrawReturn || '') !== 'connect-return') return;
      openWithdrawOverlay({ fromResume: true });
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, uid, route?.params?.withdrawReturn]);

  const refreshLiveWallet = async () => {
    try {
      if (shouldUseLiveServiceWallet()) {
        const wallet = await getEconomyWallet();
        const nextCoins = Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
        const nextAvailable = Number(wallet?.gemAvailable || 0);
        const nextPending = Number(wallet?.gemPending || 0);
        const nextGems = nextAvailable + nextPending;
        if (Number.isFinite(nextCoins)) setBalance(nextCoins);
        if (Number.isFinite(nextGems)) setGemBalance(nextGems);
        if (Number.isFinite(nextAvailable)) setGemAvailable(nextAvailable);
        if (uid && Number.isFinite(nextCoins) && Number.isFinite(nextGems)) {
          void setWalletBalanceCache(uid, { coins: nextCoins, gems: nextGems });
        }
        try { emitWalletUpdated(wallet); } catch { /* ignore */ }
        return;
      }
      if (!uid) return;
      const [coins, gems] = await Promise.all([
        BlypCoinService.getUserBalance(uid),
        GemService.getUserGems(uid),
      ]);
      const nextCoins = Number.isFinite(coins) ? coins : 0;
      const nextGems = Number.isFinite(gems) ? gems : 0;
      setBalance(nextCoins);
      setGemBalance(nextGems);
      void setWalletBalanceCache(uid, { coins: nextCoins, gems: nextGems });
    } catch (e) {
      console.warn('[COIN_STORE] live-service wallet fetch failed', e?.message || String(e));
    }
  };

  useEffect(() => {
    return subscribeWalletUpdated((snap) => {
      if (snap?.coins != null && Number.isFinite(snap.coins)) setBalance(snap.coins);
      if (snap?.gems != null && Number.isFinite(snap.gems)) setGemBalance(snap.gems);
      if (uid && (snap?.coins != null || snap?.gems != null)) {
        void setWalletBalanceCache(uid, {
          coins: snap?.coins,
          gems: snap?.gems,
        });
      }
    });
  }, [uid]);

  useEffect(() => {
    loadBalance();

    if (!uid) return;
    let liveInterval = null;
    if (authReady && isAuthenticated) {
      refreshLiveWallet();
      liveInterval = setInterval(() => {
        refreshLiveWallet();
      }, 15000);
    }

    return () => {
      if (liveInterval) clearInterval(liveInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, authReady, isAuthenticated]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let cancelled = false;
    (async () => {
      try {
        const skus = purchasableCoinPackages
          .map((p) => String(p?.sku || '').trim())
          .filter((s) => s.length > 0);
        if (skus.length === 0) return;
        const details = await getAndroidProductDetails(skus);
        if (cancelled || !Array.isArray(details) || details.length === 0) return;
        const map = {};
        details.forEach((d) => {
          if (d?.sku && d?.formattedPrice) map[d.sku] = d.formattedPrice;
        });
        if (Object.keys(map).length > 0) setLocalizedPrices(map);
      } catch (e) {
        console.warn('[COIN_STORE] localized price fetch failed', e?.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [purchasableCoinPackages]);

  // Recover any owned-but-ungranted Google Play purchases. Shared helper also
  // runs from the header on foreground so purchases credit without opening store.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!ENABLE_PURCHASES) return;
    if (!uid || !authReady || !isAuthenticated) return;

    let cancelled = false;
    (async () => {
      try {
        const recovered = await recoverPendingAndroidIapPurchases();
        if (recovered && !cancelled) await refreshLiveWallet();
      } catch (e) {
        console.warn('[COIN_STORE] purchase recovery sweep failed', e?.message || String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, authReady, isAuthenticated]);

  useEffect(() => {
    if (!scrollToPackagesOnMount) return;
    // Best-effort: switch to coins + jump to packages section.
    setSelectedTab('coins');
    setTimeout(() => {
      try {
        scrollRef.current?.scrollTo?.({ y: packagesSectionYRef.current || 0, animated: true });
      } catch { }
    }, 80);
  }, [scrollToPackagesOnMount]);

  const loadBalance = async () => {
    if (!uid) return;
    try {
      // Keep last-known balance while auth settles — never flash/force 0.
      if (!authReady || !isAuthenticated) {
        return;
      }
      setBalancesRefreshing(true);
      await refreshLiveWallet();
    } catch (error) {
      console.warn('[COIN_STORE] Error loading balance:', error?.message || String(error));
    } finally {
      setBalancesRefreshing(false);
    }
  };

  const submitOverlay = async () => {
    if (!uid) {
      setOverlayError('Please log in first.');
      return;
    }

    const amount = parseInt(String(overlayAmount || '').replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      setOverlayError('Enter a valid amount.');
      return;
    }

    if (overlayType === 'withdraw') {
      if (!ENABLE_WITHDRAWALS) {
        setOverlayError('Withdrawals are currently disabled.');
        return;
      }
      if (amount > gemAvailable) {
        setOverlayError(
          gemAvailable < gemBalance
            ? `Only ${gemAvailable.toLocaleString()} cleared gems can withdraw (pending still clearing ~7 days).`
            : 'You do not have that many cleared gems.',
        );
        return;
      }
      if (withdrawMethod === 'paypal') {
        const email = String(paypalEmail || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setOverlayError('Enter the PayPal email that should receive the payout.');
          return;
        }
      } else if (!stripeReady) {
        setOverlayError('Stripe bank payout is not ready. Choose PayPal, or finish Stripe Connect.');
        return;
      }
      try {
        setOverlayError('');
        const res = await requestWithdrawGems({
          amountGems: amount,
          idempotencyKey: makeIdempotencyKey('withdraw'),
          method: withdrawMethod === 'paypal' ? 'paypal' : 'stripe',
          ...(withdrawMethod === 'paypal'
            ? { paypalEmail: String(paypalEmail || '').trim().toLowerCase() }
            : {}),
        });
        closeOverlay();
        await refreshLiveWallet();
        const status = String(res?.status || '');
        const viaPaypal = withdrawMethod === 'paypal';
        Alert.alert(
          'Withdrawal',
          status === 'paid'
            ? `Paid out ${res.netGems} gems (fee ${res.feeGems}).`
            : status === 'pending_review'
              ? viaPaypal
                ? 'PayPal withdrawal submitted. Blyp will send to your PayPal email after a quick review.'
                : 'Submitted for review. Funds are reserved until approved.'
              : `Request ${status}.`,
        );
      } catch (e) {
        setOverlayError(formatWithdrawalError(e));
      }
      return;
    }

    if (overlayType === 'convert') {
      if (amount > gemBalance) {
        setOverlayError('You do not have that many gems to convert.');
        return;
      }

      try {
        setOverlayError('');
        setLoading(true);
        const res = await convertGemsToCoins({
          amountGems: amount,
          idempotencyKey: makeIdempotencyKey('gem-to-coin'),
        });
        closeOverlay();
        const wallet = res?.wallet;
        if (wallet) {
          const nextCoins = Number(wallet.coinBalance || 0) + Number(wallet.bonusCoinBalance || 0);
          const nextAvailable = Number(wallet.gemAvailable || 0);
          const nextPending = Number(wallet.gemPending || 0);
          setBalance(nextCoins);
          setGemAvailable(nextAvailable);
          setGemBalance(nextAvailable + nextPending);
          emitWalletUpdated(wallet);
        } else {
          await refreshLiveWallet();
        }
        Alert.alert(
          'Converted',
          `Converted ${Number(res?.gemsDebited || amount).toLocaleString()} gems → ${Number(res?.coinsCredited || 0).toLocaleString()} coins.\n${describeGemToCoinRate()}`,
        );
      } catch (e) {
        const msg = String(e?.message || e?.detail || e || 'Convert failed');
        setOverlayError(msg);
      } finally {
        setLoading(false);
      }
      return;
    }

  };

  const handleBuyMoreCoins = () => {
    setSelectedTab('coins');
    // Scroll to packages section (best-effort)
    setTimeout(() => {
      try {
        scrollRef.current?.scrollTo?.({ y: packagesSectionYRef.current || 0, animated: true });
      } catch { }
    }, 50);
  };

  const handlePurchase = async (packageData) => {
    if (requireAccount(navigation, 'buy Blypcoins')) return;
    if (!ENABLE_PURCHASES) {
      Alert.alert('Purchases Disabled', 'Purchases are currently unavailable.');
      return;
    }
    if (!uid) {
      Alert.alert('Error', 'Please log in to purchase Blypcoins');
      return;
    }

    if (Platform.OS !== 'android') {
      Alert.alert('Unavailable', 'Real purchases are currently enabled for Android only.');
      return;
    }

    if (!String(packageData?.sku || '').trim()) {
      Alert.alert('Unavailable', 'This package is not available for purchase right now.');
      return;
    }

    const confirmPrice = localizedPrices[packageData.sku] || formatGbpFallback(packageData.price);
    Alert.alert(
      'Purchase Blypcoins',
      `Buy ${packageData.coins} Blypcoins for ${confirmPrice}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Buy Now',
          onPress: () => processPurchase(packageData)
        }
      ]
    );
  };

  const processPurchase = async (packageData) => {
    if (Platform.OS !== 'android') {
      Alert.alert('Unavailable', 'Real purchases are currently enabled for Android only.');
      return;
    }

    const sku = String(packageData?.sku || '').trim();
    if (!sku) {
      Alert.alert('Unavailable', 'This package is not available for purchase right now.');
      return;
    }

    setLoading(true);
    try {
      const purchase = await launchAndroidPurchase(sku);
      if (!purchase.ok) {
        if (purchase.reason === 'user-cancelled') {
          return;
        }
        const msg = purchase.reason === 'billing-module-unavailable'
          ? 'Google Play billing is unavailable in this app build.'
          : String(purchase.reason || 'Purchase could not be started.');
        Alert.alert('Purchase Unavailable', msg);
        return;
      }
      const verification = await verifyAndroidIapPurchase({
        idempotencyKey: purchase.idempotencyKey,
        platform: 'ANDROID',
        sku: purchase.sku,
        storeTransactionId: purchase.storeTransactionId,
        purchaseToken: purchase.purchaseToken,
      });

      // Consume the Play purchase now that the backend has verified + granted it.
      // Coin packs are consumable, so the user must be able to buy them again.
      // The backend dedupes on the purchase token, so a consume failure here can
      // never cause a double-grant on a later recovery/retry.
      try {
        await consumePurchase(purchase.purchaseToken);
      } catch (consumeErr) {
        console.warn('[COIN_STORE] consume after verify failed', consumeErr?.message || String(consumeErr));
      }

      const wallet = verification?.wallet;
      if (wallet) {
        const nextCoins = Number(wallet.coinBalance || 0) + Number(wallet.bonusCoinBalance || 0);
        const nextGems = Number(wallet.gemAvailable || 0) + Number(wallet.gemPending || 0);
        setBalance(nextCoins);
        setGemBalance(nextGems);
        emitWalletUpdated(wallet);
      } else {
        await refreshLiveWallet();
      }

      Alert.alert(
        'Purchase Successful',
        `Google Play purchase verified. ${Number(verification?.grantedCoins || 0)} coins applied by backend.`,
        [{ text: 'Awesome!', style: 'default' }]
      );

    } catch (error) {
      console.error('Purchase error:', error);
      const backendCode = String(error?.code || '').trim();
      if (backendCode === 'PROVIDER_ERROR') {
        Alert.alert('Purchase Pending Setup', 'Purchase launch succeeded, but provider verification is not configured for this environment.');
        return;
      }
      const detailText = String(error?.detail?.message || error?.detail || error?.message || '').trim();
      Alert.alert('Purchase Failed', detailText || 'Google Play purchase could not be verified.');
    } finally {
      setLoading(false);
    }
  };

  const handleGemPurchase = async () => {
    Alert.alert('Unavailable', 'Gem purchases are currently disabled.');
  };

  const renderPackage = (pkg) => {
    const totalCoins = Number(pkg.coins || 0);
    const coinValue = totalCoins > 0 ? pkg.price / totalCoins : 0;
    const savings = 0;
    const displayPrice = localizedPrices[pkg.sku] || formatGbpFallback(pkg.price);

    return (
      <TouchableOpacity
        key={pkg.id}
        style={[styles.packageCard, pkg.popular && styles.popularCard]}
        onPress={() => handlePurchase(pkg)}
        disabled={loading}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={['#141418', '#1C1C22', '#27272E']}
          style={styles.packageGradient}
        >
          {pkg.popular && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularText}>MOST POPULAR</Text>
            </View>
          )}

          <Text style={styles.packageIcon}>{pkg.icon}</Text>

          <View style={styles.coinInfo}>
            <Text style={styles.coinAmount}>{pkg.coins.toLocaleString()}</Text>
            {pkg.bonus > 0 ? (
              <>
                <Text style={styles.bonusText}>+{pkg.bonus} BONUS</Text>
                <Text style={styles.totalCoins}>= {totalCoins.toLocaleString()} total</Text>
              </>
            ) : (
              <Text style={styles.totalCoins}>coins</Text>
            )}
          </View>

          <View style={styles.priceInfo}>
            <Text style={styles.price}>{displayPrice}</Text>
            {savings > 0 && (
              <Text style={styles.savings}>Save {savings}%!</Text>
            )}
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const renderGemPackage = (pkg) => {
    const totalGems = pkg.gems + pkg.bonus;
    const gemValue = pkg.price / totalGems;
    const savings = pkg.bonus > 0 ? Math.round((pkg.bonus / pkg.gems) * 100) : 0;

    return (
      <TouchableOpacity
        key={pkg.id}
        style={[styles.packageCard, pkg.popular && styles.popularCard]}
        onPress={() => handleGemPurchase(pkg)}
        disabled={loading}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={['#141418', '#1C1C22', '#27272E']}
          style={styles.packageGradient}
        >
          {pkg.popular && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularText}>MOST POPULAR</Text>
            </View>
          )}

          <Text style={styles.packageIcon}>{pkg.icon}</Text>

          <View style={styles.coinInfo}>
            <Text style={styles.coinAmount}>{pkg.gems.toLocaleString()}</Text>
            {pkg.bonus > 0 && (
              <Text style={styles.bonusText}>+{pkg.bonus} BONUS</Text>
            )}
            <Text style={styles.totalCoins}>= {totalGems.toLocaleString()} total</Text>
          </View>

          <View style={styles.priceInfo}>
            <Text style={styles.price}>${pkg.price}</Text>
            <Text style={styles.pricePerCoin}>
              ${gemValue.toFixed(3)} per gem
            </Text>
            {savings > 0 && (
              <Text style={styles.savings}>Save {savings}%!</Text>
            )}
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  // If purchases globally disabled show info message only
  if (!ENABLE_PURCHASES) {
    return (
      <ScreenContainer noSafeArea={true} style={styles.screenContainer}>
        <View style={styles.container}>
          {!embedded ? (
            <>
              <StatusBar barStyle="light-content" backgroundColor="#0A0A0C" />
              <View style={[styles.header, { paddingTop: headerTopPadding }]}>
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => navigation.goBack()}
                >
                  <Icon name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                  <BlypLogo useGradientBackground={true} />
                </View>
                <View style={styles.headerRightSpacer} />
              </View>
            </>
          ) : null}
          <Text style={styles.headerTitle}>My Blyp Wallet</Text>
          <View style={{ padding: 20 }}>
            <Text style={{ color: '#fff', fontSize: 16 }}>Purchases are currently unavailable. Please try again later.</Text>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer noSafeArea={true} style={styles.screenContainer}>
      <SafeAreaView style={styles.container}>
        {!embedded ? (
          <>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

            {/* Header */}
            <View style={[styles.header, { paddingTop: headerTopPadding }]}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => navigation.goBack()}
              >
                <Icon name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>

              <View style={styles.headerCenter}>
                <BlypLogo useGradientBackground={true} />
              </View>

              <View style={styles.headerRightSpacer} />
            </View>
          </>
        ) : null}

        <Text style={styles.headerTitle}>My Blyp Wallet</Text>

        {/* Large balances (centered) — show cached values immediately; soft refresh hint */}
        <View style={styles.heroBalances}>
          {balancesRefreshing ? (
            <View style={styles.balanceSkeletonRow}>
              <View style={styles.balanceSkeletonPill} />
              <View style={[styles.balanceSkeletonPill, { width: 88 }]} />
            </View>
          ) : null}
          <View style={[styles.heroBalanceRow, balancesRefreshing && { opacity: 0.55 }]}>
            <Text style={styles.heroIcon}>{'\uD83E\uDE99'}</Text>
            <Text style={styles.heroValue}>{balance.toLocaleString()}</Text>
          </View>
          <View style={[styles.heroBalanceRow, balancesRefreshing && { opacity: 0.55 }]}>
            <Text style={styles.heroIcon}>{'\uD83D\uDC8E'}</Text>
            <Text style={[styles.heroValue, styles.heroGemValue]}>{gemBalance.toLocaleString()}</Text>
          </View>

          <View style={styles.heroActions}>
            <TouchableOpacity
              style={[styles.heroActionButton, { marginBottom: 10 }]}
              onPress={openConvertOverlay}
              disabled={loading}
              activeOpacity={0.85}
            >
              <View style={[styles.heroActionInner, { backgroundColor: '#1A1A1E' }]}>
                <Text style={styles.heroActionText}>Convert gems → coins</Text>
              </View>
            </TouchableOpacity>
            {ENABLE_WITHDRAWALS ? (
              <TouchableOpacity
                style={[styles.heroActionButton, { marginBottom: 10 }]}
                onPress={openWithdrawOverlay}
                disabled={loading}
                activeOpacity={0.85}
              >
                <View style={[styles.heroActionInner, { backgroundColor: '#1A1A1E' }]}>
                  <Text style={styles.heroActionText}>Withdraw earnings</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.heroActionButton, styles.heroPrimaryActionButton]}
              onPress={handleBuyMoreCoins}
              disabled={loading}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={BLYP_LOGO_GRADIENT_COLORS}
                style={styles.heroActionInner}
              >
                <Text style={[styles.heroActionText, styles.heroPrimaryActionText]}>
                  {Platform.OS === 'android' ? 'Buy More Coins' : 'Coin packs (Android)'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.content}
          contentContainerStyle={{ paddingBottom: Math.max(24, (insets?.bottom || 0) + 24) }}
          showsVerticalScrollIndicator={false}
        >
          {/* Info Section */}
          <View style={styles.infoSection}>
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>
                {selectedTab === 'coins' ? '\uD83D\uDCA1 What are Blypcoins?' : '\uD83D\uDC8E What are Gems?'}
              </Text>
              <Text style={styles.infoText}>
                {selectedTab === 'coins'
                  ? 'Buy coins to send gifts and unlock features. Purchased coins are spendable only — they cannot be withdrawn as cash.'
                  : ENABLE_WITHDRAWALS
                    ? 'Gems are creator earnings from gifts (not purchased coins). After the normal clearance hold they can be withdrawn via PayPal (or Stripe bank when Connect clears). Minimum 1000 gems. No platform withdraw fee.'
                    : 'Gems are creator earnings from gifts. Cash-out is not available yet — balances are tracked for when withdrawals open.'
                }
              </Text>
              {__DEV__ && shouldUseServerValidation() && !process.env.EXPO_PUBLIC_BILLING_VERIFY_URL && (
                <Text style={[styles.infoText, { marginTop: 12, color: '#f87171' }]}>Billing verification backend missing - purchases will fail verification when flag flipped.</Text>
              )}
              {/* TODO(stage3-economy-hardening): Show clearer UI messaging when billing verification required but backend URL misconfigured. */}
            </View>
          </View>

          {/* Packages Grid */}
          <View
            style={styles.packagesSection}
            onLayout={(e) => {
              try {
                packagesSectionYRef.current = e?.nativeEvent?.layout?.y || 0;
              } catch { }
            }}
          >
            <Text style={styles.sectionTitle}>Choose Your Package</Text>

            <View style={styles.packagesGrid}>
              {Platform.OS !== 'android' ? (
                <Text style={[styles.infoText, { paddingHorizontal: 8 }]}>
                  In-app coin purchases are available on Android. iOS StoreKit is coming next.
                </Text>
              ) : selectedTab === 'coins' ? (
                purchasableCoinPackages.map(renderPackage)
              ) : (
                <Text style={[styles.infoText, { paddingHorizontal: 8 }]}>
                  Gem purchases are currently disabled.
                </Text>
              )}
            </View>
          </View>

          {/* Features */}
          <View style={styles.featuresSection}>
            <Text style={styles.sectionTitle}>
              {selectedTab === 'coins' ? 'What You Can Do' : 'Exclusive Gem Benefits'}
            </Text>

            <View style={styles.featuresList}>
              {selectedTab === 'coins' ? (
                <>
                  <View style={styles.featureItem}>
                    <Text style={styles.featureIcon}>{'\uD83C\uDF81'}</Text>
                    <Text style={styles.featureText}>Send gifts to creators</Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Text style={styles.featureIcon}>{'\u2B50'}</Text>
                    <Text style={styles.featureText}>Boost your posts</Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Text style={styles.featureIcon}>{'\uD83D\uDC51'}</Text>
                    <Text style={styles.featureText}>Unlock premium features</Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Text style={styles.featureIcon}>{'\uD83D\uDCB0'}</Text>
                    <Text style={styles.featureText}>Earn coins from gifts</Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.featureItem}>
                    <Text style={styles.featureIcon}>{'\uD83C\uDF1F'}</Text>
                    <Text style={styles.featureText}>Send exclusive premium gifts</Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Text style={styles.featureIcon}>{'\uD83D\uDC8E'}</Text>
                    <Text style={styles.featureText}>Access rare avatar frames</Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Text style={styles.featureIcon}>{'\uD83C\uDFA8'}</Text>
                    <Text style={styles.featureText}>Unlock special themes</Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Text style={styles.featureIcon}>{'\uD83D\uDC51'}</Text>
                    <Text style={styles.featureText}>VIP status and benefits</Text>
                  </View>
                </>
              )}
            </View>
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>

        <Modal
          visible={!!overlayType}
          transparent={true}
          animationType="fade"
          onRequestClose={closeOverlay}
        >
          <TouchableOpacity style={styles.overlayBackdrop} activeOpacity={1} onPress={closeOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.overlayCenter}
            >
              <TouchableOpacity activeOpacity={1} onPress={() => { }} style={styles.overlayCard}>
                <Text style={styles.overlayTitle}>
                  {overlayType === 'convert' ? 'Convert Gems to Coins' : 'Withdraw Gems'}
                </Text>

                <Text style={styles.overlaySubtitle}>
                  {overlayType === 'convert'
                    ? `${describeGemToCoinRate()}. Convert is immediate — all wallet gems (${gemBalance.toLocaleString()} available), including ones still clearing for cash-out. Gift earnings already took the half when coins became gems.`
                    : `Cash out cleared gems only (${gemAvailable.toLocaleString()} withdrawable after ~7-day clear). Pending gems can convert to coins now, but not withdraw yet. Min 1000 gems. Coins are never cashable. No platform withdraw fee. Bank (Stripe) primary when KYC clears; PayPal backup.`}
                </Text>

                {overlayType === 'convert' && Number(overlayAmount) > 0 ? (
                  <Text style={[styles.overlaySubtitle, { marginTop: 6 }]}>
                    You receive ≈ {coinsFromGemsConvert(parseInt(String(overlayAmount || '0').replace(/[^0-9]/g, ''), 10) || 0).toLocaleString()} coins
                  </Text>
                ) : null}

                {overlayType === 'withdraw' ? (
                  <View style={styles.withdrawMethodRow}>
                    <TouchableOpacity
                      style={[
                        styles.withdrawMethodChip,
                        withdrawMethod === 'paypal' && styles.withdrawMethodChipActive,
                      ]}
                      onPress={() => setWithdrawMethod('paypal')}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.withdrawMethodChipText,
                          withdrawMethod === 'paypal' && styles.withdrawMethodChipTextActive,
                        ]}
                      >
                        PayPal · backup
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.withdrawMethodChip,
                        withdrawMethod === 'stripe' && styles.withdrawMethodChipActive,
                        !stripeReady && styles.withdrawMethodChipMuted,
                      ]}
                      onPress={() => {
                        if (!stripeReady) {
                          Alert.alert(
                            'Stripe bank (primary)',
                            'Stripe Connect bank payout is the primary rail once KYC clears. Right now Connect is still verifying — use PayPal backup, or continue Stripe onboarding for later.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Open Stripe setup', onPress: () => { void startStripeOnboard(); } },
                            ],
                          );
                          return;
                        }
                        setWithdrawMethod('stripe');
                      }}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.withdrawMethodChipText,
                          withdrawMethod === 'stripe' && styles.withdrawMethodChipTextActive,
                        ]}
                      >
                        {stripeReady ? 'Bank · primary' : 'Bank · verifying'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {overlayType === 'withdraw' && withdrawMethod === 'paypal' ? (
                  <TextInput
                    value={paypalEmail}
                    onChangeText={(t) => {
                      setPaypalEmail(t);
                      if (overlayError) setOverlayError('');
                    }}
                    placeholder="PayPal email"
                    placeholderTextColor="#A1A1AA"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.overlayInput, { marginBottom: 10 }]}
                  />
                ) : null}

                <TextInput
                  value={overlayAmount}
                  onChangeText={(t) => {
                    setOverlayAmount(t);
                    if (overlayError) setOverlayError('');
                  }}
                  placeholder="Enter amount"
                  placeholderTextColor="#A1A1AA"
                  keyboardType="number-pad"
                  style={styles.overlayInput}
                />

                {!!overlayError && <Text style={styles.overlayError}>{overlayError}</Text>}

                <View style={styles.overlayButtonsRow}>
                  <TouchableOpacity style={[styles.overlayButton, styles.overlayButtonSecondary]} onPress={closeOverlay}>
                    <Text style={styles.overlayButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.overlayButton, styles.overlayButtonPrimary]} onPress={submitOverlay}>
                    <Text style={styles.overlayButtonText}>Confirm</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </KeyboardAvoidingView>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  screenContainer: {
    paddingTop: 0,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.pageBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#27272E',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightSpacer: {
    width: 40,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  balanceContainer: {
    alignItems: 'flex-end',
  },
  balanceLabel: {
    color: '#A1A1AA',
    fontSize: 12,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  coinEmoji: {
    fontSize: 16,
    marginRight: 4,
  },
  balanceAmount: {
    color: '#fbbf24',
    fontSize: 16,
    fontWeight: '700',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#141418',
    margin: 20,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#27272E',
  },
  tabText: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#fff',
  },
  content: {
    flex: 1,
  },

  heroBalances: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'center',
  },
  balanceSkeletonRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  balanceSkeletonPill: {
    width: 72,
    height: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroBalanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  heroIcon: {
    fontSize: 22,
    marginRight: 10,
  },
  heroValue: {
    color: '#F5F5F7',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  heroGemValue: {
    color: '#67E8F9',
  },
  heroActions: {
    width: '100%',
    marginTop: 14,
    gap: 10,
  },
  heroActionButton: {
    width: '100%',
    backgroundColor: '#141418',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#27272E',
    overflow: 'hidden',
  },
  heroPrimaryActionButton: {
    backgroundColor: '#0b1220',
    borderColor: '#27272E',
    transform: [{ scale: 1.02 }],
  },
  heroSecondaryActionButton: {
    backgroundColor: '#0b1220',
  },
  heroActionInner: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPrimaryActionText: {
    fontSize: 15,
    color: '#0A0A0C',
    fontWeight: '800',
  },
  heroSecondaryRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  heroSecondaryHalfButton: {
    flex: 1,
  },
  heroActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },

  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  overlayCenter: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  overlayCard: {
    backgroundColor: '#0A0A0C',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#27272E',
  },
  overlayTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  overlaySubtitle: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  withdrawMethodRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  withdrawMethodChip: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272E',
    backgroundColor: '#141418',
    paddingVertical: 10,
    alignItems: 'center',
  },
  withdrawMethodChipActive: {
    borderColor: '#67E8F9',
    backgroundColor: '#0b1220',
  },
  withdrawMethodChipMuted: {
    opacity: 0.72,
  },
  withdrawMethodChipText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '800',
  },
  withdrawMethodChipTextActive: {
    color: '#67E8F9',
  },
  overlayInput: {
    backgroundColor: '#141418',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: '#27272E',
    textAlign: 'center',
  },
  overlayError: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'center',
  },
  overlayButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  overlayButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#27272E',
  },
  overlayButtonPrimary: {
    backgroundColor: '#141418',
  },
  overlayButtonSecondary: {
    backgroundColor: '#0b1220',
  },
  overlayButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  infoSection: {
    padding: 20,
  },
  infoCard: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  infoTitle: {
    color: '#F5F5F7',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  infoText: {
    color: '#A1A1AA',
    fontSize: 14,
  },
  packagesSection: {
    paddingHorizontal: 20,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  packagesGrid: {
    gap: 12,
  },
  packageCard: {
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  popularCard: {
    borderWidth: 1.5,
    borderColor: '#00D2BE',
  },
  packageGradient: {
    padding: 20,
    paddingTop: 28,
    position: 'relative',
  },
  popularBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#00D2BE',
    paddingVertical: 5,
    alignItems: 'center',
  },
  popularText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  packageIcon: {
    fontSize: 40,
    textAlign: 'center',
    marginBottom: 12,
  },
  coinInfo: {
    alignItems: 'center',
    marginBottom: 16,
  },
  coinAmount: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
  },
  bonusText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  totalCoins: {
    color: '#A1A1AA',
    fontSize: 14,
    marginTop: 2,
  },
  priceInfo: {
    alignItems: 'center',
  },
  price: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  pricePerCoin: {
    color: '#A1A1AA',
    fontSize: 12,
    marginTop: 2,
  },
  savings: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  featuresSection: {
    padding: 20,
  },
  featuresList: {
    gap: 16,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141418',
    padding: 16,
    borderRadius: 12,
  },
  featureIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  featureText: {
    color: '#fff',
    fontSize: 16,
    flex: 1,
  },
  bottomSpacer: {
    height: 40,
  },
});

export default CoinStoreScreen;

