import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { COLORS } from '../../styles/theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const MAX_BANNERS = 3;
// A burst of the same gift from the same sender keeps stacking the combo
// counter until this much idle time passes, then the banner flies away.
const COMBO_IDLE_MS = 3400;
const MAX_FLOATERS = 16;
const MAX_PARTICLES = 64;

const RARITY_COLORS = {
  common: ['#3F3F46', '#71717A', '#A1A1AA'],
  rare: ['#1d4ed8', '#3b82f6', '#60a5fa'],
  epic: ['#6d28d9', '#8b5cf6', '#c084fc'],
  legendary: ['#b45309', '#f59e0b', '#fde68a'],
};

const SPARKLES = ['✨', '🌟', '💫', '⭐'];

// Combo styling tiers – the higher the streak, the hotter it looks.
function comboStyle(count) {
  if (count >= 100) return { color: '#FDE68A', glow: '#F59E0B', flame: '🔥', size: 32 };
  if (count >= 50) return { color: '#FCA5A5', glow: '#EF4444', flame: '🔥', size: 30 };
  if (count >= 20) return { color: '#FDBA74', glow: '#F97316', flame: '🔥', size: 29 };
  if (count >= 10) return { color: '#C4B5FD', glow: '#8B5CF6', flame: '⚡', size: 28 };
  return { color: '#fff', glow: COLORS.gradientEnd || '#f59e0b', flame: null, size: 26 };
}

// Static lookup so we can resolve emoji/name/rarity from a bare giftId.
const GIFT_LOOKUP = (() => {
  const map = {};
  try {
    for (const g of BlypCoinService.getGiftTypes() || []) {
      if (g?.id) map[String(g.id).toLowerCase()] = g;
    }
  } catch {
    // ignore – fall back to generic gift
  }
  return map;
})();

function resolveGift(giftId) {
  const key = String(giftId || '').toLowerCase();
  const match = GIFT_LOOKUP[key];
  if (match) {
    return {
      emoji: match.emoji || '🎁',
      name: match.name || giftId,
      rarity: match.rarity || 'common',
      cost: Number(match.cost) || 0,
    };
  }
  return { emoji: '🎁', name: giftId || 'Gift', rarity: 'common', cost: 0 };
}

// Combo streak milestones that fire a screen-edge flash, in escalating colors.
function crossedMilestone(oldC, newC) {
  const tiers = [
    { at: 500, color: '#FACC15' },
    { at: 200, color: '#A855F7' },
    { at: 100, color: '#EF4444' },
    { at: 50, color: '#F97316' },
  ];
  for (const t of tiers) {
    if (oldC < t.at && newC >= t.at) return t;
  }
  return null;
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

/**
 * A diagonal light-gloss that sweeps across its (overflow-hidden) parent on a
 * gentle loop – the modern "premium card" shimmer. Pure transform, native
 * driver, so it's cheap.
 */
function Shimmer({ width = 80, period = 1500, delay = 1100 }) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(x, {
          toValue: 1,
          duration: period,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(delay),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [x, period, delay]);

  const translateX = x.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, SCREEN_W * 0.8],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { transform: [{ translateX }, { skewX: '-20deg' }] }]}
    >
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.55)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ width, height: '200%' }}
      />
    </Animated.View>
  );
}

/**
 * TikTok-style live gift overlay – fully modernised.
 *
 * - Glossy, rarity-tinted sender banners with a shimmer sweep and a combo
 *   counter that heats up (purple → orange → fire) the higher the streak.
 * - A sparkle particle burst on every gift.
 * - A cinematic full-screen takeover for epic / legendary gifts: rotating
 *   light rays, expanding shockwave rings, a particle explosion, a floating
 *   bob on the emoji and a soft vignette to pull focus.
 *
 * Pure JS / Animated (native driver) – cross-platform, no extra native deps.
 *
 * Props:
 *  - giftEvent: latest GiftEventPayload (identity changes per event)
 */
