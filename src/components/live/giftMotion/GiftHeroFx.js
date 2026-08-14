/**
 * GiftHeroFx — cinematic fullscreen / spotlight takeover per gift motif.
 * Pure Animated + optional SVG (react-native-svg). Tap to skip long epics.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop, Polygon, Path } from 'react-native-svg';
import {
  getFxBudget,
  getTierConfig,
  heroHoldMs,
  playGiftCinemaAudio,
  TEAL,
  TEAL_LIGHT,
  GOLD,
  ENERGY_ORANGE,
  CRYSTAL,
} from './giftMotionSystem';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function ShimmerSweep({ width = 90, period = 1300, delay = 700 }) {
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

/**
 * Motif backdrop layers (SVG / gradient) — gift-specific craft.
 */
function MotifBackdrop({ motif, palette, progress, budget }) {
  if (!budget.svgLayers) return null;
  const c0 = palette[0] || TEAL;
  const c1 = palette[1] || TEAL_LIGHT;
  const c2 = palette[2] || GOLD;

  if (motif === 'orbital_launch') {
    const y = progress.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_H * 0.55, -SCREEN_H * 0.15] });
    return (
      <Animated.View style={[styles.trailWrap, { transform: [{ translateY: y }] }]} pointerEvents="none">
        <LinearGradient
          colors={['transparent', `${ENERGY_ORANGE}99`, `${TEAL}66`, 'transparent']}
          style={styles.exhaust}
        />
        <LinearGradient
          colors={[`${TEAL}00`, `${TEAL}88`, `${ENERGY_ORANGE}AA`]}
          style={styles.exhaustCore}
        />
      </Animated.View>
    );
  }

  if (motif === 'crystal_prism') {
    const rot = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
    return (
      <Animated.View style={[styles.prismWrap, { transform: [{ rotate: rot }] }]} pointerEvents="none">
        <Svg width={280} height={280} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id="prismGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={CRYSTAL} stopOpacity="0.85" />
              <Stop offset="70%" stopColor={c1} stopOpacity="0.25" />
              <Stop offset="100%" stopColor={c0} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="50" r="46" fill="url(#prismGlow)" />
          <Polygon points="50,12 78,38 68,78 32,78 22,38" fill={`${c1}33`} stroke={c2} strokeWidth="1.2" />
          <Polygon points="50,22 70,40 62,70 38,70 30,40" fill={`${CRYSTAL}44`} stroke={TEAL_LIGHT} strokeWidth="0.8" />
        </Svg>
      </Animated.View>
    );
  }

  if (motif === 'flame_column') {
    return (
      <View style={styles.flameColumn} pointerEvents="none">
        <LinearGradient
          colors={['transparent', `${ENERGY_ORANGE}55`, `${palette[1] || '#EF4444'}99`, 'transparent']}
          style={styles.flameCore}
        />
      </View>
    );
  }

  if (motif === 'constellation') {
    const rot = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    return (
      <Animated.View style={[styles.orbitWrap, { transform: [{ rotate: rot }] }]} pointerEvents="none">
        <Svg width={260} height={260} viewBox="0 0 100 100">
          <Circle cx="50" cy="14" r="2.2" fill={GOLD} />
          <Circle cx="78" cy="36" r="1.8" fill={TEAL_LIGHT} />
          <Circle cx="72" cy="72" r="2" fill={GOLD} />
          <Circle cx="28" cy="70" r="1.6" fill={TEAL_LIGHT} />
          <Circle cx="18" cy="34" r="2" fill={GOLD} />
          <Path d="M50 14 L78 36 L72 72 L28 70 L18 34 Z" fill="none" stroke={`${TEAL}66`} strokeWidth="0.7" />
        </Svg>
      </Animated.View>
    );
  }

  if (motif === 'stadium_wave') {
    return (
      <View style={styles.waveBands} pointerEvents="none">
        {[0, 1, 2].map((i) => (
          <LinearGradient
            key={i}
            colors={[`${TEAL}00`, `${TEAL}55`, `${ENERGY_ORANGE}44`, `${TEAL}00`]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.waveBand, { top: 40 + i * 36, opacity: 0.55 - i * 0.12 }]}
          />
        ))}
      </View>
    );
  }

  if (motif === 'regal_drop') {
    return (
      <View style={styles.regalHalo} pointerEvents="none">
        <Svg width={300} height={300} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id="crownHalo" cx="50%" cy="45%" r="50%">
              <Stop offset="0%" stopColor={GOLD} stopOpacity="0.55" />
              <Stop offset="55%" stopColor={TEAL} stopOpacity="0.2" />
              <Stop offset="100%" stopColor="#000" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="48" r="42" fill="url(#crownHalo)" />
        </Svg>
      </View>
    );
  }

  if (motif === 'pulse_bloom' || motif === 'shock_clap' || motif === 'life_ring' || motif === 'pop_ack') {
    return (
      <View style={styles.bloomHalo} pointerEvents="none">
        <Svg width={240} height={240} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id="tealBloom" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={TEAL_LIGHT} stopOpacity="0.5" />
              <Stop offset="60%" stopColor={TEAL} stopOpacity="0.18" />
              <Stop offset="100%" stopColor="#000" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="50" r="48" fill="url(#tealBloom)" />
        </Svg>
      </View>
    );
  }

  return null;
}

