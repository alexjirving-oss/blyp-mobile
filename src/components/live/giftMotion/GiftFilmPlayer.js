/**
 * GiftFilmPlayer — fullscreen / letterboxed authored film-clip hero.
 *
 * Plays short cinematic MP4 (character story beat), impact haptics,
 * glory-hold freeze on last frame, tap-to-skip, audio bed slot.
 *
 * Honest: theatrical gift cinema toward a children's-film bar — not Pixar EXR.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
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
  getFxBudget,
  getTierConfig,
  playGiftAudio,
  TEAL,
  TEAL_LIGHT,
  GOLD,
} from './giftMotionSystem';
import { resolveFilmClip } from './filmClipRegistry';

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
 *  - entry: { motion, sender, receiver, ... }
 *  - onSkip / onDone
 *  - film: optional pre-resolved { source, meta, id } from resolveFilmClip
 */
export default function GiftFilmPlayer({ entry, onSkip, onDone, film: filmProp }) {
  const budget = useMemo(() => getFxBudget(), []);
  const chrome = useSharedValue(0);
  const plaqueProg = useSharedValue(0);
  const skippedRef = useRef(false);
  const impactFiredRef = useRef(false);
  const aftershockFiredRef = useRef(false);
  const finishedRef = useRef(false);
  const videoRef = useRef(null);
  const gloryTimerRef = useRef(null);
  const doneTimerRef = useRef(null);
  const impactTimerRef = useRef(null);
  const afterTimerRef = useRef(null);
  const [inGlory, setInGlory] = useState(false);

  const motion = entry?.motion;
  const film = filmProp || resolveFilmClip(motion);
  const tier = getTierConfig(motion?.motionTier);
  const letterbox = budget.letterbox && tier.takeover === 'fullscreen';
  const palette = motion?.palette || [TEAL, TEAL_LIGHT, GOLD];
  const heavy =
    motion?.motionTier === 'legendary' || motion?.motionTier === 'ultimate';
  const meta = film?.meta;
  const durationMs = meta?.durationMs || 3000;
  const gloryMs = meta?.gloryMs || 900;
  const impactAt = typeof meta?.impactAt === 'number' ? meta.impactAt : 0.25;

  const finish = (reason) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (gloryTimerRef.current) {
      clearTimeout(gloryTimerRef.current);
      gloryTimerRef.current = null;
    }
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    chrome.value = withTiming(0, { duration: 220 });
    plaqueProg.value = withTiming(0, { duration: 180 });
    // slight delay so chrome can fade
    setTimeout(() => onDone?.(reason), 200);
  };

  const enterGloryHold = () => {
    if (skippedRef.current || finishedRef.current || inGlory) return;
    setInGlory(true);
    plaqueProg.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
    gloryTimerRef.current = setTimeout(() => {
      if (!skippedRef.current) finish('complete');
    }, gloryMs);
  };

  const skipNow = () => {
    if (skippedRef.current || finishedRef.current) return;
    skippedRef.current = true;
    try {
      videoRef.current?.stopAsync?.();
    } catch {
      // ignore
    }
    cancelAnimation(chrome);
    cancelAnimation(plaqueProg);
    chrome.value = withTiming(0, { duration: 160 });
    finish('skip');
  };

  useEffect(() => {
    if (!entry || !motion || !film?.source) return undefined;
    skippedRef.current = false;
    finishedRef.current = false;
    impactFiredRef.current = false;
    aftershockFiredRef.current = false;
    setInGlory(false);
    chrome.value = 0;
    plaqueProg.value = 0;

    playGiftAudio(motion.audioKey);
    chrome.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    // Show plaque mid-clip so sender is readable during climax
    plaqueProg.value = withTiming(1, {
      duration: 400,
      easing: Easing.out(Easing.cubic),
    });

    const impactMs = Math.round(durationMs * impactAt);
    impactTimerRef.current = setTimeout(() => {
      if (skippedRef.current || impactFiredRef.current) return;
      impactFiredRef.current = true;
      fireImpactHaptic(heavy);
    }, impactMs);

    if (motion.motionTier === 'ultimate') {
      afterTimerRef.current = setTimeout(() => {
        if (skippedRef.current || aftershockFiredRef.current) return;
        aftershockFiredRef.current = true;
        fireAftershock();
      }, Math.round(durationMs * 0.55));
    }

    // Safety: clip + glory + chrome
    doneTimerRef.current = setTimeout(() => {
      if (!skippedRef.current && !finishedRef.current) finish('timeout');
    }, durationMs + gloryMs + 800);

    return () => {
      if (impactTimerRef.current) clearTimeout(impactTimerRef.current);
      if (afterTimerRef.current) clearTimeout(afterTimerRef.current);
      if (gloryTimerRef.current) clearTimeout(gloryTimerRef.current);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
      cancelAnimation(chrome);
      cancelAnimation(plaqueProg);
      try {
        videoRef.current?.unloadAsync?.();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const onPlaybackStatusUpdate = (status) => {
    if (!status?.isLoaded || skippedRef.current || finishedRef.current) return;
    if (status.didJustFinish) {
      enterGloryHold();
    }
  };

  const letterboxStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * (letterbox ? 1 : 0),
    transform: [{ scaleY: 0.4 + chrome.value * 0.6 }],
  }));

  const vignetteStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * (tier.takeover === 'spotlight' ? 0.4 : 0.78),
  }));

  const plaqueStyle = useAnimatedStyle(() => ({
    opacity: plaqueProg.value * chrome.value,
    transform: [
      { translateY: (1 - plaqueProg.value) * 16 },
      { scale: 0.96 + plaqueProg.value * 0.04 },
    ],
  }));

  const skipHintStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * 0.65 * (inGlory ? 0.35 : 1),
  }));

  const stageStyle = useAnimatedStyle(() => ({
    opacity: chrome.value,
    transform: [{ scale: 0.97 + chrome.value * 0.03 }],
  }));

  if (!entry || !motion || !film?.source) return null;

  const stageH = tier.takeover === 'spotlight' ? SCREEN_H * 0.52 : SCREEN_H;

  return (
    <View
      style={[styles.root, tier.takeover === 'spotlight' ? styles.spotlightRoot : null]}
      pointerEvents="box-none"
    >
      <Animated.View style={[styles.vignette, vignetteStyle]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(0,0,0,0.35)', 'rgba(2,8,14,0.92)']}
          start={{ x: 0.5, y: 0.05 }}
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

      <Animated.View
        style={[
          styles.stage,
          tier.takeover === 'spotlight' ? styles.spotlightStage : styles.fullStage,
          { height: stageH },
          stageStyle,
        ]}
        pointerEvents="none"
      >
        <Video
          ref={videoRef}
          source={film.source}
          style={styles.video}
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay
          isLooping={false}
          isMuted
          volume={0}
          useNativeControls={false}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
          onError={() => {
            // Asset decode failure → finish so overlay can fall through / dismiss
            if (!finishedRef.current) finish('error');
          }}
        />
        {/* Soft grade wash — teal key / warm fill without crushing the plate */}
        <LinearGradient
          colors={['rgba(0,210,190,0.08)', 'transparent', 'rgba(251,191,36,0.06)']}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={styles.grade}
          pointerEvents="none"
        />
      </Animated.View>

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

      <Animated.Text style={[styles.skipHint, skipHintStyle]}>Tap to skip</Animated.Text>

      <Pressable
        style={styles.skipHit}
        onPress={skipNow}
        accessibilityLabel="Skip gift film"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  spotlightRoot: {
    justifyContent: 'flex-start',
    paddingTop: SCREEN_H * 0.12,
    backgroundColor: 'transparent',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
  },
  letterboxTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: Math.max(40, SCREEN_H * 0.08),
    backgroundColor: '#000',
    zIndex: 5,
  },
  letterboxBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Math.max(40, SCREEN_H * 0.08),
    backgroundColor: '#000',
    zIndex: 5,
  },
  stage: {
    width: SCREEN_W,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  fullStage: {
    ...StyleSheet.absoluteFillObject,
  },
  spotlightStage: {
    borderRadius: 20,
    overflow: 'hidden',
    width: SCREEN_W * 0.94,
    alignSelf: 'center',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  grade: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  plaqueWrap: {
    position: 'absolute',
    bottom: SCREEN_H * 0.13,
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
    bottom: SCREEN_H * 0.075,
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
