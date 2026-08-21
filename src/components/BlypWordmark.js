import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Text,
  useWindowDimensions,
} from 'react-native';
import { COLORS } from '../styles/theme';

/**
 * Kept for any importer expecting the old export (gradients / legacy teal).
 * Wordmark pulse itself uses warm-night coral — not this ramp.
 * @type {readonly [string, string, string]}
 */
export const BLYP_LOGO_GRADIENT_COLORS = [COLORS.primary, COLORS.primary, COLORS.primaryDark];

/** Warm night coral — matches blyp.world `--blyp-coral` (not neon teal). */
export const BLYP_WORDMARK_PULSE = '#FF4D6D';

const LOGO_BASE = 26;
const LOGO_MIN = 24;
const LOGO_MAX = 28;

/**
 * Canonical in-app Blyp wordmark — lowercase "blyp" + coral pulse.
 *
 * Motion (native-driver, header-safe):
 *  - Mount once: soft fade + 3px settle
 *  - Idle: slow breathe on the pulse dot only (not letters, not scroll-tied)
 *  - Respects Reduce Motion → static mark
 *
 * Used by BlypHeaderFlow (Home + shared chrome). Prefer this over ad-hoc "Blyp" Text.
 */
export function BlypWordmark({
  style,
  textStyle,
  animated = true,
  useGradientBackground: _useGradientBackground = true,
  gradientColors: _gradientColors = undefined,
}) {
  const { width } = useWindowDimensions();
  const scale = Math.min(1.08, Math.max(0.92, width / 390));
  const defaultSize = Math.round(Math.min(LOGO_MAX, Math.max(LOGO_MIN, LOGO_BASE * scale)));
  const size =
    textStyle && typeof textStyle.fontSize === 'number'
      ? Math.min(LOGO_MAX + 4, textStyle.fontSize)
      : defaultSize;
  const dot = Math.max(5, size * 0.16);

  const [reduceMotion, setReduceMotion] = useState(false);
  const enter = useRef(new Animated.Value(animated ? 0 : 1)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {
        if (!cancelled) setReduceMotion(false);
      });
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled) => {
      setReduceMotion(Boolean(enabled));
    });
    return () => {
      cancelled = true;
      if (sub && typeof sub.remove === 'function') sub.remove();
    };
  }, []);

  useEffect(() => {
    enter.stopAnimation();
    pulse.stopAnimation();

    if (!animated || reduceMotion) {
      enter.setValue(1);
      pulse.setValue(0);
      return undefined;
    }

    enter.setValue(0);
    pulse.setValue(0);

    const enterAnim = Animated.timing(enter, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    let pulseLoop = null;
    enterAnim.start(({ finished }) => {
      if (!finished) return;
      pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 2200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 2200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      pulseLoop.start();
    });

    return () => {
      enterAnim.stop();
      if (pulseLoop) pulseLoop.stop();
      enter.stopAnimation();
      pulse.stopAnimation();
    };
  }, [animated, reduceMotion, enter, pulse]);

  const markOpacity = animated && !reduceMotion ? enter : 1;
  const markTranslateY =
    animated && !reduceMotion
      ? enter.interpolate({ inputRange: [0, 1], outputRange: [3, 0] })
      : 0;
  const dotOpacity =
    animated && !reduceMotion
      ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.52, 1] })
      : 1;
  const dotScale =
    animated && !reduceMotion
      ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] })
      : 1;

  return (
    <Animated.View
      accessibilityRole="image"
      accessibilityLabel="blyp"
      style={[
        { flexDirection: 'row', alignItems: 'flex-end' },
        style,
        animated && !reduceMotion
          ? { opacity: markOpacity, transform: [{ translateY: markTranslateY }] }
          : null,
      ]}
    >
      <Text
        allowFontScaling={false}
        style={[
          {
            fontSize: size,
            fontWeight: '800',
            letterSpacing: -size * 0.04,
            color: COLORS.textPrimary,
            includeFontPadding: false,
            lineHeight: Math.round(size * 1.05),
          },
          textStyle,
          // Keep size authoritative after textStyle merge so callers cannot
          // accidentally blow past the brand cap via responsiveFont().
          { fontSize: size, lineHeight: Math.round(size * 1.05) },
        ]}
      >
        blyp
      </Text>
      <Animated.View
        pointerEvents="none"
        style={{
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: BLYP_WORDMARK_PULSE,
          marginLeft: dot * 0.5,
          marginBottom: size * 0.16,
          opacity: dotOpacity,
          transform: [{ scale: dotScale }],
        }}
      />
    </Animated.View>
  );
}

export default BlypWordmark;
