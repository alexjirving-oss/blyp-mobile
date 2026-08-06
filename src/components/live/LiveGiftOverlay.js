/**
 * LiveGiftOverlay — Blyp Gift Motion System playback surface.
 *
 * Combo banners (teal/sport energy), floaters, particle bursts, and
 * motif-specific hero takeovers (GiftHeroFx). Tap-to-skip on epic+.
 * Device-tier particle budgets for mid Android / Fold7-class high.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import BlypCoinService from '../../services/BlypCoinService';
import GiftHeroFx, { ShimmerSweep } from './giftMotion/GiftHeroFx';
import GiftCinematicPlayer from './giftMotion/GiftCinematicPlayer';
import {
  cinemaHoldMs,
  comboHeat,
  crossedComboMilestone,
  getFxBudget,
  getTierConfig,
  heroHoldMs,
  paletteForRarity,
  resolveMotion,
  TEAL,
} from './giftMotion/giftMotionSystem';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const COMBO_IDLE_MS = 3400;

const FALLBACK_LOOKUP = (() => {
  const map = {};
  try {
    for (const g of BlypCoinService.getGiftTypes() || []) {
      if (g?.id) map[String(g.id).toLowerCase()] = g;
    }
  } catch {
    // ignore
  }
  return map;
})();

function resolveGift(giftId) {
  const key = String(giftId || '').toLowerCase();
  const match = FALLBACK_LOOKUP[key];
  const motion = resolveMotion(key, match || {});
  return {
    emoji: motion.emoji,
    name: motion.name,
    rarity: motion.rarity,
    cost: motion.coinCost,
    motion,
  };
}

function senderLabel(sender) {
  const handle = sender?.handle;
  if (typeof handle === 'string' && handle.trim()) {
    return handle.startsWith('@') ? handle : `@${handle}`;
  }
  return 'Someone';
}

function receiverLabel(receiver) {
  const handle = receiver?.handle;
  if (typeof handle === 'string' && handle.trim()) {
    return handle.startsWith('@') ? handle : `@${handle}`;
  }
  return 'host';
}

let UID = 0;
const nextId = () => `${Date.now()}-${UID++}`;

const LiveGiftOverlay = ({ giftEvent, style }) => {
  const budget = useMemo(() => getFxBudget(), []);
  const [banners, setBanners] = useState([]);
  const [floaters, setFloaters] = useState([]);
  const [particles, setParticles] = useState([]);
  const [bigGift, setBigGift] = useState(null);
  const [edgeColor, setEdgeColor] = useState(TEAL);
  const bannersRef = useRef([]);
  const timersRef = useRef({});
  const processedRef = useRef(new Set());
  const bigGiftTimerRef = useRef(null);
  const bigGiftEntryRef = useRef(null);
  const edgeFlash = useRef(new Animated.Value(0)).current;

  bannersRef.current = banners;

  const dismissBigGift = useCallback((entry) => {
    const target = entry || bigGiftEntryRef.current;
    if (!target) {
      setBigGift(null);
      return;
    }
    if (bigGiftTimerRef.current) {
      clearTimeout(bigGiftTimerRef.current);
      bigGiftTimerRef.current = null;
    }
    (target.loops || []).forEach((l) => {
      try {
        l.stop();
      } catch {
        // ignore
      }
    });
    if (target.cinematicV2) {
      if (bigGiftEntryRef.current === target) bigGiftEntryRef.current = null;
      setBigGift(null);
      return;
    }
    Animated.parallel([
      Animated.timing(target.opacity, { toValue: 0, duration: 280, useNativeDriver: true }),
      Animated.timing(target.scale, { toValue: 1.25, duration: 280, useNativeDriver: true }),
      Animated.timing(target.vignette, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start(() => {
      if (bigGiftEntryRef.current === target) bigGiftEntryRef.current = null;
      setBigGift(null);
    });
  }, []);

  const removeBanner = useCallback((id) => {
    const banner = bannersRef.current.find((b) => b.id === id);
    if (!banner) return;
    Animated.parallel([
      Animated.timing(banner.x, {
        toValue: -SCREEN_W,
        duration: 340,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(banner.opacity, {
        toValue: 0,
        duration: 340,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setBanners((prev) => prev.filter((b) => b.id !== id));
    });
  }, []);

  const scheduleExpiry = useCallback(
    (id) => {
      if (timersRef.current[id]) clearTimeout(timersRef.current[id]);
      timersRef.current[id] = setTimeout(() => {
        delete timersRef.current[id];
        removeBanner(id);
      }, COMBO_IDLE_MS);
    },
    [removeBanner]
  );

  const bumpCombo = useCallback((banner) => {
    banner.combo.setValue(0);
    Animated.spring(banner.combo, {
      toValue: 1,
      friction: 4,
      tension: 140,
      useNativeDriver: true,
    }).start();
    banner.fuse.stopAnimation();
    banner.fuse.setValue(1);
    Animated.timing(banner.fuse, {
      toValue: 0,
      duration: COMBO_IDLE_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, []);

  const flashEdges = useCallback(
    (color) => {
      setEdgeColor(color);
      edgeFlash.stopAnimation();
      edgeFlash.setValue(0);
      Animated.sequence([
        Animated.timing(edgeFlash, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(edgeFlash, {
          toValue: 0,
          duration: 560,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // best-effort
      }
    },
    [edgeFlash]
  );

  const spawnFloater = useCallback(
    (emoji, particles) => {
      const id = nextId();
      const pool = particles?.length ? particles : [emoji, '✨', '💫'];
      const floater = {
        id,
        emoji: Math.random() < 0.4 ? pool[Math.floor(Math.random() * pool.length)] : emoji,
        progress: new Animated.Value(0),
        drift: (Math.random() - 0.5) * 80,
        startX: 18 + Math.random() * 52,
        spin: (Math.random() - 0.5) * 100,
      };
      setFloaters((prev) => {
        const next = [...prev, floater];
        return next.length > budget.maxFloaters
          ? next.slice(next.length - budget.maxFloaters)
          : next;
      });
      Animated.timing(floater.progress, {
        toValue: 1,
        duration: 2600 + Math.random() * 500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setFloaters((prev) => prev.filter((f) => f.id !== id));
      });
    },
    [budget.maxFloaters]
  );

  const spawnBurst = useCallback(
    (origin, opts = {}) => {
      const {
        count = budget.burstNormal,
        emojis = ['✨', '💫', '⭐'],
        power = 120,
        gravity = 170,
        big = false,
      } = opts;
      const batch = [];
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.55;
        const dist = power * (0.45 + Math.random() * 0.85);
        batch.push({
          id: nextId(),
          emoji: emojis[Math.floor(Math.random() * emojis.length)],
          progress: new Animated.Value(0),
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist,
          gravity,
          rot: (Math.random() - 0.5) * 720,
          size: (big ? 22 : 15) + Math.random() * (big ? 18 : 11),
          x: origin.x,
          y: origin.y,
        });
      }
      setParticles((prev) => {
        const next = [...prev, ...batch];
        return next.length > budget.maxParticles
          ? next.slice(next.length - budget.maxParticles)
          : next;
      });
      batch.forEach((p) => {
        Animated.timing(p.progress, {
          toValue: 1,
          duration: big ? 1500 : 1050,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start(() => {
          setParticles((prev) => prev.filter((q) => q.id !== p.id));
        });
      });
    },
    [budget.burstNormal, budget.maxParticles]
  );

  const triggerHero = useCallback(
    (gift, sender, receiver) => {
      if (bigGiftTimerRef.current) {
        clearTimeout(bigGiftTimerRef.current);
        bigGiftTimerRef.current = null;
      }
      try {
        const heavy =
          gift.motion.motionTier === 'legendary' || gift.motion.motionTier === 'ultimate';
        Haptics.impactAsync(
          heavy ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium
        );
      } catch {
        // best-effort
      }

      const motion = gift.motion;
      const tier = getTierConfig(motion.motionTier);
      const useCinema = !!motion.cinematicV2 && budget.skiaCinema !== false;
      const intensity = Math.max(0.35, Math.min(1, (Number(motion.coinCost) || 25) / 100));
      const emojiSize =
        tier.takeover === 'spotlight' ? 64 + intensity * 28 : 88 + intensity * 48;
      const holdMs = useCinema ? cinemaHoldMs(motion) : heroHoldMs(motion);
      const power = 150 + intensity * 150;
      const wave1 = Math.round(
        budget.burstBig * (0.55 + intensity * 0.45) * (useCinema ? 0.35 : 1)
      );
      const wave2 = Math.round(wave1 * 0.65);

      const entry = {
        gift,
        motion,
        sender,
        receiver,
        cinematicV2: useCinema,
        size: emojiSize,
        scale: new Animated.Value(0.28),
        opacity: new Animated.Value(0),
        glow: new Animated.Value(0),
        bob: new Animated.Value(0),
        rays: new Animated.Value(0),
        vignette: new Animated.Value(0),
        vignetteMax: tier.takeover === 'spotlight' ? 0.12 : 0.24 + intensity * 0.18,
        rings: Array.from({ length: budget.rings }, () => new Animated.Value(0)),
        loops: [],
      };
      bigGiftEntryRef.current = entry;
      setBigGift(entry);

      if (useCinema) {
        // Cinema player owns its clock / dismiss; keep a safety timer only.
        Animated.timing(entry.opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
        // Soft ambient burst (geometry cinema is the hero — avoid emoji spam)
        const origin = {
          x: SCREEN_W / 2 - 16,
          y: SCREEN_H * (tier.takeover === 'spotlight' ? 0.28 : 0.34),
        };
        spawnBurst(origin, {
          count: Math.max(4, wave1),
          emojis: ['✨', '✦'],
          power: power * 0.55,
          big: false,
        });
        bigGiftTimerRef.current = setTimeout(() => dismissBigGift(entry), holdMs + 500);
        return;
      }

      const glowLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(entry.glow, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(entry.glow, {
            toValue: 0,
            duration: 700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
      const bobLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(entry.bob, {
            toValue: 1,
            duration: 1050,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(entry.bob, {
            toValue: 0,
            duration: 1050,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );
      const raysLoop = Animated.loop(
        Animated.timing(entry.rays, {
          toValue: 1,
          duration: 8500,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      entry.loops = [glowLoop, bobLoop, raysLoop];

      Animated.parallel([
        Animated.spring(entry.scale, { toValue: 1, friction: 5, tension: 100, useNativeDriver: true }),
        Animated.timing(entry.opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(entry.vignette, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
      glowLoop.start();
      bobLoop.start();
      raysLoop.start();

      entry.rings.forEach((ring, i) => {
        Animated.timing(ring, {
          toValue: 1,
          duration: 980,
          delay: i * 170,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      });

      const origin = { x: SCREEN_W / 2 - 16, y: SCREEN_H * (tier.takeover === 'spotlight' ? 0.28 : 0.34) };
      spawnBurst(origin, {
        count: wave1,
        emojis: motion.particles || [motion.emoji],
        power,
        big: true,
      });
      setTimeout(
        () =>
          spawnBurst(origin, {
            count: wave2,
            emojis: motion.particles || ['✨'],
            power: power * 0.62,
            big: true,
          }),
        220
      );

      bigGiftTimerRef.current = setTimeout(() => dismissBigGift(entry), holdMs);
    },
    [budget.burstBig, budget.rings, dismissBigGift, spawnBurst]
  );

  useEffect(() => {
    if (!giftEvent) return;
    const eventId = giftEvent.giftEventId || `${giftEvent.giftId}:${giftEvent.sequenceNo}`;
    if (processedRef.current.has(eventId)) return;
    processedRef.current.add(eventId);
    if (processedRef.current.size > 200) {
      processedRef.current = new Set(Array.from(processedRef.current).slice(-100));
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // best-effort
    }

    const gift = resolveGift(giftEvent.giftId);
    const quantity = Math.max(1, Number(giftEvent.quantity) || 1);
    const senderId = giftEvent.sender?.userId || 'anon';
    const key = `${senderId}:${String(giftEvent.giftId || '').toLowerCase()}`;
    const tier = getTierConfig(gift.motion.motionTier);

    spawnFloater(gift.emoji, gift.motion.particles);
    spawnBurst(
      { x: 70, y: SCREEN_H - 205 },
      {
        count: budget.burstNormal,
        emojis: gift.motion.particles || [gift.emoji, '✨'],
        power: 90,
      }
    );

    // Mid = spotlight; epic+ = fullscreen takeover
    if (tier.takeover === 'fullscreen' || tier.takeover === 'spotlight') {
      triggerHero(gift, giftEvent.sender || null, giftEvent.receiver || null);
    }

    const existing = bannersRef.current.find((b) => b.key === key);
    if (existing) {
      const ms = crossedComboMilestone(existing.count, existing.count + quantity);
      if (ms) flashEdges(ms.color);
      bumpCombo(existing);
      scheduleExpiry(existing.id);
      setBanners((prev) =>
        prev.map((b) => (b.id === existing.id ? { ...b, count: b.count + quantity } : b))
      );
      return;
    }

    const firstMs = crossedComboMilestone(0, quantity);
    if (firstMs) flashEdges(firstMs.color);

    const banner = {
      id: nextId(),
      key,
      sender: giftEvent.sender || null,
      receiver: giftEvent.receiver || null,
      gift,
      count: quantity,
      x: new Animated.Value(-SCREEN_W),
      opacity: new Animated.Value(0),
      combo: new Animated.Value(0),
      fuse: new Animated.Value(1),
    };

    setBanners((prev) => {
      let next = [...prev, banner];
      if (next.length > budget.maxBanners) {
        const overflow = next.slice(0, next.length - budget.maxBanners);
        overflow.forEach((b) => {
          if (timersRef.current[b.id]) {
            clearTimeout(timersRef.current[b.id]);
            delete timersRef.current[b.id];
          }
        });
        next = next.slice(next.length - budget.maxBanners);
      }
      return next;
    });

    Animated.parallel([
      Animated.spring(banner.x, {
        toValue: 0,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(banner.opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
    bumpCombo(banner);
    scheduleExpiry(banner.id);
  }, [
    giftEvent,
    bumpCombo,
    scheduleExpiry,
    spawnFloater,
    spawnBurst,
    triggerHero,
    flashEdges,
    budget.burstNormal,
    budget.maxBanners,
  ]);

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach((t) => clearTimeout(t));
      timersRef.current = {};
      if (bigGiftTimerRef.current) clearTimeout(bigGiftTimerRef.current);
    };
  }, []);

  // Container: box-none so tap-to-skip on hero works without blocking live UI
  return (
    <View style={[styles.container, style]} pointerEvents="box-none">
      <Animated.View
        pointerEvents="none"
        style={[styles.edgeFlash, { borderColor: edgeColor, opacity: edgeFlash }]}
      />

      {bigGift?.cinematicV2 ? (
        <GiftCinematicPlayer
          entry={bigGift}
          onSkip={() => dismissBigGift(bigGift)}
          onDone={() => dismissBigGift(bigGift)}
        />
      ) : bigGift ? (
        <GiftHeroFx entry={bigGift} onSkip={() => dismissBigGift(bigGift)} />
      ) : null}

      <View style={styles.bannerStack} pointerEvents="none">
        {banners.map((banner) => {
          const colors =
            banner.gift.motion?.palette ||
            paletteForRarity(banner.gift.rarity) ||
            [TEAL, TEAL, '#fff'];
          const comboScale = banner.combo.interpolate({
            inputRange: [0, 1],
            outputRange: [1.75, 1],
          });
          const ct = comboHeat(banner.count);
          const avatarUrl = banner.sender?.avatarUrl;
          const label = senderLabel(banner.sender);
          return (
            <Animated.View
              key={banner.id}
              style={[
                styles.banner,
                {
                  opacity: banner.opacity,
                  transform: [{ translateX: banner.x }],
                  shadowColor: ct.glow,
                },
              ]}
            >
              <LinearGradient
                colors={colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.bannerGradient}
              >
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarLetter}>
                      {label.replace('@', '').charAt(0).toUpperCase() || '?'}
                    </Text>
                  </View>
                )}
                <View style={styles.bannerText}>
                  <Text style={styles.bannerSender} numberOfLines={1}>
                    {label}
                  </Text>
                  <Text style={styles.bannerAction} numberOfLines={1}>
                    sent {banner.gift.name} → {receiverLabel(banner.receiver)}
                    {ct.label && banner.count >= 10 ? ` · ${ct.label}` : ''}
                  </Text>
                </View>
                <Text style={styles.bannerEmoji}>{banner.gift.emoji}</Text>
                {ct.flame ? <Text style={styles.comboFlame}>🔥</Text> : null}
                <Animated.Text
                  style={[
                    styles.comboText,
                    {
                      color: ct.color,
                      textShadowColor: ct.glow,
                      fontSize: ct.size,
                      transform: [{ scale: comboScale }],
                    },
                  ]}
                >
                  x{banner.count}
                </Animated.Text>
                <Animated.View
                  style={[
                    styles.fuse,
                    { backgroundColor: ct.glow, transform: [{ scaleX: banner.fuse }] },
                  ]}
                />
                <ShimmerSweep width={70} />
              </LinearGradient>
            </Animated.View>
          );
        })}
      </View>

      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {floaters.map((floater) => {
          const translateY = floater.progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -300],
          });
          const translateX = floater.progress.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0, floater.drift, floater.drift * 1.45],
          });
          const opacity = floater.progress.interpolate({
            inputRange: [0, 0.12, 0.78, 1],
            outputRange: [0, 1, 1, 0],
          });
          const scale = floater.progress.interpolate({
            inputRange: [0, 0.18, 1],
            outputRange: [0.55, 1.15, 0.88],
          });
          const rotate = floater.progress.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', `${floater.spin}deg`],
          });
          return (
            <Animated.Text
              key={floater.id}
              style={[
                styles.floater,
                {
                  left: floater.startX,
                  opacity,
                  transform: [{ translateY }, { translateX }, { scale }, { rotate }],
                },
              ]}
            >
              {floater.emoji}
            </Animated.Text>
          );
        })}

        {particles.map((p) => {
          const translateX = p.progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] });
          const translateY = p.progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, p.dy + p.gravity],
          });
          const opacity = p.progress.interpolate({
            inputRange: [0, 0.1, 0.7, 1],
            outputRange: [0, 1, 1, 0],
          });
          const scale = p.progress.interpolate({
            inputRange: [0, 0.2, 1],
            outputRange: [0.4, 1, 0.5],
          });
          const rotate = p.progress.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', `${p.rot}deg`],
          });
          return (
            <Animated.Text
              key={p.id}
              style={[
                styles.particle,
                {
                  left: p.x,
                  top: p.y,
                  fontSize: p.size,
                  opacity,
                  transform: [{ translateX }, { translateY }, { scale }, { rotate }],
                },
              ]}
            >
              {p.emoji}
            </Animated.Text>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 900,
  },
  edgeFlash: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 7,
  },
  bannerStack: {
    position: 'absolute',
    left: 10,
    bottom: 150,
    gap: 8,
    zIndex: 5,
  },
  banner: {
    borderRadius: 26,
    overflow: 'hidden',
    maxWidth: SCREEN_W * 0.76,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 10,
  },
  bannerGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 12,
    gap: 8,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  bannerText: {
    flexShrink: 1,
    justifyContent: 'center',
  },
  bannerSender: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  bannerAction: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 11,
    fontWeight: '600',
  },
  bannerEmoji: {
    fontSize: 30,
    marginLeft: 2,
  },
  comboFlame: {
    fontSize: 15,
    marginLeft: 2,
  },
  comboText: {
    fontWeight: '900',
    fontStyle: 'italic',
    marginLeft: 2,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  fuse: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 3,
    width: '100%',
    borderRadius: 2,
    opacity: 0.95,
  },
  floater: {
    position: 'absolute',
    bottom: 130,
    fontSize: 30,
  },
  particle: {
    position: 'absolute',
    fontSize: 18,
  },
});

export default React.memo(LiveGiftOverlay);
