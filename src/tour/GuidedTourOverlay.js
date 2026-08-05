/**
 * GuidedTourOverlay — teal-branded coach card with spotlight + free-space placement.
 * Semi-transparent scrim/card keep the underlying UI readable.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import { PressableLift } from '../components/motion';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { placeCallout, resolveStepTarget } from './tourTargets';

const CARD_ESTIMATE_H = 280;

function SpotlightHole({ rect, screenW, screenH }) {
  if (!rect || screenW < 1 || screenH < 1) {
    return <View style={styles.scrimFull} pointerEvents="none" />;
  }

  const pad = 8;
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  const w = Math.min(screenW - x, rect.width + pad * 2);
  const h = Math.min(screenH - y, rect.height + pad * 2);
  const radius = Math.min(18, Math.max(12, Math.min(w, h) / 4));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.scrimBlock, { left: 0, top: 0, width: screenW, height: y }]} />
      <View
        style={[
          styles.scrimBlock,
          { left: 0, top: y, width: x, height: h },
        ]}
      />
      <View
        style={[
          styles.scrimBlock,
          { left: x + w, top: y, width: Math.max(0, screenW - x - w), height: h },
        ]}
      />
      <View
        style={[
          styles.scrimBlock,
          { left: 0, top: y + h, width: screenW, height: Math.max(0, screenH - y - h) },
        ]}
      />
      <View
        style={[
          styles.holeRing,
          {
            left: x,
            top: y,
            width: w,
            height: h,
            borderRadius: radius,
          },
        ]}
      />
    </View>
  );
}

export default function GuidedTourOverlay({
  visible,
  step,
  stepIndex = 0,
  stepCount = 1,
  targetRevision = 0,
  onNext,
  onBack,
  onSkip,
  onDone,
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const fade = useRef(new Animated.Value(0)).current;
  const contentFade = useRef(new Animated.Value(1)).current;
  const [cardSize, setCardSize] = useState({
    width: Math.min(width - responsiveSize(24), responsiveSize(400)),
    height: CARD_ESTIMATE_H,
  });

  const isLast = stepIndex >= stepCount - 1;
  const progress = stepCount > 0 ? (stepIndex + 1) / stepCount : 1;

  const metrics = useMemo(
    () => ({ width, height, insets }),
    [width, height, insets]
  );

  const target = useMemo(() => {
    // targetRevision forces re-resolve after live measures land.
    void targetRevision;
    return resolveStepTarget(step, metrics);
  }, [step, metrics, targetRevision]);

  const placement = useMemo(() => {
    const cardW = cardSize.width || Math.min(width - 24, 400);
    const cardH = cardSize.height || CARD_ESTIMATE_H;
    return placeCallout({
      screenW: width,
      screenH: height,
      insets,
      target,
      cardW,
      cardH,
      preferred: step?.preferredPlacement,
    });
  }, [width, height, insets, target, cardSize, step?.preferredPlacement]);

  useEffect(() => {
    if (!visible) {
      fade.setValue(0);
      return undefined;
    }
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    return undefined;
  }, [visible, fade]);

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

  // Reset estimated height when step changes so placement can reflow after onLayout.
  useEffect(() => {
    setCardSize((prev) => ({
      width: prev.width || Math.min(width - responsiveSize(24), responsiveSize(400)),
      height: CARD_ESTIMATE_H,
    }));
  }, [step?.id, width]);

  const dots = useMemo(() => {
    const maxDots = Math.min(stepCount, 12);
    return Array.from({ length: maxDots }, (_, i) => i);
  }, [stepCount]);

  if (!step) return null;

  const cardW = Math.min(width - responsiveSize(24), responsiveSize(400));

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onSkip}
    >
      <Animated.View style={[styles.root, { opacity: fade }]}>
        <SpotlightHole rect={target} screenW={width} screenH={height} />

        <Animated.View
          style={[
            styles.sheetWrap,
            {
              width: cardW,
              left: placement.x,
              top: placement.y,
              opacity: contentFade,
            },
          ]}
          onLayout={(e) => {
            const { width: w, height: h } = e.nativeEvent.layout;
            if (!w || !h) return;
            setCardSize((prev) => {
              if (Math.abs(prev.width - w) < 1 && Math.abs(prev.height - h) < 1) return prev;
              return { width: w, height: h };
            });
          }}
        >
          <BlurView intensity={28} tint="dark" style={styles.blur}>
            <View style={styles.sheetInner}>
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

              <View style={styles.iconWrap}>
                <Icon name={step.icon || 'sparkles'} size={24} color={COLORS.black} />
              </View>

              <Text style={styles.title}>{step.title}</Text>
              <Text style={styles.body}>{step.body}</Text>
              {step.soft ? (
                <Text style={styles.softNote}>Available with Blyp Plus</Text>
              ) : null}

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
            </View>
          </BlurView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrimFull: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  scrimBlock: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  holeRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(0,210,190,0.85)',
    backgroundColor: 'transparent',
  },
  sheetWrap: {
    position: 'absolute',
    borderRadius: responsiveSize(20),
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    maxWidth: '100%',
  },
  blur: {
    borderRadius: responsiveSize(20),
    overflow: 'hidden',
  },
  sheetInner: {
    backgroundColor: 'rgba(18,18,22,0.72)',
    paddingHorizontal: responsiveSize(18),
    paddingTop: responsiveSize(12),
    paddingBottom: responsiveSize(14),
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
    marginBottom: responsiveSize(8),
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
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    marginBottom: responsiveSize(14),
  },
  trackFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  iconWrap: {
    width: responsiveSize(42),
    height: responsiveSize(42),
    borderRadius: responsiveSize(21),
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: responsiveSize(10),
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(20),
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: responsiveSize(6),
  },
  body: {
    color: 'rgba(226,232,240,0.92)',
    fontSize: responsiveFont(14),
    lineHeight: responsiveFont(20),
    marginBottom: responsiveSize(4),
  },
  softNote: {
    color: COLORS.primary,
    fontSize: responsiveFont(12),
    fontWeight: '700',
    marginTop: responsiveSize(4),
    marginBottom: responsiveSize(2),
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(5),
    marginTop: responsiveSize(12),
    marginBottom: responsiveSize(12),
  },
  dot: {
    width: responsiveSize(5),
    height: responsiveSize(5),
    borderRadius: responsiveSize(2.5),
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  dotActive: {
    width: responsiveSize(14),
    backgroundColor: COLORS.primary,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(10),
  },
  backBtn: {
    paddingVertical: responsiveSize(12),
    paddingHorizontal: responsiveSize(14),
    borderRadius: responsiveSize(12),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  backBtnPlaceholder: {
    width: responsiveSize(64),
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
    paddingVertical: responsiveSize(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: {
    color: COLORS.black,
    fontSize: responsiveFont(16),
    fontWeight: '800',
  },
});
