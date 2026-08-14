/**
 * GiftFilmPlayer — TikTok-class gift overlay player.
 *
 * Dark-keyed / luminous film clips over live: transparent root, soft vignette,
 * glow plate behind clip, impact flash, large center stage, haptic on peak.
 * Prefer screen-style brightening over opaque cinema blackout.
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
import { Video, ResizeMode } from 'expo-av';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  getFxBudget,
  getTierConfig,
  playGiftAudio,
  ensureGiftAudioSession,
  releaseGiftAudioSession,
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
  const impactFlash = useSharedValue(0);
  const glowPulse = useSharedValue(0.55);
  const skippedRef = useRef(false);
  const impactFiredRef = useRef(false);
  const aftershockFiredRef = useRef(false);
  const finishedRef = useRef(false);
  const inGloryRef = useRef(false);
  const videoRef = useRef(null);
  const gloryTimerRef = useRef(null);
  const doneTimerRef = useRef(null);
  const impactTimerRef = useRef(null);
  const afterTimerRef = useRef(null);
  const stallTimerRef = useRef(null);
  const kickTimerRef = useRef(null);
  const lastPosRef = useRef(0);
  const [inGlory, setInGlory] = useState(false);

  const motion = entry?.motion;
  const film = filmProp || resolveFilmClip(motion);
  const tier = getTierConfig(motion?.motionTier);
  const palette = motion?.palette || [TEAL, TEAL_LIGHT, GOLD];
  const heavy =
    motion?.motionTier === 'legendary' || motion?.motionTier === 'ultimate';
  const meta = film?.meta;
  const durationMs = meta?.durationMs || 3200;
  const gloryMs = meta?.gloryMs || 1000;
  const impactAt = typeof meta?.impactAt === 'number' ? meta.impactAt : 0.3;
  const loopOnce = meta?.loopOnce !== false;
  // TikTok gifts are large center-stage overlays, not letterboxed cinema
  const stageScale = tier.takeover === 'spotlight' ? 0.88 : 1.0;

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
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    if (kickTimerRef.current) {
      clearTimeout(kickTimerRef.current);
      kickTimerRef.current = null;
    }
    chrome.value = withTiming(0, { duration: 220 });
    plaqueProg.value = withTiming(0, { duration: 180 });
    impactFlash.value = withTiming(0, { duration: 120 });
    try {
      videoRef.current?.stopAsync?.();
    } catch {
      // ignore
    }
    void releaseGiftAudioSession();
    setTimeout(() => onDone?.(reason), 200);
  };

  const enterGloryHold = () => {
    if (skippedRef.current || finishedRef.current || inGloryRef.current) return;
    inGloryRef.current = true;
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
    cancelAnimation(impactFlash);
    chrome.value = withTiming(0, { duration: 160 });
    finish('skip');
  };

  useEffect(() => {
    if (!entry || !motion || !film?.source) return undefined;

    skippedRef.current = false;
    finishedRef.current = false;
    inGloryRef.current = false;
    impactFiredRef.current = false;
    aftershockFiredRef.current = false;
    lastPosRef.current = 0;
    setInGlory(false);
    chrome.value = 0;
    plaqueProg.value = 0;
    impactFlash.value = 0;
    glowPulse.value = 0.55;

    // Fire-and-forget: never block mount on audio mode (can hang under IVS).
    ensureGiftAudioSession();
    playGiftAudio(motion.audioKey);

    chrome.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    plaqueProg.value = withTiming(1, {
      duration: 380,
      easing: Easing.out(Easing.cubic),
    });
    glowPulse.value = withSequence(
      withTiming(1, {
        duration: Math.round(durationMs * impactAt),
        easing: Easing.out(Easing.cubic),
      }),
      withTiming(0.7, { duration: 400 })
    );

    const impactMs = Math.round(durationMs * impactAt);
    impactTimerRef.current = setTimeout(() => {
      if (skippedRef.current || impactFiredRef.current) return;
      impactFiredRef.current = true;
      fireImpactHaptic(heavy);
      impactFlash.value = withSequence(
        withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 320, easing: Easing.in(Easing.cubic) })
      );
    }, impactMs);

    if (motion.motionTier === 'ultimate' || motion.motionTier === 'legendary') {
      afterTimerRef.current = setTimeout(() => {
        if (skippedRef.current || aftershockFiredRef.current) return;
        aftershockFiredRef.current = true;
        fireAftershock();
      }, Math.round(durationMs * Math.min(0.62, impactAt + 0.22)));
    }

    // Kick playback once after mount — shouldPlay alone can stick on frame 0
    // after an audio-session fight or concurrent remount.
    kickTimerRef.current = setTimeout(() => {
      if (skippedRef.current || finishedRef.current) return;
      try {
        videoRef.current?.playAsync?.();
      } catch {
        // ignore
      }
    }, 180);

    // If ExoPlayer never advances, dismiss instead of soft-locking the room.
    stallTimerRef.current = setTimeout(() => {
      if (skippedRef.current || finishedRef.current || inGloryRef.current) return;
      if (lastPosRef.current < 80) {
        try {
          videoRef.current?.playAsync?.();
        } catch {
          // ignore
        }
        setTimeout(() => {
          if (skippedRef.current || finishedRef.current || inGloryRef.current) return;
          if (lastPosRef.current < 80) finish('stall');
        }, 900);
      }
    }, 1600);

    doneTimerRef.current = setTimeout(() => {
      if (!skippedRef.current && !finishedRef.current) finish('timeout');
    }, durationMs + gloryMs + 800);

    return () => {
      if (impactTimerRef.current) clearTimeout(impactTimerRef.current);
      if (afterTimerRef.current) clearTimeout(afterTimerRef.current);
      if (gloryTimerRef.current) clearTimeout(gloryTimerRef.current);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
      if (kickTimerRef.current) clearTimeout(kickTimerRef.current);
      cancelAnimation(chrome);
      cancelAnimation(plaqueProg);
      cancelAnimation(impactFlash);
      cancelAnimation(glowPulse);
      try {
        videoRef.current?.unloadAsync?.();
      } catch {
        // ignore
      }
      void releaseGiftAudioSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const onPlaybackStatusUpdate = (status) => {
    if (!status?.isLoaded || skippedRef.current || finishedRef.current) return;
    const pos = Number(status.positionMillis) || 0;
    if (pos > lastPosRef.current) lastPosRef.current = pos;
    // Do NOT call setStatusAsync here — mid-playback mute flips stall ExoPlayer
    // on Android (especially under live IVS audio focus). Props already unmute.
    if (status.didJustFinish) {
      enterGloryHold();
    }
  };

  const vignetteStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * (tier.takeover === 'spotlight' ? 0.28 : 0.42),
  }));

  const plaqueStyle = useAnimatedStyle(() => ({
    opacity: plaqueProg.value * chrome.value,
    transform: [
      { translateY: (1 - plaqueProg.value) * 16 },
      { scale: 0.96 + plaqueProg.value * 0.04 },
    ],
  }));

  const skipHintStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * 0.55 * (inGlory ? 0.35 : 1),
  }));

  const stageStyle = useAnimatedStyle(() => ({
    opacity: chrome.value,
    transform: [{ scale: (0.92 + chrome.value * 0.08) * stageScale }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: chrome.value * glowPulse.value * (budget.bloom ? 0.85 : 0.55),
    transform: [{ scale: 0.85 + glowPulse.value * 0.25 }],
  }));

  const flashStyle = useAnimatedStyle(() => ({
    opacity: impactFlash.value * 0.72,
  }));

  if (!entry || !motion || !film?.source) return null;

  const stageH = tier.takeover === 'spotlight' ? SCREEN_H * 0.62 : SCREEN_H;
  // Purchased full-scene films (composite: 'opaque') keep normal blend so scenic
  // backgrounds stay solid. Authored dark-key heroes keep screen blend.
  const useOpaque = meta?.composite === 'opaque' || meta?.blendMode === 'normal';
  const blendStyle =
    !useOpaque && (Platform.OS === 'android' || Platform.OS === 'ios')
      ? { mixBlendMode: 'screen' }
      : null;

  return (
    <View
      style={[styles.root, tier.takeover === 'spotlight' ? styles.spotlightRoot : null]}
      pointerEvents="box-none"
    >
      <Animated.View style={[styles.vignette, vignetteStyle]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(0,0,0,0.15)', 'rgba(2,8,14,0.55)', 'rgba(0,0,0,0.35)']}
          locations={[0, 0.55, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.glowPlate,
          { backgroundColor: palette[1] || TEAL },
          glowStyle,
        ]}
        pointerEvents="none"
      />

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
          style={[styles.video, blendStyle]}
          resizeMode={ResizeMode.COVER}
          shouldPlay
          isLooping={!loopOnce}
          isMuted={false}
          volume={1}
          progressUpdateIntervalMillis={100}
          useNativeControls={false}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
          onError={() => {
            if (!finishedRef.current) finish('error');
          }}
        />
        {/* Soft grade — keeps teal/gold brand without crushing FX */}
        <LinearGradient
          colors={['rgba(0,210,190,0.06)', 'transparent', 'rgba(251,191,36,0.05)']}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={styles.grade}
          pointerEvents="none"
        />
      </Animated.View>

      <Animated.View style={[styles.impactFlash, flashStyle]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(255,255,255,0.95)', 'rgba(253,224,71,0.55)', 'rgba(255,255,255,0)']}
          start={{ x: 0.5, y: 0.35 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
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
    backgroundColor: 'transparent',
  },
  spotlightRoot: {
    justifyContent: 'flex-start',
    paddingTop: SCREEN_H * 0.1,
    backgroundColor: 'transparent',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
  },
  glowPlate: {
    position: 'absolute',
    width: SCREEN_W * 1.15,
    height: SCREEN_W * 1.15,
    borderRadius: SCREEN_W,
    opacity: 0.4,
  },
  stage: {
    width: SCREEN_W,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  fullStage: {
    ...StyleSheet.absoluteFillObject,
  },
  spotlightStage: {
    borderRadius: 24,
    overflow: 'hidden',
    width: SCREEN_W * 0.96,
    alignSelf: 'center',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  grade: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  impactFlash: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  plaqueWrap: {
    position: 'absolute',
    bottom: SCREEN_H * 0.12,
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
    bottom: SCREEN_H * 0.07,
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
