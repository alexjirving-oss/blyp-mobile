/**
 * GuidedTourOverlay — teal-branded bottom coach card with progress.
 * Full-screen dim keeps focus on the step without coach-mark spam.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import { PressableLift } from '../components/motion';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';

export default function GuidedTourOverlay({
  visible,
  step,
  stepIndex = 0,
  stepCount = 1,
  onNext,
  onBack,
  onSkip,
  onDone,
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(24)).current;
  const contentFade = useRef(new Animated.Value(1)).current;

  const isLast = stepIndex >= stepCount - 1;
  const progress = stepCount > 0 ? (stepIndex + 1) / stepCount : 1;

  useEffect(() => {
    if (!visible) {
      fade.setValue(0);
      slide.setValue(24);
      return undefined;
    }
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(slide, {
        toValue: 0,
        friction: 9,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();
    return undefined;
  }, [visible, fade, slide]);

  // Soft crossfade when the step body changes.
  useEffect(() => {
    if (!visible) return undefined;
    contentFade.setValue(0.35);
    Animated.timing(contentFade, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    return undefined;
  }, [step?.id, visible, contentFade]);

  const dots = useMemo(() => {
    const maxDots = Math.min(stepCount, 10);
    return Array.from({ length: maxDots }, (_, i) => i);
  }, [stepCount]);

  if (!step) return null;

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onSkip}
    >
      <Animated.View style={[styles.root, { opacity: fade }]}>
        <View style={styles.scrim} pointerEvents="none" />

        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, responsiveSize(16)) + responsiveSize(8),
              maxWidth: Math.min(width - responsiveSize(24), responsiveSize(440)),
              transform: [{ translateY: slide }],
            },
          ]}
        >
          <View style={styles.accentBar} />

          <View style={styles.topRow}>
            <Text style={styles.progressLabel}>
              {stepIndex + 1} of {stepCount}
            </Text>
            <TouchableOpacity
              onPress={onSkip}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Skip tour"
            >
              <Text style={styles.skip}>Skip</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>

          <Animated.View style={{ opacity: contentFade }}>
            <View style={styles.iconWrap}>
              <Icon name={step.icon || 'sparkles'} size={26} color={COLORS.black} />
            </View>

            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.body}>{step.body}</Text>
            {step.soft ? (
              <Text style={styles.softNote}>Available with Blyp Plus</Text>
            ) : null}
          </Animated.View>

          <View style={styles.dotsRow}>
            {dots.map((i) => {
              const active = i === Math.min(stepIndex, dots.length - 1);
              return <View key={`dot-${i}`} style={[styles.dot, active && styles.dotActive]} />;
            })}
          </View>

          <View style={styles.actions}>
            {stepIndex > 0 ? (
              <TouchableOpacity
                style={styles.backBtn}
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Previous step"
              >
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.backBtnPlaceholder} />
            )}

            <PressableLift
              style={styles.nextBtn}
              onPress={isLast ? onDone : onNext}
              accessibilityRole="button"
              accessibilityLabel={isLast ? 'Finish tour' : 'Next step'}
            >
              <Text style={styles.nextText}>{isLast ? 'Done' : 'Next'}</Text>
            </PressableLift>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: responsiveSize(12),
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  sheet: {
    width: '100%',
    backgroundColor: COLORS.cardGlass || '#141418',
    borderRadius: responsiveSize(20),
    paddingHorizontal: responsiveSize(20),
    paddingTop: responsiveSize(14),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    marginBottom: responsiveSize(10),
  },
  accentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: COLORS.primary,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: responsiveSize(10),
  },
  progressLabel: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(12),
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  skip: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(14),
    fontWeight: '600',
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginBottom: responsiveSize(18),
  },
  trackFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  iconWrap: {
    width: responsiveSize(48),
    height: responsiveSize(48),
    borderRadius: responsiveSize(24),
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: responsiveSize(14),
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(22),
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: responsiveSize(8),
  },
  body: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(15),
    lineHeight: responsiveFont(22),
    marginBottom: responsiveSize(6),
  },
  softNote: {
    color: COLORS.primary,
    fontSize: responsiveFont(12),
    fontWeight: '700',
    marginTop: responsiveSize(4),
    marginBottom: responsiveSize(4),
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(6),
    marginTop: responsiveSize(14),
    marginBottom: responsiveSize(16),
  },
  dot: {
    width: responsiveSize(6),
    height: responsiveSize(6),
    borderRadius: responsiveSize(3),
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  dotActive: {
    width: responsiveSize(16),
    backgroundColor: COLORS.primary,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(10),
  },
  backBtn: {
    paddingVertical: responsiveSize(14),
    paddingHorizontal: responsiveSize(16),
    borderRadius: responsiveSize(12),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  backBtnPlaceholder: {
    width: responsiveSize(72),
  },
  backText: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(15),
    fontWeight: '600',
  },
  nextBtn: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: responsiveSize(12),
    paddingVertical: responsiveSize(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: {
    color: COLORS.black,
    fontSize: responsiveFont(16),
    fontWeight: '800',
  },
});
