/**
 * GiftCinematicPlayer — hero gift router.
 *
 * Prefers authored film clips (GiftFilmPlayer). Falls back to Skia geometric
 * scenes only when a clip asset is missing.
 *
 * Honest: film path is theatrical gift cinema toward a children's-film bar;
 * not Pixar EXR/USD. Skia fallback is deliberately "cheap" geometry.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Platform,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  cinemaHoldMs,
  getFxBudget,
  getTierConfig,
  playGiftAudio,
  TEAL,
  TEAL_LIGHT,
  GOLD,
} from './giftMotionSystem';
import { resolveCinemaScene } from './scenes/cinemaRegistry';
import { impactPulse } from './scenes/cinemaHelpers';
import { resolveAlphaClip, resolveFilmClip } from './filmClipRegistry';
import GiftFilmPlayer from './GiftFilmPlayer';
import GiftAlphaFilmPlayer from './GiftAlphaFilmPlayer';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

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

function fireImpactHaptic(heavy) {
  try {
    Haptics.impactAsync(
      heavy ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium
    );
  } catch {
    // best-effort
  }
}

function fireAftershock() {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // best-effort
  }
}

/**
 * Props:
 *  - entry: { motion, sender, receiver, ... } from LiveGiftOverlay
 *  - onSkip / onDone
 */
export default function GiftCinematicPlayer({ entry, onSkip, onDone }) {
  const motion = entry?.motion;
  const alpha = useMemo(() => resolveAlphaClip(motion), [motion]);
  const film = useMemo(() => resolveFilmClip(motion), [motion]);
  // Android + live: alpha WebView + IVS dual-decode freezes; prefer film.
  // iOS keeps soft-edge alpha when available; fall back to film on alpha error.
  const preferFilm =
    !!film?.source && (Platform.OS === 'android' || !alpha?.module);
  const [useFilmFallback, setUseFilmFallback] = useState(preferFilm);

  useEffect(() => {
    setUseFilmFallback(preferFilm);
  }, [preferFilm, entry]);

  const handleAlphaDone = (reason) => {
    if (reason === 'error' && film?.source && !useFilmFallback) {
      setUseFilmFallback(true);
      return;
    }
    onDone?.(reason);
  };

  if (film?.source && useFilmFallback) {
    return (
      <GiftFilmPlayer entry={entry} film={film} onSkip={onSkip} onDone={onDone} />
    );
  }

  // Preferred on iOS: true soft-edge alpha (YYEVA RGB|A split → WebGL composite)
  if (alpha?.module) {
    return (
      <GiftAlphaFilmPlayer
        entry={entry}
        film={alpha}
        onSkip={onSkip}
        onDone={handleAlphaDone}
      />
    );
  }

  if (film?.source) {
    return (
      <GiftFilmPlayer entry={entry} film={film} onSkip={onSkip} onDone={onDone} />
    );
  }

  // Fallback: Skia geometric scenes (only if clip missing)
  return (
    <GiftSkiaCinemaFallback entry={entry} onSkip={onSkip} onDone={onDone} />
  );
}

