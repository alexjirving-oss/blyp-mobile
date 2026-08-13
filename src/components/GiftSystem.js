import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  Animated,
  Dimensions,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { auth } from '../config/firebase';
import BlypCoinService from '../services/BlypCoinService';
import EnterpriseAnalyticsService from '../services/EnterpriseAnalyticsService';
import { ENABLE_PURCHASES } from '../config/economyModel';
import { COLORS } from '../styles/theme';
import { useAuth } from '../hooks/useCommon';
import {
  getEconomyCatalog,
  getEconomyWallet,
  sendEconomyGift,
  makeIdempotencyKey,
} from '../api/economyLiveApi';
import { subscribeWalletUpdated } from '../utils/walletEvents';
import TourTarget from '../tour/TourTarget';

const { width } = Dimensions.get('window');
const GIFT_TILE_WIDTH = Math.min(148, Math.max(128, Math.round(width * 0.36)));

import { shouldUseLiveServiceWallet } from '../utils/walletSource';
import { GIFT_MOTION } from './live/giftMotion/giftMotionSystem';

/** Client fallback when /economy/catalog is unreachable (keeps picker usable offline). */
function giftTypesFallback() {
  try {
    const fromMotion = Object.values(GIFT_MOTION || {}).map((g) => ({
      id: g.giftId,
      name: g.name,
      cost: g.coinCost,
      emoji: g.emoji,
      rarity: g.rarity,
    }));
    if (fromMotion.length > 0) return fromMotion;
  } catch {
    // fall through
  }
  try {
    return BlypCoinService.getGiftTypes();
  } catch {
    return [];
  }
}

/** Gold coin mark — avoids emoji font clipping artifacts on Android edges. */
function CoinMark({ size = 12, style }) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#F5C542',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: 'rgba(253,230,138,0.9)',
        },
        style,
      ]}
    >
      <Text
        style={{
          color: '#0A0A0C',
          fontSize: Math.max(7, Math.round(size * 0.62)),
          fontWeight: '900',
          lineHeight: Math.max(8, Math.round(size * 0.7)),
        }}
        allowFontScaling={false}
      >
        B
      </Text>
    </View>
  );
}


function formatGiftCoins(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.trunc(n));
}

