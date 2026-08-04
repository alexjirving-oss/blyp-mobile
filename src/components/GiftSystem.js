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

const { width } = Dimensions.get('window');

import { shouldUseLiveServiceWallet } from '../utils/walletSource';

const GiftSystem = ({
  postId,
  creatorId,
  creatorName,
  hideTrigger = false,
  triggerVariant = 'default',
  openSignal,
  navigation,
  incomingGiftEvent,
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
  const [gifts, setGifts] = useState(() => BlypCoinService.getGiftTypes());
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
      return;
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
      Alert.alert('Login Required', 'Please sign in to send gifts.');
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
          pendingGiftRef.current.streamId === String(postId);
        if (!sameAsPending) {
          pendingGiftRef.current = {
            giftId: String(gift.id),
            creatorId: String(creatorId),
            streamId: String(postId),
            key: makeIdempotencyKey('gift'),
          };
        }
        const out = await sendEconomyGift({
          streamId: String(postId),
          receiverUserId: String(creatorId),
          giftId: String(gift.id),
          quantity: 1,
          idempotencyKey: pendingGiftRef.current.key,
        });
        // Success: clear so the next gift uses a fresh key.
        pendingGiftRef.current = null;

        // Keep balance in sync with server response.
        const nextBalance =
          Number(out?.newBalances?.coinBalance || 0) + Number(out?.newBalances?.bonusCoinBalance || 0);
        setUserBalance(nextBalance);
      } else {
        if (!authReady || !isAuthenticated || !uid) throw new Error('Not signed in');
        const result = await BlypCoinService.sendGift(String(uid), String(creatorId), String(gift.id), Number(gift.cost || 0));
        const nextBalance = Number(result?.senderBalance || 0);
        setUserBalance(nextBalance);
        setWalletState({ status: 'ok', lastError: null, lastUpdatedAt: Date.now() });
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
      } else if (code === 'ACCOUNT_BANNED' || httpStatus === 403) {
        Alert.alert('Gift unavailable', 'This account is restricted from sending gifts right now.');
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
    if (gift.name === 'Heart' || gift.emoji === '❤️') {
      triggerDisneyHeartAnimation();
    } else {
      // Regular gift animation for other gifts
      Animated.sequence([
        Animated.timing(giftAnimation, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(giftAnimation, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        })
      ]).start();
    }
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
    const colors = {
      // 3-stop gradients read more "illustrated" than flat 2-stop.
      common: ['#3F3F46', '#71717A', '#A1A1AA'],
      rare: ['#1d4ed8', '#3b82f6', '#60a5fa'],
      epic: ['#6d28d9', '#8b5cf6', '#c084fc'],
      legendary: ['#b45309', '#f59e0b', '#fde68a']
    };
    return colors[rarity] || colors.common;
  };

  const renderGift = (gift) => {
    const rarity = String(gift?.rarity || 'common');
    const isPremium = rarity === 'epic' || rarity === 'legendary';
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
      >
        <LinearGradient
          colors={rarityColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.giftOuterFrame}
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

                <View style={styles.giftEmojiWrap}>
                  <Text style={styles.giftEmoji}>{gift.emoji}</Text>
                </View>
              </View>

              {/* Name + price (always visible) */}
              <View style={styles.giftTileMeta}>
                <Text style={styles.giftName} numberOfLines={1}>
                  {gift.name}
                </Text>
                <View style={styles.giftPriceRow}>
                  <Text style={styles.coinIcon}>🪙</Text>
                  <Text style={styles.costText}>{gift.cost}</Text>
                </View>
              </View>

              {/* Selected: dim the tile and float a centered Send button on top.
                  Absolutely positioned so it's always visible/centered regardless
                  of tile size (the old in-flow button was clipped on narrow tiles).
                  Tap repeatedly to stack/combo gifts. */}
              {isSelected ? (
                <View style={styles.giftSelectedOverlay} pointerEvents="box-none">
                  <TouchableOpacity
                    style={styles.giftSendCenter}
                    activeOpacity={0.85}
                    // Only hard-disable once the wallet is loaded and truly short on
                    // coins. While the wallet is still loading/idle we keep it
                    // tappable so handleSendGift can surface "Loading your wallet…".
                    disabled={sending || (walletState?.status === 'ok' && userBalance < gift.cost)}
                    onPress={() => handleSendGift(gift)}
                  >
                    <LinearGradient
                      colors={[COLORS.gradientStart, COLORS.gradientMiddle, COLORS.gradientEnd]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.giftSendButton}
                    >
                      <Text style={styles.giftSendText}>{sending ? 'Sending…' : 'Send'}</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Only show the lock once we KNOW the balance is too low (wallet
                  loaded). Showing it during load made every gift look locked even
                  when the user had plenty of coins. */}
              {walletState?.status === 'ok' && userBalance < gift.cost && (
                <View style={styles.insufficientOverlay} pointerEvents="none">
                  <Icon name="lock-closed" size={16} color={COLORS.white} />
                </View>
              )}
            </LinearGradient>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  return (
    <>
      {!hideTrigger ? (
        triggerVariant === 'feed' ? (
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
                  <Icon name="gift" size={26} color={COLORS.white} />
                </View>
              </LinearGradient>
              <Text style={styles.feedTriggerLabel} allowFontScaling={false}>
                Gift
              </Text>
            </View>
          </TouchableOpacity>
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

      {/* Gift Animation Overlay */}
      {selectedGift && (
        <Animated.View
          style={[
            styles.giftAnimationOverlay,
            {
              opacity: giftAnimation,
              transform: [
                {
                  scale: giftAnimation.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.5, 2]
                  })
                }
              ]
            }
          ]}
          pointerEvents="none"
        >
          <Text style={styles.animatedGiftEmoji}>{selectedGift.emoji}</Text>
        </Animated.View>
      )}

      {/* Disney Pixar Heart Animation Overlay - Pure Magic! ✨ */}
      {showHeartAnimation && (
        <View style={styles.heartAnimationContainer} pointerEvents="none">
          {/* Main Heart with all the Disney magic */}
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
                      outputRange: ['0deg', '360deg']
                    })
                  },
                  { translateY: heartY }
                ]
              }
            ]}
          >
            <LinearGradient
              colors={[COLORS.gradientStart, COLORS.gradientMiddle, COLORS.gradientEnd]}
              style={styles.heartGradient}
            >
              <Text style={styles.magicalHeart}>❤️</Text>
            </LinearGradient>
          </Animated.View>

          {/* Sparkle Particle System */}
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
                        outputRange: ['0deg', '720deg']
                      })
                    }
                  ]
                }
              ]}
            >
              <Text style={styles.sparkleText}>✨</Text>
            </Animated.View>
          ))}
        </View>
      )}

      {/* Gift Selection Modal */}
      <Modal
        visible={showGiftModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowGiftModal(false)}
      >
        <View style={styles.modalOverlay}>
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
              >
                <Icon  name="close" size={24} color="#fff"  />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Send Gift</Text>
              <View style={styles.balanceContainer}>
                <TouchableOpacity onPress={showWalletDebug} activeOpacity={0.8}>
                  <Text style={styles.balanceText}>
                    🪙{' '}
                    {walletState?.status === 'ok' || walletState?.lastUpdatedAt
                      ? Number(userBalance || 0).toLocaleString()
                      : walletState?.status === 'loading'
                        ? '…'
                        : '—'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Creator Info */}
            <View style={styles.creatorInfo}>
              <Text style={styles.creatorText}>Sending to: {getCreatorName()}</Text>
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
  },
  feedTriggerStack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedTriggerRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    padding: 2,
  },
  feedTriggerInner: {
    flex: 1,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  feedTriggerGloss: {
    position: 'absolute',
    top: 5,
    left: 6,
    right: 6,
    height: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  feedTriggerLabel: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
    includeFontPadding: false,
  },
  giftAnimationOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -30,
    marginTop: -30,
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 1000,
  },
  animatedGiftEmoji: {
    fontSize: 40,
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
    backgroundColor: 'rgba(10, 10, 12, 0.94)',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingBottom: 22,
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
    paddingVertical: 14,
  },
  giftCarouselContent: {
    paddingHorizontal: 14,
    gap: 12,
    alignItems: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272E',
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  closeButton: {
    padding: 4,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  balanceContainer: {
    backgroundColor: '#fbbf24',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  balanceText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  creatorInfo: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  creatorText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
  giftItem: {
    width: 104,
    aspectRatio: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  selectedGift: {
    transform: [{ scale: 0.95 }],
  },
  giftOuterFrame: {
    flex: 1,
    padding: 1.25,
    borderRadius: 18,
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
    zIndex: 20,
    elevation: 20,
  },
  giftRarityChipPremium: {
    borderColor: 'rgba(255,255,255,0.28)',
  },
  giftRarityText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
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
    height: 64,
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
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  giftEmoji: {
    fontSize: 26,
  },
  giftTileMeta: {
    width: '100%',
    paddingTop: 6,
    alignItems: 'center',
  },
  giftPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  giftNamePlate: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    zIndex: 15,
    elevation: 15,
  },
  giftName: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
  },
  giftSelectedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    backgroundColor: 'rgba(10,10,12,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 25,
  },
  giftSendCenter: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  giftSendButton: {
    paddingVertical: 9,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  giftSendText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    includeFontPadding: false,
  },
  giftPriceBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 20,
    elevation: 20,
  },
  coinIcon: {
    fontSize: 12,
  },
  costText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  insufficientOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
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