/** Skia-only fallback when film asset is absent. */
function GiftSkiaCinemaFallback({ entry, onSkip, onDone }) {
  const budget = useMemo(() => getFxBudget(), []);
  const progress = useSharedValue(0);
  const chrome = useSharedValue(0);
  const skippedRef = useRef(false);
  const impactFiredRef = useRef(false);
  const aftershockFiredRef = useRef(false);
  const doneTimerRef = useRef(null);

  const motion = entry?.motion;
  const tier = getTierConfig(motion?.motionTier);
  const Scene = resolveCinemaScene(motion);
  const holdMs = cinemaHoldMs(motion);
  const skippable = true;
  const letterbox = budget.letterbox && tier.takeover === 'fullscreen';
  const palette = motion?.palette || [TEAL, TEAL_LIGHT, GOLD];
  const heavy =
    motion?.motionTier === 'legendary' || motion?.motionTier === 'ultimate';

  const finish = (reason) => {
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    onDone?.(reason);
  };

  const skipNow = () => {
    if (skippedRef.current) return;
    skippedRef.current = true;
    cancelAnimation(progress);
    cancelAnimation(chrome);
    chrome.value = withTiming(0, { duration: 180 });
    progress.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(finish)('skip');
    });
  };

  useEffect(() => {
    if (!entry || !motion) return undefined;
    skippedRef.current = false;
    impactFiredRef.current = false;
    aftershockFiredRef.current = false;
    progress.value = 0;
    chrome.value = 0;

    playGiftAudio(motion.audioKey);

    chrome.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
    progress.value = withTiming(
      1,
      { duration: holdMs, easing: Easing.linear },
      (finished) => {
        if (finished && !skippedRef.current) runOnJS(finish)('complete');
      }
    );

    // Impact haptic near phase window (~18–28%)
    const impactAt = Math.round(holdMs * 0.22);
    const impactTimer = setTimeout(() => {
      if (skippedRef.current || impactFiredRef.current) return;
      impactFiredRef.current = true;
      fireImpactHaptic(heavy);
    }, impactAt);

    let afterTimer = null;
    if (motion.motionTier === 'ultimate') {
      afterTimer = setTimeout(() => {
        if (skippedRef.current || aftershockFiredRef.current) return;
        aftershockFiredRef.current = true;
        fireAftershock();
      }, Math.round(holdMs * 0.48));
    }

    // Safety dismiss if Reanimated callback misses
    doneTimerRef.current = setTimeout(() => {
      if (!skippedRef.current) finish('timeout');
    }, holdMs + 400);

    return () => {
      clearTimeout(impactTimer);
      if (afterTimer) clearTimeout(afterTimer);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
      cancelAnimation(progress);
      cancelAnimation(chrome);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const letterboxStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * (letterbox ? 1 : 0),
    transform: [{ scaleY: 0.4 + chrome.value * 0.6 }],
  }));

  const vignetteStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * (tier.takeover === 'spotlight' ? 0.35 : 0.72),
  }));

  const plaqueStyle = useAnimatedStyle(() => {
    const t = progress.value;
    const show = Math.min(1, Math.max(0, (t - 0.2) / 0.15)) * (1 - Math.min(1, Math.max(0, (t - 0.88) / 0.12)));
    const punch = impactPulse(t);
    return {
      opacity: show * chrome.value,
      transform: [{ translateY: (1 - show) * 18 }, { scale: 0.96 + punch * 0.04 }],
    };
  });

  const skipHintStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * 0.7 * (progress.value > 0.12 && progress.value < 0.9 ? 1 : 0),
  }));

  if (!entry || !motion || !Scene) return null;

  const stageW = SCREEN_W;
  const stageH = tier.takeover === 'spotlight' ? SCREEN_H * 0.52 : SCREEN_H;

  return (
    <View
      style={[styles.root, tier.takeover === 'spotlight' ? styles.spotlightRoot : null]}
      pointerEvents={skippable ? 'box-none' : 'none'}
    >
      <Animated.View style={[styles.vignette, vignetteStyle]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(0,0,0,0.05)', 'rgba(2,8,14,0.88)']}
          start={{ x: 0.5, y: 0.1 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {letterbox ? (
        <>
          <Animated.View style={[styles.letterboxTop, letterboxStyle]} pointerEvents="none" />
          <Animated.View style={[styles.letterboxBottom, letterboxStyle]} pointerEvents="none" />
        </>
      ) : null}

      <View
        style={[
          styles.stage,
          tier.takeover === 'spotlight' ? styles.spotlightStage : styles.fullStage,
          { height: stageH },
        ]}
        pointerEvents="none"
      >
        <Scene width={stageW} height={stageH} progress={progress} budget={budget} />
      </View>

      <Animated.View style={[styles.plaqueWrap, plaqueStyle]} pointerEvents="none">
        <LinearGradient colors={[palette[0], palette[1] || TEAL]} style={styles.plaque}>
          <Text style={styles.plaqueTier}>{String(tier.label || '').toUpperCase()}</Text>
          <Text style={styles.plaqueTitle} numberOfLines={1}>
            {motion.name}
          </Text>
          <Text style={styles.plaqueMeta} numberOfLines={1}>
            {senderLabel(entry.sender)} → {receiverLabel(entry.receiver)}
          </Text>
        </LinearGradient>
      </Animated.View>

      {skippable ? (
        <Animated.Text style={[styles.skipHint, skipHintStyle]}>Tap to skip</Animated.Text>
      ) : null}

      {skippable ? (
        <Pressable
          style={styles.skipHit}
          onPress={skipNow}
          accessibilityLabel="Skip gift cinema"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spotlightRoot: {
    justifyContent: 'flex-start',
    paddingTop: SCREEN_H * 0.12,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
  },
  letterboxTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: Math.max(36, SCREEN_H * 0.07),
    backgroundColor: '#000',
    zIndex: 5,
  },
  letterboxBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Math.max(36, SCREEN_H * 0.07),
    backgroundColor: '#000',
    zIndex: 5,
  },
  stage: {
    width: SCREEN_W,
    overflow: 'hidden',
  },
  fullStage: {
    ...StyleSheet.absoluteFillObject,
  },
  spotlightStage: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  plaqueWrap: {
    position: 'absolute',
    bottom: SCREEN_H * 0.14,
    alignItems: 'center',
    zIndex: 6,
  },
  plaque: {
    minWidth: Math.min(280, SCREEN_W * 0.78),
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  plaqueTier: {
    color: 'rgba(11,18,32,0.75)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 2,
  },
  plaqueTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  plaqueMeta: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '700',
  },
  skipHint: {
    position: 'absolute',
    bottom: SCREEN_H * 0.08,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    zIndex: 6,
  },
  skipHit: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
  },
});