const GiftSystem = ({
  postId,
  creatorId,
  creatorName,
  hideTrigger = false,
  triggerVariant = 'default',
  openSignal,
  navigation,
  incomingGiftEvent,
  giftCoins = 0,
  onGiftSent,
  battleId,
  battleSide,
}) => {
  const { uid, authReady, isAuthenticated } = useAuth();

  const [showGiftModal, setShowGiftModal] = useState(false);
  const [userBalance, setUserBalance] = useState(0);
  const [walletUserId, setWalletUserId] = useState(null);
  const [walletState, setWalletState] = useState({
    status: 'idle', // 'idle' | 'loading' | 'ok' | 'error'
    lastError: null,
    lastUpdatedAt: 0,
  });
  const [gifts, setGifts] = useState(() => giftTypesFallback());
  const [selectedGift, setSelectedGift] = useState(null);
  const [sending, setSending] = useState(false);
  const [giftAnimation] = useState(new Animated.Value(0));

  // Subtle tile animations (shared across tiles to keep it lightweight)
  const giftShimmer = useRef(new Animated.Value(0)).current;
  const giftPulse = useRef(new Animated.Value(0)).current;
  // Holds the in-flight gift's idempotency key so a retry after a timeout reuses
  // the SAME key (server dedupes) instead of charging twice. Cleared on success.
  const pendingGiftRef = useRef(null);
  
  // Disney Pixar-quality heart animation states
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const heartScale = useRef(new Animated.Value(0)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const heartRotation = useRef(new Animated.Value(0)).current;
  const heartY = useRef(new Animated.Value(0)).current;
  const sparkles = useRef(Array.from({length: 12}, () => ({
    x: new Animated.Value(0),
    y: new Animated.Value(0),
    scale: new Animated.Value(0),
    opacity: new Animated.Value(0),
    rotation: new Animated.Value(0)
  }))).current;
  
  // NOTE: Firebase auth may be null in Cognito-first flows. Use useAuth() uid for identity.
  const currentUser = auth.currentUser;
  const useLiveWallet = shouldUseLiveServiceWallet();

  const walletRefreshInFlightRef = useRef(false);

  const lastOpenSignalRef = useRef(openSignal);

  useEffect(() => {
    if (openSignal == null) return;
    if (lastOpenSignalRef.current === openSignal) return;
    lastOpenSignalRef.current = openSignal;
    setShowGiftModal(true);
  }, [openSignal]);

  useEffect(() => {
    // Keep animations running only while modal is open
    if (!showGiftModal) {
      try {
        giftShimmer.stopAnimation();
        giftPulse.stopAnimation();
      } catch {
        // ignore
      }
      return;
    }

    giftShimmer.setValue(0);
    giftPulse.setValue(0);

    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(giftShimmer, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(giftShimmer, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(giftPulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(giftPulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    shimmerLoop.start();
    pulseLoop.start();

    return () => {
      try {
        shimmerLoop.stop();
        pulseLoop.stop();
      } catch {
        // ignore
      }
    };
  }, [showGiftModal, giftPulse, giftShimmer]);

  const refreshWallet = async (attempt = 0) => {
    if (walletRefreshInFlightRef.current) return;
    walletRefreshInFlightRef.current = true;

    if (attempt === 0) {
      // If we already have a known-good wallet, don't flicker back to "loading".
      setWalletState((s) => ({ ...s, status: s.status === 'ok' ? 'ok' : 'loading', lastError: null }));
    }
    try {
      const wallet = await getEconomyWallet();
      const authedUserId = typeof wallet?.userId === 'string' ? wallet.userId : null;
      if (authedUserId) setWalletUserId(authedUserId);
      const nextBalance = Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
      if (Number.isFinite(nextBalance)) {
        setUserBalance(nextBalance);
        setWalletState({ status: 'ok', lastError: null, lastUpdatedAt: Date.now() });
      } else {
        throw new Error('[GIFT_SYSTEM] Wallet returned non-numeric balances');
      }
    } catch (e) {
      // Avoid "sticky 0" if Cognito token isn't ready yet; retry a couple of times.
      const msg = e?.message || String(e);

      // If auth isn't ready / user isn't logged in, don't loop forever in "loading".
      const lower = String(msg).toLowerCase();
      const looksLikeAuth =
        lower.includes('cognito_jwt') ||
        lower.includes('not logged in') ||
        lower.includes('missing/expired') ||
        lower.includes('not authenticated') ||
        lower.includes('no current user') ||
        lower.includes('no user') ||
        lower.includes('unauthorized') ||
        lower.includes('forbidden');

      if (looksLikeAuth) {
        console.warn('[GIFT_SYSTEM] wallet fetch blocked by auth', msg);
        setWalletState({ status: 'error', lastError: e, lastUpdatedAt: Date.now() });
        return;
      }
      if (attempt < 4) {
        const delayMs = 400 * Math.pow(2, attempt); // 400, 800, 1600, 3200, ...
        await new Promise((r) => setTimeout(r, delayMs));
        walletRefreshInFlightRef.current = false;
        return refreshWallet(attempt + 1);
      }
      // Best-effort fallback: keep whatever balance we had.
      console.warn('[GIFT_SYSTEM] wallet fetch failed', msg);
      setWalletState({ status: 'error', lastError: e, lastUpdatedAt: Date.now() });
    } finally {
      walletRefreshInFlightRef.current = false;
    }
  };

  const loadCatalog = async () => {
    try {
      const catalog = await getEconomyCatalog();
      const mapped = (catalog?.gifts || [])
        .filter((g) => g && g.enabled !== false)
        .map((g) => {
          const emoji =
            (typeof g?.assetJson?.emoji === 'string' && g.assetJson.emoji) ||
            (typeof g?.assetJson?.icon === 'string' && g.assetJson.icon) ||
            '🎁';
          return {
            id: String(g.giftId),
            name: String(g.name || g.giftId),
            cost: Number(g.coinCost || 0),
            emoji,
            rarity: g.rarity || 'common',
          };
        });

      if (mapped.length > 0) {
        setGifts(mapped);
      }
    } catch (e) {
      console.warn('[GIFT_SYSTEM] catalog fetch failed; using fallback list', e?.message || String(e));
    }
  };

  // Ensure creatorName is always a string
  const getCreatorName = () => {
    // If it's already a string, return as is
    if (typeof creatorName === 'string') {
      return creatorName.startsWith('@') ? creatorName : `@${creatorName}`;
    }
    // If it's an object with username property
    if (typeof creatorName === 'object' && creatorName?.username) {
      return creatorName.username.startsWith('@') ? creatorName.username : `@${creatorName.username}`;
    }
    // If it's an object with other structure, try to extract username
    if (typeof creatorName === 'object' && creatorName) {
      const possibleName = creatorName.name || creatorName.displayName || creatorName.user || creatorName.id;
      if (possibleName) {
        return possibleName.startsWith('@') ? possibleName : `@${possibleName}`;
      }
    }
    return '@Unknown User';
  };

  useEffect(() => {
    if (!showGiftModal) return;
    // When the modal opens, load catalog + refresh wallet so the UI is accurate.
    loadCatalog();
    if (useLiveWallet) {
      refreshWallet();
      const unsub = subscribeWalletUpdated((snap) => {
        if (snap?.coins != null && Number.isFinite(snap.coins)) {
          setUserBalance(snap.coins);
          setWalletState({ status: 'ok', lastError: null, lastUpdatedAt: Date.now() });
        }
      });
      return () => {
        try {
          unsub?.();
        } catch {
          /* ignore */
        }
      };
    }

    // Firebase wallet mode (default app mode): mirror the same coin balance shown in the header.
    if (!authReady || !isAuthenticated || !uid) {
      setWalletState({ status: 'error', lastError: new Error('Not signed in'), lastUpdatedAt: Date.now() });
      return;
    }
    setWalletUserId(String(uid));
    setWalletState((s) => ({ ...s, status: 'loading', lastError: null }));
    const unsub = BlypCoinService.subscribeToBalance(uid, (balance) => {
      setUserBalance(Number(balance || 0));
      setWalletState({ status: 'ok', lastError: null, lastUpdatedAt: Date.now() });
    });
    return () => {
      try { unsub?.(); } catch {}
    };
    // Re-run when auth settles so a modal opened before sign-in finishes doesn't
    // stay stuck at a 0 balance (which locks every gift).
  }, [showGiftModal, useLiveWallet, authReady, isAuthenticated, uid]);

  useEffect(() => {
    if (!showGiftModal) return;

    if (!useLiveWallet) return;

    // While the modal is open, keep the balance fresh in case it changes (admin credit, gifting, etc.).
    const t = setInterval(() => {
      refreshWallet();
    }, 3000);

    return () => clearInterval(t);
  }, [showGiftModal, useLiveWallet, authReady, isAuthenticated, uid]);

  const showWalletDebug = () => {
    const enabled = String(process?.env?.EXPO_PUBLIC_ENABLE_DEVTOOLS || '') === '1';
    if (!__DEV__ && !enabled) return;

    const lastError = walletState?.lastError;
    const msg =
      walletState?.status === 'ok'
        ? `Wallet OK\nBalance: ${Number(userBalance || 0).toLocaleString()}`
        : walletState?.status === 'loading'
          ? 'Wallet loading…'
          : `Wallet error\n${lastError?.message || String(lastError || 'unknown')}`;

    Alert.alert('Wallet Debug', msg, [
      { text: 'Refresh', onPress: () => refreshWallet() },
      { text: 'Close', style: 'cancel' },
    ]);
  };

  useEffect(() => {
    if (!incomingGiftEvent) return;
    const giftId = incomingGiftEvent?.giftId;
    if (!giftId) return;

    // Try to animate using the matched catalog item; fallback to generic gift.
    const match = gifts?.find?.((g) => g?.id === giftId);
    triggerGiftAnimation(
      match || {
        id: giftId,
        name: giftId,
        emoji: '🎁',
        cost: 0,
        rarity: 'common',
      }
    );
  }, [incomingGiftEvent]);

  const handleSendGift = async (gift) => {
    if (!useLiveWallet) {
      if (!authReady || !isAuthenticated || !uid) {
        Alert.alert('Login Required', 'Please sign in to send gifts.');
        return;
      }

      // Prevent self-gifting (Firebase mode uses Firebase uids)
      if (String(uid) === String(creatorId)) {
        Alert.alert('Cannot Send Gift', 'You cannot send gifts to yourself');
        return;
      }

      if (userBalance < gift.cost) {
        Alert.alert(
          'Insufficient Balance',
          `You need ${gift.cost} Blypcoins to send this gift. Your balance: ${userBalance}`,
          [
            { text: 'Cancel', style: 'cancel' },
            ...(ENABLE_PURCHASES
              ? [
                  {
                    text: 'Buy Coins',
                    onPress: () => {
                      setShowGiftModal(false);
                      try {
                        navigation?.navigate?.('CoinStore');
                      } catch {
                        // no-op
                      }
                    },
                  },
                ]
              : []),
          ]
        );
        return;
      }

      Alert.alert(
        'Send Gift',
        `Send ${gift.name} ${gift.emoji} to ${getCreatorName()} for ${gift.cost} Blypcoins?`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Send Gift', onPress: () => processSendGift(gift) }]
      );
      return;
    }

    // Do not rely on Firebase auth for gating here.
    // In IVS/live-service mode, Cognito auth is used and Firebase auth may be null.
    if (walletState?.status === 'loading' || walletState?.status === 'idle') {
      Alert.alert('Just a sec', 'Loading your wallet…');
      refreshWallet();
      return;
    }
    if (walletState?.status === 'error') {
      Alert.alert('Wallet unavailable', 'Couldn’t load your coin balance. Pull to refresh or reopen gifts.', [
        { text: 'Retry', onPress: () => refreshWallet() },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    // Prevent self-gifting using the authenticated Cognito userId (server-authoritative).
    if (walletUserId && String(walletUserId) === String(creatorId)) {
      Alert.alert('Cannot Send Gift', 'You cannot send gifts to yourself');
      return;
    }

    if (userBalance < gift.cost) {
      Alert.alert(
        'Insufficient Balance',
        `You need ${gift.cost} Blypcoins to send this gift. Your balance: ${userBalance}`,
        [
          { text: 'Cancel', style: 'cancel' },
          ...(ENABLE_PURCHASES
            ? [
                {
                  text: 'Buy Coins',
                  onPress: () => {
                    setShowGiftModal(false);
                    try {
                      navigation?.navigate?.('CoinStore');
                    } catch {
                      // no-op
                    }
                  },
                },
              ]
            : []),
        ]
      );
      return;
    }

    // The Send button is already an explicit confirmation. A second Alert.alert
    // here renders BEHIND the open gift Modal on Android (it never appears), so the
    // send silently never fired — the root cause of "tap Send, nothing happens".
    // Send directly instead.
    processSendGift(gift);
  };

  const processSendGift = async (gift) => {
    setSending(true);
    setSelectedGift(gift);
    
    try {
      if (useLiveWallet) {
        // Stable idempotency key per send intent. Reuse the key if a previous
        // attempt for the SAME gift is being retried (e.g. after a timeout), so
        // the server's idempotency guard prevents a double charge.
        const sameAsPending =
          pendingGiftRef.current &&
          pendingGiftRef.current.giftId === String(gift.id) &&
          pendingGiftRef.current.creatorId === String(creatorId) &&
          pendingGiftRef.current.streamId === String(postId) &&
          pendingGiftRef.current.battleId === String(battleId || '') &&
          pendingGiftRef.current.battleSide === String(battleSide || '');
        if (!sameAsPending) {
          pendingGiftRef.current = {
            giftId: String(gift.id),
            creatorId: String(creatorId),
            streamId: String(postId),
            battleId: String(battleId || ''),
            battleSide: String(battleSide || ''),
            key: makeIdempotencyKey('gift'),
          };
        }
        const out = await sendEconomyGift({
          streamId: String(postId),
          receiverUserId: String(creatorId),
          giftId: String(gift.id),
          quantity: 1,
          idempotencyKey: pendingGiftRef.current.key,
          ...(battleId && battleSide ? { battleId: String(battleId), battleSide } : {}),
        });
        // Success: clear so the next gift uses a fresh key.
        pendingGiftRef.current = null;

        // Keep balance in sync with server response.
        const nextBalance =
          Number(out?.newBalances?.coinBalance || 0) + Number(out?.newBalances?.bonusCoinBalance || 0);
        setUserBalance(nextBalance);
        const spent = Number(out?.coinSpent || gift.cost || 0);
        try {
          onGiftSent?.({
            postId: String(postId),
            coinSpent: Number.isFinite(spent) ? spent : Number(gift.cost || 0),
            quantity: Number(out?.gift?.quantity || 1),
            giftId: String(gift.id),
            name: gift.name,
            emoji: gift.emoji,
            coinCost: Number.isFinite(spent) ? spent : Number(gift.cost || 0),
          });
        } catch { /* UI callback best-effort */ }
      } else {
        if (!authReady || !isAuthenticated || !uid) throw new Error('Not signed in');
        const result = await BlypCoinService.sendGift(String(uid), String(creatorId), String(gift.id), Number(gift.cost || 0));
        const nextBalance = Number(result?.senderBalance || 0);
        setUserBalance(nextBalance);
        setWalletState({ status: 'ok', lastError: null, lastUpdatedAt: Date.now() });
        try {
          onGiftSent?.({
            postId: String(postId),
            coinSpent: Number(gift.cost || 0),
            quantity: 1,
            giftId: String(gift.id),
            name: gift.name,
            emoji: gift.emoji,
            coinCost: Number(gift.cost || 0),
          });
        } catch { /* UI callback best-effort */ }
      }

      // Analytics instrumentation
      EnterpriseAnalyticsService.addEvent({
        type: 'economy_gift_send',
        timestamp: Date.now(),
        userId: uid || currentUser?.uid,
        gift: {
          giftType: gift.id,
          cost: gift.cost,
          rarity: gift.rarity
        },
        recipient: {
          toUserId: creatorId,
          name: typeof creatorName === 'string' ? creatorName : undefined
        },
        context: {
          postId,
          source: 'gift_modal'
        }
      });
      // TODO(stage2-economy-safety): Add fraud heuristics (velocity, duplicate rapid sends) before processing sendGift.
      
      // Trigger gift animation
      triggerGiftAnimation(gift);
      
      // Close modal after animation
      // Combo-friendly: keep the gift sheet open and the gift selected so the
      // sender can tap Send repeatedly to stack gifts. No success Alert — it both
      // blocks rapid combos and renders behind the modal on Android; the on-screen
      // gift animation is the confirmation.
      
    } catch (error) {
      console.error('Error sending gift:', error);
      EnterpriseAnalyticsService.addEvent({
        type: 'economy_gift_error',
        timestamp: Date.now(),
        userId: uid || currentUser?.uid,
        error: { message: error?.message },
        gift: { giftType: gift.id, cost: gift.cost },
        recipient: { toUserId: creatorId },
        context: { postId }
      });
      const httpStatus = error?.httpStatus;
      const code = error?.code;
      const msgText = String(error?.message || '');
      const isInsufficient =
        code === 'INSUFFICIENT_FUNDS' || httpStatus === 409 || /insufficient/i.test(msgText);
      if (httpStatus === 401 || code === 'UNAUTH') {
        Alert.alert('Login Required', 'Please sign in to send gifts.');
      } else if (isInsufficient) {
        // Refresh so the displayed balance matches the server's view (this is
        // also where a wallet split-brain shows up: store/header coins live in a
        // different wallet than the one gifting spends).
        refreshWallet();
        Alert.alert(
          'Not enough coins',
          'Your gifting wallet is short on Blypcoins. Open the Coin Store to top up — note that gifting spends your purchased coin balance.',
          [
            { text: 'OK', style: 'cancel' },
            ...(ENABLE_PURCHASES
              ? [{
                  text: 'Buy Coins',
                  onPress: () => {
                    setShowGiftModal(false);
                    try { navigation?.navigate?.('CoinStore'); } catch { /* no-op */ }
                  },
                }]
              : []),
          ]
        );
      } else if (code === 'RECEIVER_INVALID') {
        Alert.alert(
          'Can’t gift that person',
          'During a live you can gift the host or guests who are on stage. Pick them from the gift button.',
        );
      } else if (code === 'ACCOUNT_BANNED') {
        Alert.alert('Gift unavailable', 'This account is restricted from sending gifts right now.');
      } else if (httpStatus === 403) {
        Alert.alert('Gift unavailable', 'This gift couldn’t be sent right now. Try gifting the host or an on-stage guest.');
      } else if (code === 'GIFT_NOT_FOUND' || httpStatus === 404) {
        Alert.alert('Gift unavailable', 'That gift is no longer available. Please pick another.');
      } else {
        const enabled = String(process?.env?.EXPO_PUBLIC_ENABLE_DEVTOOLS || '') === '1';
        const showDetails = __DEV__ || enabled;
        if (showDetails) {
          let details = '';
          try {
            const detail = error?.detail;
            const detailText =
              detail == null
                ? ''
                : (typeof detail === 'string' ? detail : JSON.stringify(detail));
            details = [
              `HTTP: ${httpStatus ?? 'unknown'}`,
              `CODE: ${code ?? 'unknown'}`,
              `MSG: ${error?.message || 'unknown'}`,
              detailText ? `DETAIL: ${detailText}` : null,
            ].filter(Boolean).join('\n');
          } catch {
            details = `HTTP: ${httpStatus ?? 'unknown'}\nCODE: ${code ?? 'unknown'}\nMSG: ${error?.message || 'unknown'}`;
          }

          Alert.alert('Gift send failed', details);
        } else {
          Alert.alert('Error', 'Failed to send gift. Please try again.');
        }
      }
      setSelectedGift(null);
    } finally {
      setSending(false);
    }
  };

  const triggerGiftAnimation = (gift) => {
    if (gift.name === 'Heart' || gift.emoji === '❤️' || gift.id === 'heart') {
      triggerDisneyHeartAnimation();
      return;
    }
    // Anticipation → overshoot climax → linger fade for mid/epic sender confirm.
    // Live room viewers get the full GiftHeroFx via LiveGiftOverlay socket path.
    giftAnimation.setValue(0);
    Animated.sequence([
      Animated.timing(giftAnimation, {
        toValue: 0.35,
        duration: 90,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(giftAnimation, {
        toValue: 1,
        friction: 4,
        tension: 120,
        useNativeDriver: true,
      }),
      Animated.delay(gift.cost >= 25 ? 480 : 220),
      Animated.timing(giftAnimation, {
        toValue: 0,
        duration: gift.cost >= 50 ? 700 : 520,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Disney Pixar-quality heart animation - prepare to be amazed! 🎬✨
  const triggerDisneyHeartAnimation = () => {
    setShowHeartAnimation(true);
    
    // Reset all animation values
    heartScale.setValue(0);
    heartOpacity.setValue(0);
    heartRotation.setValue(0);
    heartY.setValue(0);
    sparkles.forEach(sparkle => {
      sparkle.x.setValue(0);
      sparkle.y.setValue(0);
      sparkle.scale.setValue(0);
      sparkle.opacity.setValue(0);
      sparkle.rotation.setValue(0);
    });

    // THE MAIN HEART ANIMATION - 5 phases of pure magic
    const mainHeartAnimation = Animated.sequence([
      // Phase 1: Dramatic entrance with anticipation
      Animated.parallel([
        Animated.timing(heartScale, {
          toValue: 1.5,
          duration: 400,
          easing: Easing.out(Easing.back(2)),
          useNativeDriver: true,
        }),
        Animated.timing(heartOpacity, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartRotation, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.elastic(1.2)),
          useNativeDriver: true,
        })
      ]),
      
      // Phase 2: Heartbeat effect - ba-dum, ba-dum
      Animated.sequence([
        Animated.timing(heartScale, {
          toValue: 1.8,
          duration: 150,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          toValue: 1.4,
          duration: 100,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          toValue: 1.7,
          duration: 120,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          toValue: 1.5,
          duration: 80,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        })
      ]),
      
      // Phase 3: Graceful levitation
      Animated.timing(heartY, {
        toValue: -50,
        duration: 800,
        easing: Easing.out(Easing.circle),
        useNativeDriver: true,
      }),
      
      // Phase 4: Final dramatic scale and fade
      Animated.parallel([
        Animated.timing(heartScale, {
          toValue: 2.2,
          duration: 600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartOpacity, {
          toValue: 0,
          duration: 600,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartY, {
          toValue: -120,
          duration: 600,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        })
      ])
    ]);

    // SPARKLE PARTICLE SYSTEM - because every Disney movie needs sparkles!
    const sparkleAnimations = sparkles.map((sparkle, index) => {
      const delay = index * 80; // Stagger the sparkles
      const angle = (index / sparkles.length) * Math.PI * 2; // Circular distribution
      const radius = 80 + Math.random() * 40; // Random radius for natural effect
      
      return Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          // Sparkle position - spiral outward
          Animated.timing(sparkle.x, {
            toValue: Math.cos(angle) * radius,
            duration: 1200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(sparkle.y, {
            toValue: Math.sin(angle) * radius - 30,
            duration: 1200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          
          // Sparkle lifecycle
          Animated.sequence([
            Animated.timing(sparkle.opacity, {
              toValue: 1,
              duration: 200,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(sparkle.opacity, {
              toValue: 0,
              duration: 1000,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            })
          ]),
          
          // Sparkle scale pulse
          Animated.sequence([
            Animated.timing(sparkle.scale, {
              toValue: 1,
              duration: 300,
              easing: Easing.out(Easing.back(1.5)),
              useNativeDriver: true,
            }),
            Animated.timing(sparkle.scale, {
              toValue: 0,
              duration: 900,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            })
          ]),
          
          // Sparkle rotation
          Animated.timing(sparkle.rotation, {
            toValue: 1,
            duration: 1200,
            easing: Easing.linear,
            useNativeDriver: true,
          })
        ])
      ]);
    });

    // Execute the complete Disney magic!
    Animated.parallel([
      mainHeartAnimation,
      ...sparkleAnimations
    ]).start(() => {
      // Animation complete - hide the overlay
      setTimeout(() => {
        setShowHeartAnimation(false);
      }, 200);
    });
  };

  const getRarityColor = (rarity) => {
    // Blyp Gift Motion palette — teal/sport energy; gold only on legendary.
    const colors = {
      common: ['#3F3F46', '#00A89E', '#00D2BE'],
      rare: ['#0E7490', '#00D2BE', '#F59E0B'],
      epic: ['#0E7490', '#A5F3FC', '#7FEDE2'],
      legendary: ['#92400E', '#FBBF24', '#00D2BE'],
    };
    return colors[rarity] || colors.common;
  };

  const renderGift = (gift) => {
    const rarity = String(gift?.rarity || 'common').toLowerCase();
    const isPremium = rarity === 'epic' || rarity === 'legendary';
    const cost = Math.max(0, Number(gift?.cost) || 0);
    const balanceKnown = walletState?.status === 'ok';
    const isAffordable = !balanceKnown || userBalance >= cost;
    const shortfall = balanceKnown ? Math.max(0, cost - userBalance) : 0;
    const shimmerTranslate = giftShimmer.interpolate({
      inputRange: [0, 1],
      outputRange: [-40, 40],
    });
    const premiumGlowOpacity = giftPulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.25, 0.55],
    });

    // Use rarity palette for border/glow; keep existing rarity mapping.
    const rarityColors = getRarityColor(rarity);
    const glowColor = rarityColors?.[1] || rarityColors?.[0] || COLORS.gradientEnd;

    const isSelected = selectedGift?.id === gift.id;

    return (
      <TouchableOpacity
        key={gift.id}
        style={[styles.giftItem, isSelected && styles.selectedGift]}
        onPress={() => setSelectedGift(gift)}
        disabled={sending}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected, disabled: sending }}
        accessibilityLabel={`${gift.name}, ${cost.toLocaleString()} coins${isSelected ? ', selected' : ''}`}
      >
        <LinearGradient
          colors={rarityColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.giftOuterFrame, isSelected && styles.giftOuterFrameSelected]}
        >
          <View style={[styles.giftInnerFrame, isPremium && { shadowColor: glowColor }]}>
            <LinearGradient
              colors={rarityColors}
              start={{ x: 0.15, y: 0.1 }}
              end={{ x: 0.85, y: 0.9 }}
              style={styles.giftGradient}
            >
              {/* Icon art (focus) */}
              <View style={styles.giftArtPanel}>
                <LinearGradient
                  colors={['rgba(15,23,42,0.12)', 'rgba(15,23,42,0.45)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.giftArtBackdrop}
                />

                {isPremium ? (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.giftGlow,
                      {
                        opacity: premiumGlowOpacity,
                        backgroundColor: glowColor,
                      },
                    ]}
                  />
                ) : null}

                <View style={[styles.giftArtOrb, { backgroundColor: glowColor }]} pointerEvents="none" />
                <View style={styles.giftArtOrb2} pointerEvents="none" />

                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.giftFoilSweep,
                    {
                      transform: [{ translateX: shimmerTranslate }, { rotate: '-18deg' }],
                      opacity: isPremium ? 0.24 : 0.14,
                    },
                  ]}
                />

                <View style={styles.giftGloss} pointerEvents="none" />

                <View
                  style={[
                    styles.giftRarityChip,
                    isPremium && styles.giftRarityChipPremium,
                  ]}
                  pointerEvents="none"
                >
                  <Text style={styles.giftRarityText}>{rarity.toUpperCase()}</Text>
                </View>

                {isSelected ? (
                  <View style={styles.giftSelectedBadge} pointerEvents="none">
                    <Text style={styles.giftSelectedBadgeText}>✓</Text>
                  </View>
                ) : null}

                <View style={styles.giftEmojiWrap}>
                  <Text style={styles.giftEmoji}>{gift.emoji}</Text>
                </View>
              </View>

              {/* Name + price (always visible) */}
              <View style={styles.giftTileMeta}>
                <Text style={styles.giftName} numberOfLines={1}>
                  {gift.name}
                </Text>
                <View style={[styles.giftPriceRow, isSelected && styles.giftPriceRowSelected]}>
                  <CoinMark size={13} />
                  <Text style={styles.costText}>{formatGiftCoins(cost)}</Text>
                  <Text style={styles.costUnit}>coins</Text>
                </View>
                <Text
                  style={isAffordable ? styles.giftAvailabilityText : styles.giftShortfallText}
                  numberOfLines={1}
                >
                  {isAffordable
                    ? isSelected
                      ? 'Ready to send'
                      : 'Tap to select'
                    : `Need ${formatGiftCoins(shortfall)} more`}
                </Text>
              </View>
            </LinearGradient>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const selectedGiftCost = Math.max(0, Number(selectedGift?.cost) || 0);
  const selectedGiftAffordable =
    walletState?.status !== 'ok' || userBalance >= selectedGiftCost;

  return (
    <>
      {!hideTrigger ? (
        triggerVariant === 'feed' ? (
          <TourTarget id="feedGift">
            <TouchableOpacity
              style={styles.feedTriggerOuter}
              onPress={() => setShowGiftModal(true)}
              activeOpacity={0.85}
              delayPressIn={0}
            >
              <View style={styles.feedTriggerStack}>
                <LinearGradient
                  colors={[COLORS.gradientStart, COLORS.gradientMiddle, COLORS.gradientEnd]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.feedTriggerRing}
                >
                  <View style={styles.feedTriggerInner}>
                    <View style={styles.feedTriggerGloss} pointerEvents="none" />
                    <Icon name="gift" size={22} color={COLORS.white} />
                  </View>
                </LinearGradient>
                <Text style={styles.feedTriggerLabel} allowFontScaling={false}>
                  {Number(giftCoins) > 0 ? formatGiftCoins(giftCoins) : 'Gift'}
                </Text>
              </View>
            </TouchableOpacity>
          </TourTarget>
        ) : (
          <TouchableOpacity
            style={styles.giftButton}
            onPress={() => setShowGiftModal(true)}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#f59e0b', '#fbbf24']}
              style={styles.giftButtonGradient}
            >
              <Icon  name="gift" size={16} color="#fff"  />
              <Text style={styles.giftButtonText}>Gift</Text>
            </LinearGradient>
          </TouchableOpacity>
        )
      ) : null}

      {/* Gift Selection Modal
          Cinema MUST live inside this Modal — RN Modal is a separate window
          layer, so sibling overlays render behind the sheet (invisible gifts). */}
      <Modal
        visible={showGiftModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowGiftModal(false)}
      >
        <View style={styles.modalOverlay}>
          {/* Top-half cinema: above dimmed feed; stacked over sheet upper edge. */}
          <View style={styles.giftCinemaStage} pointerEvents="none">
            {selectedGift ? (
              <Animated.View
                style={[
                  styles.giftAnimationOverlay,
                  {
                    opacity: giftAnimation,
                    transform: [
                      {
                        scale: giftAnimation.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.5, 2],
                        }),
                      },
                    ],
                  },
                ]}
                pointerEvents="none"
              >
                <Text style={styles.animatedGiftEmoji}>{selectedGift.emoji}</Text>
              </Animated.View>
            ) : null}

            {showHeartAnimation ? (
              <View style={styles.heartAnimationContainer} pointerEvents="none">
                <Animated.View
                  style={[
                    styles.animatedHeart,
                    {
                      opacity: heartOpacity,
                      transform: [
                        { scale: heartScale },
                        {
                          rotate: heartRotation.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '360deg'],
                          }),
                        },
                        { translateY: heartY },
                      ],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={[COLORS.gradientStart, COLORS.gradientMiddle, COLORS.gradientEnd]}
                    style={styles.heartGradient}
                  >
                    <Text style={styles.magicalHeart}>❤️</Text>
                  </LinearGradient>
                </Animated.View>

                {sparkles.map((sparkle, index) => (
                  <Animated.View
                    key={index}
                    style={[
                      styles.sparkle,
                      {
                        opacity: sparkle.opacity,
                        transform: [
                          { translateX: sparkle.x },
                          { translateY: sparkle.y },
                          { scale: sparkle.scale },
                          {
                            rotate: sparkle.rotation.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0deg', '720deg'],
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    <Text style={styles.sparkleText}>✨</Text>
                  </Animated.View>
                ))}
              </View>
            ) : null}
          </View>

          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowGiftModal(false)}
          />
          <View style={styles.modalContainer}>
            {/* Drag handle (tray affordance) */}
            <View style={styles.sheetHandle} />
            {/* Header */}
            <View style={styles.modalHeader}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowGiftModal(false)}
                accessibilityRole="button"
                accessibilityLabel="Close gifts"
              >
                <Icon  name="close" size={24} color="#fff"  />
              </TouchableOpacity>
              <View style={styles.modalTitleBlock}>
                <Text style={styles.modalTitle}>Send a gift</Text>
                <Text style={styles.modalSubtitle}>Pick one, then send</Text>
              </View>
              <TouchableOpacity
                style={styles.balanceContainer}
                onPress={showWalletDebug}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Coin balance ${
                  walletState?.status === 'ok' || walletState?.lastUpdatedAt
                    ? Number(userBalance || 0).toLocaleString()
                    : 'unavailable'
                }`}
              >
                <Text style={styles.balanceLabel}>BALANCE</Text>
                <View style={styles.balanceTextRow}>
                  <CoinMark size={14} />
                  <Text style={styles.balanceText}>
                    {walletState?.status === 'ok' || walletState?.lastUpdatedAt
                      ? Number(userBalance || 0).toLocaleString()
                      : walletState?.status === 'loading'
                        ? '...'
                        : '-'}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Creator Info */}
            <View style={styles.creatorInfo}>
              <Text style={styles.recipientLabel}>RECIPIENT</Text>
              <Text style={styles.creatorText}>
                {battleSide ? `Side ${battleSide} · ` : ''}
                {getCreatorName()}
              </Text>
            </View>

            <View style={styles.giftSectionHeader}>
              <Text style={styles.giftSectionTitle}>Choose a gift</Text>
              <Text style={styles.giftSectionHint}>Every price below is per gift</Text>
            </View>

            {/* Horizontal gift carousel (swipe left/right) */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.giftCarousel}
              contentContainerStyle={styles.giftCarouselContent}
            >
              {[...(gifts || [])]
                .filter((g) => g)
                .sort((a, b) => Number(a?.cost || 0) - Number(b?.cost || 0))
                .map(renderGift)}
            </ScrollView>

            <View style={styles.giftActionBar}>
              <View style={styles.selectedGiftSummary}>
                {selectedGift ? (
                  <>
                    <Text style={styles.selectedGiftLabel}>SELECTED GIFT</Text>
                    <Text style={styles.selectedGiftName} numberOfLines={1}>
                      {selectedGift.emoji} {selectedGift.name}
                    </Text>
                    <View
                      style={
                        selectedGiftAffordable
                          ? styles.selectedGiftCostRow
                          : styles.selectedGiftCostRowInsufficient
                      }
                    >
                      <CoinMark size={12} />
                      <Text
                        style={
                          selectedGiftAffordable
                            ? styles.selectedGiftCost
                            : styles.selectedGiftCostInsufficient
                        }
                      >
                        {formatGiftCoins(selectedGiftCost)} coins
                        {!selectedGiftAffordable
                          ? ` · need ${formatGiftCoins(selectedGiftCost - userBalance)} more`
                          : ''}
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.selectedGiftName}>Select a gift</Text>
                    <Text style={styles.selectedGiftEmptyHint}>
                      Its coin cost will stay visible here.
                    </Text>
                  </>
                )}
              </View>

              <TouchableOpacity
                style={[
                  styles.giftActionButtonWrap,
                  (!selectedGift || sending || !selectedGiftAffordable) &&
                    styles.giftActionButtonWrapDisabled,
                ]}
                activeOpacity={0.85}
                disabled={!selectedGift || sending || !selectedGiftAffordable}
                onPress={() => selectedGift && handleSendGift(selectedGift)}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: !selectedGift || sending || !selectedGiftAffordable,
                }}
                accessibilityLabel={
                  selectedGift
                    ? `Send ${selectedGift.name} for ${selectedGiftCost.toLocaleString()} coins`
                    : 'Select a gift before sending'
                }
              >
                <LinearGradient
                  colors={[COLORS.gradientStart, COLORS.gradientMiddle, COLORS.gradientEnd]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.giftActionButton}
                >
                  <Text style={styles.giftActionButtonText}>
                    {sending ? 'Sending…' : selectedGift ? 'Send gift' : 'Choose gift'}
                  </Text>
                  {selectedGift ? (
                    <View style={styles.giftActionButtonCostRow}>
                      <CoinMark size={11} />
                      <Text style={styles.giftActionButtonCost}>
                        {formatGiftCoins(selectedGiftCost)} coins
                      </Text>
                    </View>
                  ) : null}
                </LinearGradient>
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  giftButton: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  giftButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  giftButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  feedTriggerOuter: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
  },
  feedTriggerStack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedTriggerRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    padding: 2,
  },
  feedTriggerInner: {
    flex: 1,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  feedTriggerGloss: {
    position: 'absolute',
    top: 4,
    left: 5,
    right: 5,
    height: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  feedTriggerLabel: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
    includeFontPadding: false,
  },
  giftCinemaStage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Own the top half so the bottom gift sheet never covers the cinema.
    height: '48%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
    elevation: 40,
    pointerEvents: 'none',
  },
  giftAnimationOverlay: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  animatedGiftEmoji: {
    fontSize: 48,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.40)',
  },
  modalContainer: {
    // Keep sheet in the bottom half so cinema has a clear stage above it.
    maxHeight: '52%',
    zIndex: 20,
    elevation: 20,
    backgroundColor: '#0A0A0C',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginTop: 10,
    marginBottom: 2,
  },
  giftCarousel: {
    paddingVertical: 10,
    overflow: 'hidden',
  },
  giftCarouselContent: {
    paddingHorizontal: 14,
    paddingRight: 20,
    gap: 12,
    alignItems: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#27272E',
    backgroundColor: '#111114',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  modalTitleBlock: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  modalSubtitle: {
    marginTop: 1,
    color: 'rgba(255,255,255,0.58)',
    fontSize: 11,
    fontWeight: '600',
  },
  balanceContainer: {
    minWidth: 92,
    alignItems: 'flex-end',
    backgroundColor: 'rgba(251,191,36,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.48)',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 14,
  },
  balanceLabel: {
    color: '#FDE68A',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  balanceTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  balanceText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
    includeFontPadding: false,
  },
  creatorInfo: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: 'rgba(0,210,190,0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,210,190,0.18)',
  },
  recipientLabel: {
    color: '#7FEDE2',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.9,
    textAlign: 'center',
  },
  creatorText: {
    color: '#fff',
    marginTop: 2,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  giftSectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  giftSectionTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  giftSectionHint: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 10,
    fontWeight: '600',
  },
  giftItem: {
    width: GIFT_TILE_WIDTH,
    height: 184,
    borderRadius: 18,
    overflow: 'hidden',
  },
  selectedGift: {
    transform: [{ scale: 1.015 }],
  },
  giftOuterFrame: {
    flex: 1,
    padding: 1.5,
    borderRadius: 18,
  },
  giftOuterFrameSelected: {
    padding: 3,
  },
  giftInnerFrame: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(15,23,42,0.60)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 6,
  },
  giftGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 8,
    position: 'relative',
  },
  giftRarityChip: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(10,10,12,0.64)',
    zIndex: 20,
    elevation: 20,
  },
  giftRarityChipPremium: {
    borderColor: 'rgba(255,255,255,0.28)',
  },
  giftRarityText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.45,
    includeFontPadding: false,
  },
  giftSelectedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00D2BE',
    borderWidth: 2,
    borderColor: '#fff',
    zIndex: 22,
    elevation: 22,
  },
  giftSelectedBadgeText: {
    color: '#071513',
    fontSize: 14,
    fontWeight: '900',
    includeFontPadding: false,
  },
  giftGlow: {
    position: 'absolute',
    top: -18,
    left: -18,
    right: -18,
    bottom: -18,
    borderRadius: 999,
    opacity: 0.35,
  },
  giftArtPanel: {
    width: '100%',
    height: 82,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(15,23,42,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  giftArtBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  giftArtOrb: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    opacity: 0.18,
    top: -32,
    right: -30,
  },
  giftArtOrb2: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    opacity: 0.12,
    bottom: -30,
    left: -28,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  giftArtStripe: {
    position: 'absolute',
    width: 120,
    height: 18,
    borderRadius: 9,
    opacity: 0.10,
    backgroundColor: 'rgba(255,255,255,0.9)',
    transform: [{ rotate: '-18deg' }],
  },
  giftGloss: {
    position: 'absolute',
    top: 6,
    left: 8,
    right: 8,
    height: 18,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  giftFoilSweep: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    width: 48,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 24,
  },
  giftSparkleTL: {
    position: 'absolute',
    top: 6,
    left: 8,
    fontSize: 12,
    opacity: 0.55,
    color: '#fff',
  },
  giftSparkleBR: {
    position: 'absolute',
    bottom: 8,
    right: 10,
    fontSize: 10,
    opacity: 0.4,
    color: '#fff',
  },
  giftEmojiWrap: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(15,23,42,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  giftEmoji: {
    fontSize: 31,
    lineHeight: 36,
    textAlign: 'center',
  },
  giftTileMeta: {
    flex: 1,
    width: '100%',
    paddingTop: 8,
    alignItems: 'center',
  },
  giftPriceRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 11,
    backgroundColor: 'rgba(10,10,12,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.54)',
  },
  giftPriceRowSelected: {
    backgroundColor: 'rgba(0,210,190,0.18)',
    borderColor: '#7FEDE2',
  },
  giftName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    includeFontPadding: false,
  },
  coinIcon: {
    fontSize: 14,
  },
  costText: {
    color: '#FDE68A',
    fontSize: 17,
    fontWeight: '900',
  },
  costUnit: {
    color: '#FDE68A',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  giftAvailabilityText: {
    marginTop: 5,
    color: 'rgba(255,255,255,0.62)',
    fontSize: 10,
    fontWeight: '700',
  },
  giftShortfallText: {
    marginTop: 5,
    color: '#FDA4AF',
    fontSize: 10,
    fontWeight: '800',
  },
  giftActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: '#111114',
    borderTopWidth: 1,
    borderTopColor: '#27272E',
  },
  selectedGiftSummary: {
    flex: 1,
    minWidth: 0,
  },
  selectedGiftLabel: {
    color: '#7FEDE2',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  selectedGiftName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  selectedGiftCostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  selectedGiftCostRowInsufficient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  selectedGiftCost: {
    marginTop: 3,
    color: '#FDE68A',
    fontSize: 13,
    fontWeight: '900',
  },
  selectedGiftCostInsufficient: {
    marginTop: 3,
    color: '#FDA4AF',
    fontSize: 11,
    fontWeight: '800',
  },
  selectedGiftEmptyHint: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontWeight: '600',
  },
  giftActionButtonWrap: {
    width: 148,
    borderRadius: 16,
    overflow: 'hidden',
  },
  giftActionButtonWrapDisabled: {
    opacity: 0.42,
  },
  giftActionButton: {
    minHeight: 58,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  giftActionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  giftActionButtonCostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  giftActionButtonCost: {
    marginTop: 2,
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  modalFooter: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#141418',
  },
  footerText: {
    color: '#A1A1AA',
    fontSize: 12,
    textAlign: 'center',
  },
  
  // Disney Pixar Heart Animation Styles - Pure Magic! 🎬✨
  heartAnimationContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 41,
    pointerEvents: 'none',
  },
  animatedHeart: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 50,
    shadowColor: COLORS.gradientEnd,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 20,
  },
  heartGradient: {
    padding: 20,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.gradientEnd,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 15,
  },
  magicalHeart: {
    fontSize: 60,
    textShadowColor: COLORS.gradientEnd,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 15,
  },
  sparkle: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleText: {
    fontSize: 20,
    textShadowColor: '#ffd700',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
});

export default GiftSystem;