/**
 * Props:
 *  - entry: mutable animation bag from LiveGiftOverlay
 *  - onSkip: dismiss early
 *  - onDone: cleanup after exit
 */
export default function GiftHeroFx({ entry, onSkip }) {
  const budget = useMemo(() => getFxBudget(), []);
  const shake = useRef(new Animated.Value(0)).current;
  const launchProg = useRef(new Animated.Value(0)).current;
  const motifProg = useRef(new Animated.Value(0)).current;
  const skippedRef = useRef(false);

  const motion = entry?.motion;
  const palette = motion?.palette || [TEAL, TEAL_LIGHT, GOLD];
  const tier = getTierConfig(motion?.motionTier);
  const motif = motion?.motif || 'pulse_bloom';
  const isSpotlight = tier.takeover === 'spotlight';
  const skippable = !!tier.skippable;

  useEffect(() => {
    if (!entry) return undefined;
    skippedRef.current = false;
    launchProg.setValue(0);
    motifProg.setValue(0);
    shake.setValue(0);

    void playGiftCinemaAudio(motion);

    const loops = entry.loops || [];
    const intensity = Math.max(0.35, Math.min(1, (Number(motion?.coinCost) || 25) / 100));

    // Motif progress (launch trail / prism spin)
    const motifLoop = Animated.timing(motifProg, {
      toValue: 1,
      duration: heroHoldMs(motion) - 200,
      easing: motif === 'orbital_launch' ? Easing.in(Easing.cubic) : Easing.linear,
      useNativeDriver: true,
    });
    motifLoop.start();
    loops.push(motifLoop);

    if (motif === 'orbital_launch') {
      Animated.timing(launchProg, {
        toValue: 1,
        duration: 1600 + intensity * 900,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }

    if (budget.shake && (motion?.motionTier === 'legendary' || motion?.motionTier === 'ultimate')) {
      const shakeSeq = Animated.sequence([
        Animated.delay(motif === 'orbital_launch' ? 900 : 200),
        Animated.timing(shake, { toValue: 1, duration: 40, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 40, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0.6, duration: 40, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -0.4, duration: 40, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]);
      shakeSeq.start();
    }

    return () => {
      motifLoop.stop();
    };
  }, [entry, budget.shake, launchProg, motif, motifProg, motion, shake]);

  if (!entry || !motion) return null;

  const emojiLift =
    motif === 'orbital_launch'
      ? launchProg.interpolate({
          inputRange: [0, 1],
          outputRange: [SCREEN_H * 0.28, -SCREEN_H * 0.42],
        })
      : motif === 'regal_drop'
        ? entry.bob.interpolate({ inputRange: [0, 1], outputRange: [-18, 8] })
        : entry.bob.interpolate({ inputRange: [0, 1], outputRange: [6, -10] });

  const emojiScaleExtra =
    motif === 'orbital_launch'
      ? launchProg.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.85, 1.15, 0.55] })
      : entry.scale;

  const shakeX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-7, 7] });

  const rayCount = budget.rays;
  const rayDegs = Array.from({ length: rayCount }, (_, i) => (180 / rayCount) * i);

  return (
    <Animated.View
      style={[
        styles.root,
        isSpotlight ? styles.spotlightRoot : null,
        {
          opacity: entry.opacity,
          transform: [{ translateX: shakeX }],
        },
      ]}
      pointerEvents={skippable ? 'box-none' : 'none'}
    >
      {!isSpotlight ? (
        <Animated.View
          style={[
            styles.vignette,
            {
              opacity: entry.vignette.interpolate({
                inputRange: [0, 1],
                outputRange: [0, entry.vignetteMax ?? 0.35],
              }),
            },
          ]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={['rgba(0,0,0,0.05)', 'rgba(0,11,18,0.72)']}
            start={{ x: 0.5, y: 0.15 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}

      <View style={[styles.stage, isSpotlight ? styles.spotlightStage : null]} pointerEvents="none">
        <MotifBackdrop motif={motif} palette={palette} progress={motifProg} budget={budget} />

        {/* Rotating light rays */}
        <Animated.View
          style={[
            styles.rayLayer,
            {
              opacity: entry.glow.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.75] }),
              transform: [
                {
                  rotate: entry.rays.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '360deg'],
                  }),
                },
              ],
            },
          ]}
        >
          {rayDegs.map((deg) => (
            <View key={deg} style={[styles.ray, { transform: [{ rotate: `${deg}deg` }] }]}>
              <LinearGradient
                colors={['transparent', palette[2] || TEAL_LIGHT, 'transparent']}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            </View>
          ))}
        </Animated.View>

        {/* Shockwave rings */}
        {(entry.rings || []).slice(0, budget.rings).map((ring, i) => (
          <Animated.View
            key={`ring-${i}`}
            style={[
              styles.ring,
              {
                borderColor: palette[1] || TEAL,
                opacity: ring.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.85, 0] }),
                transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.2, 2.9] }) }],
              },
            ]}
          />
        ))}

        {/* Hero emoji */}
        <Animated.Text
          style={[
            styles.emoji,
            {
              fontSize: entry.size,
              transform: [
                { scale: emojiScaleExtra },
                { translateY: emojiLift },
                ...(motif === 'regal_drop'
                  ? [
                      {
                        rotate: entry.bob.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['-6deg', '6deg'],
                        }),
                      },
                    ]
                  : []),
              ],
            },
          ]}
        >
          {motion.emoji}
        </Animated.Text>

        {/* Tier chip */}
        <View style={styles.tierChip}>
          <LinearGradient colors={[palette[0], palette[1]]} style={styles.tierChipInner}>
            <Text style={styles.tierChipText}>{String(tier.label || '').toUpperCase()}</Text>
          </LinearGradient>
        </View>
      </View>

      <Animated.View style={{ transform: [{ scale: entry.scale }], alignItems: 'center' }} pointerEvents="none">
        <LinearGradient colors={palette} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pill}>
          <Text style={styles.pillSender} numberOfLines={1}>
            {senderLabel(entry.sender)}
          </Text>
          <Text style={styles.pillAction} numberOfLines={1}>
            sent {motion.name} → {receiverLabel(entry.receiver)}
          </Text>
          <ShimmerSweep width={90} period={1200} delay={600} />
        </LinearGradient>
        {skippable ? (
          <Text style={styles.skipHint}>Tap to skip</Text>
        ) : null}
      </Animated.View>

      {skippable ? (
        <Pressable
          style={styles.skipHit}
          onPress={() => {
            if (skippedRef.current) return;
            skippedRef.current = true;
            onSkip?.();
          }}
          accessibilityLabel="Skip gift animation"
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  spotlightRoot: {
    justifyContent: 'flex-start',
    paddingTop: SCREEN_H * 0.22,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
  },
  stage: {
    width: Math.min(340, SCREEN_W * 0.92),
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotlightStage: {
    height: 200,
  },
  rayLayer: {
    position: 'absolute',
    width: 340,
    height: 340,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ray: {
    position: 'absolute',
    width: 11,
    height: 340,
    borderRadius: 6,
  },
  ring: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 3,
  },
  emoji: {
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 12,
  },
  pill: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 999,
    alignItems: 'center',
    overflow: 'hidden',
    maxWidth: SCREEN_W * 0.86,
  },
  pillSender: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  pillAction: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 13,
    fontWeight: '700',
  },
  skipHint: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  skipHit: {
    ...StyleSheet.absoluteFillObject,
  },
  tierChip: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
  },
  tierChipInner: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  tierChipText: {
    color: '#0B1220',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  trailWrap: {
    position: 'absolute',
    width: 64,
    height: SCREEN_H * 0.7,
    alignItems: 'center',
  },
  exhaust: {
    position: 'absolute',
    width: 54,
    height: '100%',
    borderRadius: 28,
  },
  exhaustCore: {
    position: 'absolute',
    width: 18,
    height: '70%',
    top: '15%',
    borderRadius: 10,
  },
  prismWrap: {
    position: 'absolute',
  },
  flameColumn: {
    position: 'absolute',
    width: 120,
    height: 280,
    alignItems: 'center',
  },
  flameCore: {
    width: 70,
    height: '100%',
    borderRadius: 40,
  },
  orbitWrap: {
    position: 'absolute',
  },
  waveBands: {
    ...StyleSheet.absoluteFillObject,
  },
  waveBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 28,
    borderRadius: 14,
  },
  regalHalo: {
    position: 'absolute',
  },
  bloomHalo: {
    position: 'absolute',
  },
});

export { ShimmerSweep };