const LiveGiftOverlay = ({ giftEvent, style }) => {
  const [banners, setBanners] = useState([]);
  const [floaters, setFloaters] = useState([]);
  const [particles, setParticles] = useState([]);
  const [bigGift, setBigGift] = useState(null);
  const [edgeColor, setEdgeColor] = useState('#F97316');
  const bannersRef = useRef([]);
  const timersRef = useRef({});
  const processedRef = useRef(new Set());
  const bigGiftTimerRef = useRef(null);
  const edgeFlash = useRef(new Animated.Value(0)).current;

  bannersRef.current = banners;

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
    // Refill the countdown fuse.
    banner.fuse.stopAnimation();
    banner.fuse.setValue(1);
    Animated.timing(banner.fuse, {
      toValue: 0,
      duration: COMBO_IDLE_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, []);

  // Brief colored glow around the screen edges at big combo milestones.
  const flashEdges = useCallback(
    (color) => {
      setEdgeColor(color);
      edgeFlash.stopAnimation();
      edgeFlash.setValue(0);
      Animated.sequence([
        Animated.timing(edgeFlash, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(edgeFlash, { toValue: 0, duration: 560, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // best-effort
      }
    },
    [edgeFlash]
  );

  const spawnFloater = useCallback((emoji) => {
    const id = nextId();
    const floater = {
      id,
      emoji: Math.random() < 0.35 ? SPARKLES[Math.floor(Math.random() * SPARKLES.length)] : emoji,
      progress: new Animated.Value(0),
      drift: (Math.random() - 0.5) * 70,
      startX: 22 + Math.random() * 46,
      spin: (Math.random() - 0.5) * 80,
    };
    setFloaters((prev) => {
      const next = [...prev, floater];
      return next.length > MAX_FLOATERS ? next.slice(next.length - MAX_FLOATERS) : next;
    });
    Animated.timing(floater.progress, {
      toValue: 1,
      duration: 2800,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setFloaters((prev) => prev.filter((f) => f.id !== id));
    });
  }, []);

  // Radial particle explosion from an absolute screen origin.
  const spawnBurst = useCallback((origin, opts = {}) => {
    const { count = 10, emojis = SPARKLES, power = 120, gravity = 170, big = false } = opts;
    const batch = [];
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
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
      return next.length > MAX_PARTICLES ? next.slice(next.length - MAX_PARTICLES) : next;
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
  }, []);

  // Premium gifts (epic / legendary) get a cinematic full-screen celebration.
  const triggerBigGift = useCallback(
    (gift, sender, receiver) => {
      if (bigGiftTimerRef.current) {
        clearTimeout(bigGiftTimerRef.current);
        bigGiftTimerRef.current = null;
      }
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } catch {
        // best-effort
      }

      // Intensity scales the whole celebration with the gift's coin value:
      // a 100-coin Rocket is far bigger and lingers longer than a 25-coin gift.
      const intensity = Math.max(0.35, Math.min(1, (Number(gift.cost) || 25) / 100));
      const emojiSize = 84 + intensity * 44;
      const holdMs = 1700 + intensity * 1500;
      const power = 170 + intensity * 130;
      const wave1 = Math.round(12 + intensity * 16);
      const wave2 = Math.round(8 + intensity * 10);
      const vignetteMax = 0.22 + intensity * 0.16;

      const entry = {
        gift,
        sender,
        receiver,
        size: emojiSize,
        scale: new Animated.Value(0.3),
        opacity: new Animated.Value(0),
        glow: new Animated.Value(0),
        bob: new Animated.Value(0),
        rays: new Animated.Value(0),
        vignette: new Animated.Value(0),
        vignetteMax,
        rings: [new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)],
        loops: [],
      };
      setBigGift(entry);

      const glowLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(entry.glow, { toValue: 1, duration: 720, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(entry.glow, { toValue: 0, duration: 720, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      );
      const bobLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(entry.bob, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(entry.bob, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      const raysLoop = Animated.loop(
        Animated.timing(entry.rays, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true })
      );
      entry.loops = [glowLoop, bobLoop, raysLoop];

      Animated.parallel([
        Animated.spring(entry.scale, { toValue: 1, friction: 5, tension: 95, useNativeDriver: true }),
        Animated.timing(entry.opacity, { toValue: 1, duration: 240, useNativeDriver: true }),
        Animated.timing(entry.vignette, { toValue: 1, duration: 320, useNativeDriver: true }),
      ]).start();
      glowLoop.start();
      bobLoop.start();
      raysLoop.start();

      // Staggered shockwave rings.
      entry.rings.forEach((ring, i) => {
        Animated.timing(ring, {
          toValue: 1,
          duration: 1000,
          delay: i * 190,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      });

      // Central particle explosion (two waves), scaled by intensity.
      const origin = { x: SCREEN_W / 2 - 16, y: SCREEN_H * 0.32 + 70 };
      spawnBurst(origin, { count: wave1, emojis: [gift.emoji, ...SPARKLES], power, big: true });
      setTimeout(() => spawnBurst(origin, { count: wave2, emojis: SPARKLES, power: power * 0.65, big: true }), 240);

      bigGiftTimerRef.current = setTimeout(() => {
        entry.loops.forEach((l) => l.stop());
        Animated.parallel([
          Animated.timing(entry.opacity, { toValue: 0, duration: 380, useNativeDriver: true }),
          Animated.timing(entry.scale, { toValue: 1.3, duration: 380, useNativeDriver: true }),
          Animated.timing(entry.vignette, { toValue: 0, duration: 380, useNativeDriver: true }),
        ]).start(() => setBigGift(null));
      }, holdMs);
    },
    [spawnBurst]
  );

  useEffect(() => {
    if (!giftEvent) return;
    const eventId = giftEvent.giftEventId || `${giftEvent.giftId}:${giftEvent.sequenceNo}`;
    if (processedRef.current.has(eventId)) return;
    processedRef.current.add(eventId);
    // Keep the dedupe set from growing unbounded.
    if (processedRef.current.size > 200) {
      processedRef.current = new Set(Array.from(processedRef.current).slice(-100));
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // haptics are best-effort
    }

    const gift = resolveGift(giftEvent.giftId);
    const quantity = Math.max(1, Number(giftEvent.quantity) || 1);
    const senderId = giftEvent.sender?.userId || 'anon';
    const key = `${senderId}:${String(giftEvent.giftId || '').toLowerCase()}`;

    spawnFloater(gift.emoji);
    // A little sparkle puff near the banner stack on every gift.
    spawnBurst(
      { x: 70, y: SCREEN_H - 205 },
      { count: 8, emojis: [gift.emoji, ...SPARKLES], power: 90 }
    );

    if (gift.rarity === 'epic' || gift.rarity === 'legendary') {
      triggerBigGift(gift, giftEvent.sender || null, giftEvent.receiver || null);
    }

    const existing = bannersRef.current.find((b) => b.key === key);
    if (existing) {
      const ms = crossedMilestone(existing.count, existing.count + quantity);
      if (ms) flashEdges(ms.color);
      bumpCombo(existing);
      scheduleExpiry(existing.id);
      setBanners((prev) =>
        prev.map((b) => (b.id === existing.id ? { ...b, count: b.count + quantity } : b))
      );
      return;
    }

    const firstMs = crossedMilestone(0, quantity);
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
      if (next.length > MAX_BANNERS) {
        const overflow = next.slice(0, next.length - MAX_BANNERS);
        overflow.forEach((b) => {
          if (timersRef.current[b.id]) {
            clearTimeout(timersRef.current[b.id]);
            delete timersRef.current[b.id];
          }
        });
        next = next.slice(next.length - MAX_BANNERS);
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
  }, [giftEvent, bumpCombo, scheduleExpiry, spawnFloater, spawnBurst, triggerBigGift, flashEdges]);

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach((t) => clearTimeout(t));
      timersRef.current = {};
      if (bigGiftTimerRef.current) clearTimeout(bigGiftTimerRef.current);
    };
  }, []);

  const bg = bigGift ? RARITY_COLORS[bigGift.gift.rarity] || RARITY_COLORS.legendary : null;

  return (
    <View style={[styles.container, style]} pointerEvents="none">
      {/* Combo-milestone screen-edge flash */}
      <Animated.View
        pointerEvents="none"
        style={[styles.edgeFlash, { borderColor: edgeColor, opacity: edgeFlash }]}
      />

      {/* Full-screen takeover for premium gifts */}
      {bigGift ? (
        <>
          <Animated.View
            style={[
              styles.vignette,
              {
                opacity: bigGift.vignette.interpolate({ inputRange: [0, 1], outputRange: [0, bigGift.vignetteMax] }),
              },
            ]}
          >
            <LinearGradient
              colors={['rgba(0,0,0,0.0)', 'rgba(0,0,0,0.55)']}
              start={{ x: 0.5, y: 0.2 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <Animated.View style={[styles.bigGiftWrap, { opacity: bigGift.opacity }]}>
            <View style={styles.bigGiftStage}>
              {/* Rotating light rays */}
              <Animated.View
                style={[
                  styles.rayLayer,
                  {
                    opacity: bigGift.glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] }),
                    transform: [
                      { rotate: bigGift.rays.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
                    ],
                  },
                ]}
              >
                {[0, 30, 60, 90, 120, 150].map((deg) => (
                  <View
                    key={deg}
                    style={[styles.ray, { transform: [{ rotate: `${deg}deg` }] }]}
                  >
                    <LinearGradient
                      colors={['transparent', bg[2], 'transparent']}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                  </View>
                ))}
              </Animated.View>

              {/* Expanding shockwave rings */}
              {bigGift.rings.map((ring, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.ring,
                    {
                      borderColor: bg[2],
                      opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.8, 0] }),
                      transform: [
                        { scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.25, 2.7] }) },
                      ],
                    },
                  ]}
                />
              ))}

              {/* The gift emoji with spring-in + gentle bob */}
              <Animated.Text
                style={[
                  styles.bigGiftEmoji,
                  {
                    fontSize: bigGift.size,
                    transform: [
                      { scale: bigGift.scale },
                      { translateY: bigGift.bob.interpolate({ inputRange: [0, 1], outputRange: [6, -10] }) },
                    ],
                  },
                ]}
              >
                {bigGift.gift.emoji}
              </Animated.Text>
            </View>

            <Animated.View style={{ transform: [{ scale: bigGift.scale }] }}>
              <LinearGradient
                colors={bg}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.bigGiftPill}
              >
                <Text style={styles.bigGiftSender} numberOfLines={1}>
                  {senderLabel(bigGift.sender)}
                </Text>
                <Text style={styles.bigGiftName} numberOfLines={1}>
                  sent {bigGift.gift.name} → {receiverLabel(bigGift.receiver)}
                </Text>
                <Shimmer width={90} period={1300} delay={700} />
              </LinearGradient>
            </Animated.View>
          </Animated.View>
        </>
      ) : null}

      {/* Sliding sender banners with combo counter */}
      <View style={styles.bannerStack}>
        {banners.map((banner) => {
          const colors = RARITY_COLORS[banner.gift.rarity] || RARITY_COLORS.common;
          const comboScale = banner.combo.interpolate({
            inputRange: [0, 1],
            outputRange: [1.7, 1],
          });
          const ct = comboStyle(banner.count);
          const avatarUrl = banner.sender?.avatarUrl;
          const label = senderLabel(banner.sender);
          return (
            <Animated.View
              key={banner.id}
              style={[
                styles.banner,
                { opacity: banner.opacity, transform: [{ translateX: banner.x }] },
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
                  </Text>
                </View>
                <Text style={styles.bannerEmoji}>{banner.gift.emoji}</Text>
                {ct.flame ? <Text style={styles.comboFlame}>{ct.flame}</Text> : null}
                <Animated.Text
                  style={[
                    styles.comboText,
                    { color: ct.color, textShadowColor: ct.glow, fontSize: ct.size, transform: [{ scale: comboScale }] },
                  ]}
                >
                  x{banner.count}
                </Animated.Text>

                {/* Countdown fuse */}
                <Animated.View
                  style={[
                    styles.fuse,
                    { backgroundColor: ct.glow, transform: [{ scaleX: banner.fuse }] },
                  ]}
                />

                <Shimmer width={70} />
              </LinearGradient>
            </Animated.View>
          );
        })}
      </View>

      {/* Ambient floating gift emojis */}
      {floaters.map((floater) => {
        const translateY = floater.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -280],
        });
        const translateX = floater.progress.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, floater.drift, floater.drift * 1.4],
        });
        const opacity = floater.progress.interpolate({
          inputRange: [0, 0.15, 0.8, 1],
          outputRange: [0, 1, 1, 0],
        });
        const scale = floater.progress.interpolate({
          inputRange: [0, 0.2, 1],
          outputRange: [0.6, 1.1, 0.9],
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
              { left: floater.startX, opacity, transform: [{ translateY }, { translateX }, { scale }, { rotate }] },
            ]}
          >
            {floater.emoji}
          </Animated.Text>
        );
      })}

      {/* Particle bursts */}
      {particles.map((p) => {
        const translateX = p.progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] });
        const translateY = p.progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.dy + p.gravity] });
        const opacity = p.progress.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] });
        const scale = p.progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.4, 1, 0.5] });
        const rotate = p.progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.rot}deg`] });
        return (
          <Animated.Text
            key={p.id}
            style={[
              styles.particle,
              { left: p.x, top: p.y, fontSize: p.size, opacity, transform: [{ translateX }, { translateY }, { scale }, { rotate }] },
            ]}
          >
            {p.emoji}
          </Animated.Text>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 900,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
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
  },
  banner: {
    borderRadius: 26,
    overflow: 'hidden',
    maxWidth: SCREEN_W * 0.74,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
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
    opacity: 0.9,
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
  bigGiftWrap: {
    position: 'absolute',
    top: '30%',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigGiftStage: {
    width: 300,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rayLayer: {
    position: 'absolute',
    width: 320,
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ray: {
    position: 'absolute',
    width: 10,
    height: 320,
    borderRadius: 6,
  },
  ring: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 3,
  },
  bigGiftEmoji: {
    fontSize: 104,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 10,
  },
  bigGiftPill: {
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 999,
    alignItems: 'center',
    overflow: 'hidden',
    maxWidth: SCREEN_W * 0.86,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 10,
  },
  bigGiftSender: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  bigGiftName: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default React.memo(LiveGiftOverlay);
