/**
 * GuidedTourOverlay — autonomous page tour.
 *
 * Beat per step: clean preview → text card → clean → auto-advance.
 * No spotlight / slit / hole cutouts. Soft dim only while text is up.
 * Overlay is a sibling View (not Modal) so the live feed can keep playing.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { TOUR_POST_MS, TOUR_PRE_MS, TOUR_TEXT_MS } from './tourSteps';

/** @typedef {'pre' | 'text' | 'post'} TourPhase */

export default function GuidedTourOverlay({
  visible,
  step,
  stepIndex = 0,
  stepCount = 1,
  onAdvance,
  onSkip,
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [phase, setPhase] = useState(/** @type {TourPhase} */ ('pre'));

  const dimAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;
  const advanceRef = useRef(onAdvance);
  advanceRef.current = onAdvance;

  const isLast = stepIndex >= stepCount - 1;
  const progress = stepCount > 0 ? (stepIndex + 1) / stepCount : 1;
  const cardW = Math.min(width - responsiveSize(32), responsiveSize(340));

  // Drive PRE → TEXT → POST → advance for each step.
  useEffect(() => {
    if (!visible || !step?.id) {
      setPhase('pre');
      dimAnim.setValue(0);
      cardAnim.setValue(0);
      return undefined;
    }

    let cancelled = false;
    const timers = [];
    const run = (ms, fn) => {
      timers.push(setTimeout(fn, ms));
    };

    setPhase('pre');
    dimAnim.setValue(0);
    cardAnim.setValue(0);

    run(TOUR_PRE_MS, () => {
      if (cancelled) return;
      setPhase('text');
      Animated.parallel([
        Animated.timing(dimAnim, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(cardAnim, {
          toValue: 1,
          friction: 8,
          tension: 90,
          useNativeDriver: true,
        }),
      ]).start();
    });

    run(TOUR_PRE_MS + TOUR_TEXT_MS, () => {
      if (cancelled) return;
      setPhase('post');
      Animated.parallel([
        Animated.timing(dimAnim, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cardAnim, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    });

    run(TOUR_PRE_MS + TOUR_TEXT_MS + TOUR_POST_MS, () => {
      if (cancelled) return;
      try {
        advanceRef.current?.({ isLast });
      } catch {
        /* ignore */
      }
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [visible, step?.id, stepIndex, stepCount, isLast, dimAnim, cardAnim]);

  if (!visible || !step) return null;

  const showText = phase === 'text';
  const cardTranslate = cardAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });
  const cardScale = cardAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
  });

  return (
    <View
      style={styles.root}
      pointerEvents="box-none"
      accessibilityViewIsModal
      accessibilityLabel="Blyp tour"
    >
      {/* Soft dim only during text — keeps videos visible/playing underneath. */}
      <Animated.View
        pointerEvents={showText ? 'auto' : 'none'}
        style={[styles.dim, { opacity: dimAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) }]}
      />

      {/* Exit always reachable; does not block the page during PRE/POST. */}
      <View
        style={[styles.exitRow, { paddingTop: (insets.top || 0) + responsiveSize(8) }]}
        pointerEvents="box-none"
      >
        {showText ? (
          <View style={styles.progressChip} pointerEvents="none">
            <View style={[styles.trackFillInline, { width: `${Math.round(progress * 100)}%` }]} />
            <Text style={styles.progressLabel}>
              {stepIndex + 1}/{stepCount}
            </Text>
          </View>
        ) : (
          <View />
        )}
        <TouchableOpacity
          onPress={onSkip}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Exit tour"
          style={styles.exitBtn}
        >
          <Text style={styles.exitText}>Exit</Text>
        </TouchableOpacity>
      </View>

      <Animated.View
        pointerEvents={showText ? 'auto' : 'none'}
        style={[
          styles.cardWrap,
          {
            width: cardW,
            left: (width - cardW) / 2,
            bottom: Math.max(insets.bottom || 0, 12) + responsiveSize(88),
            opacity: cardAnim,
            transform: [{ translateY: cardTranslate }, { scale: cardScale }],
          },
        ]}
      >
        <BlurView intensity={28} tint="dark" style={styles.blur}>
          <View style={styles.cardInner}>
            <LinearGradient
              colors={['rgba(0,210,190,0.95)', 'rgba(0,210,190,0.2)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.accentBar}
            />
            <View style={styles.titleRow}>
              <View style={styles.iconWrap}>
                <Icon name={step.icon || 'sparkles'} size={18} color={COLORS.black} />
              </View>
              <Text style={styles.title} numberOfLines={1}>
                {step.title}
              </Text>
            </View>
            <Text style={styles.body} numberOfLines={3}>
              {step.body}
            </Text>
            {step.soft ? <Text style={styles.softNote}>Available with Blyp Plus</Text> : null}
          </View>
        </BlurView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10050,
    elevation: 10050,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  exitRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: responsiveSize(16),
    zIndex: 2,
  },
  progressChip: {
    height: 20,
    minWidth: 52,
    borderRadius: 10,
    backgroundColor: 'rgba(10,10,12,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  trackFillInline: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,210,190,0.35)',
  },
  progressLabel: {
    color: COLORS.textMuted || 'rgba(148,163,184,0.95)',
    fontSize: responsiveFont(11),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  exitBtn: {
    paddingHorizontal: responsiveSize(12),
    paddingVertical: responsiveSize(8),
    borderRadius: responsiveSize(10),
    backgroundColor: 'rgba(10,10,12,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  exitText: {
    color: COLORS.textSecondary || 'rgba(226,232,240,0.85)',
    fontSize: responsiveFont(13),
    fontWeight: '700',
  },
  cardWrap: {
    position: 'absolute',
    borderRadius: responsiveSize(18),
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
    shadowColor: '#00D2BE',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  blur: {
    borderRadius: responsiveSize(18),
    overflow: 'hidden',
  },
  cardInner: {
    backgroundColor: 'rgba(10,10,12,0.88)',
    paddingHorizontal: responsiveSize(16),
    paddingTop: responsiveSize(14),
    paddingBottom: responsiveSize(14),
  },
  accentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(10),
    marginBottom: responsiveSize(8),
  },
  iconWrap: {
    width: responsiveSize(32),
    height: responsiveSize(32),
    borderRadius: responsiveSize(16),
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: responsiveFont(18),
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  body: {
    color: 'rgba(226,232,240,0.92)',
    fontSize: responsiveFont(14),
    lineHeight: responsiveFont(20),
  },
  softNote: {
    color: COLORS.primary,
    fontSize: responsiveFont(11),
    fontWeight: '700',
    marginTop: responsiveSize(6),
  },
});
