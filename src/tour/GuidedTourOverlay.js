/**
 * GuidedTourOverlay — cinematic coach with spotlight mask, pulse ring,
 * compact single-CTA callout, and optional beat visuals (gifts / Stage Desk).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
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
import { PressableLift } from '../components/motion';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { placeCallout, resolveStepTarget } from './tourTargets';

const CARD_ESTIMATE_H = 168;

function SpotlightHole({ rect, screenW, screenH, pulse }) {
  if (!rect || screenW < 1 || screenH < 1) {
    return <View style={styles.scrimFull} pointerEvents="none" />;
  }

  const pad = 10;
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  const w = Math.min(screenW - x, rect.width + pad * 2);
  const h = Math.min(screenH - y, rect.height + pad * 2);
  const radius = Math.min(22, Math.max(14, Math.min(w, h) / 3.5));

  const ringScale = pulse
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] })
    : 1;
  const ringOpacity = pulse
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0.45] })
    : 0.85;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.scrimBlock, { left: 0, top: 0, width: screenW, height: y }]} />
      <View style={[styles.scrimBlock, { left: 0, top: y, width: x, height: h }]} />
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
      <Animated.View
        style={[
          styles.holeRing,
          {
            left: x,
            top: y,
            width: w,
            height: h,
            borderRadius: radius,
            opacity: ringOpacity,
            transform: typeof ringScale === 'number' ? undefined : [{ scale: ringScale }],
          },
        ]}
      />
      <View
        style={[
          styles.holeGlow,
          {
            left: x - 4,
            top: y - 4,
            width: w + 8,
            height: h + 8,
            borderRadius: radius + 4,
          },
        ]}
      />
    </View>
  );
}

function GiftsWowBeat({ active }) {
  const burst = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      burst.setValue(0);
      return undefined;
    }
    burst.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(burst, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(burst, {
          toValue: 0,
          duration: 420,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, burst]);

  if (!active) return null;

  const scale = burst.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.35] });
  const opacity = burst.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 0.15] });

  return (
    <View style={styles.beatLayer} pointerEvents="none">
      <Animated.View style={[styles.giftBurst, { opacity, transform: [{ scale }] }]}>
        <LinearGradient
          colors={['rgba(0,210,190,0.0)', 'rgba(0,210,190,0.45)', 'rgba(251,191,36,0.35)']}
          style={styles.giftBurstGrad}
        />
        <Icon name="gift" size={36} color={COLORS.primary} />
      </Animated.View>
      {[0, 1, 2, 3, 4].map((i) => {
        const angle = (i / 5) * Math.PI * 2;
        const tx = Math.cos(angle) * 54;
        const ty = Math.sin(angle) * 40;
        const pOpacity = burst.interpolate({
          inputRange: [0, 0.4, 1],
          outputRange: [0, 0.9, 0],
        });
        return (
          <Animated.View
            key={`spark-${i}`}
            style={[
              styles.giftSpark,
              {
                opacity: pOpacity,
                transform: [
                  {
                    translateX: burst.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, tx],
                    }),
                  },
                  {
                    translateY: burst.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, ty],
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function StageDeskPeek({ active }) {
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      slide.setValue(0);
      return undefined;
    }
    slide.setValue(0);
    Animated.spring(slide, {
      toValue: 1,
      friction: 8,
      tension: 70,
      useNativeDriver: true,
    }).start();
    return undefined;
  }, [active, slide]);

  if (!active) return null;

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [28, 0] });
  const opacity = slide;

  return (
    <Animated.View
      style={[styles.stagePeek, { opacity, transform: [{ translateY }] }]}
      pointerEvents="none"
    >
      <View style={styles.stagePeekHeader}>
        <View style={styles.stageDot} />
        <Text style={styles.stagePeekTitle}>Stage Desk</Text>
        <Text style={styles.stagePeekBadge}>HOST</Text>
      </View>
      <View style={styles.stageModules}>
        {['Chat', 'Gifts', 'Guests', 'Goals'].map((label) => (
          <View key={label} style={styles.stageModule}>
            <Text style={styles.stageModuleText}>{label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.stagePeekHint}>Pin modules · reorder · go live ready</Text>
    </Animated.View>
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
  const contentAnim = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [cardSize, setCardSize] = useState({
    width: Math.min(width - responsiveSize(28), responsiveSize(360)),
    height: CARD_ESTIMATE_H,
  });

  const isLast = stepIndex >= stepCount - 1;
  const progress = stepCount > 0 ? (stepIndex + 1) / stepCount : 1;

  const metrics = useMemo(
    () => ({ width, height, insets }),
    [width, height, insets]
  );

  const target = useMemo(() => {
    void targetRevision;
    return resolveStepTarget(step, metrics);
  }, [step, metrics, targetRevision]);

  const placement = useMemo(() => {
    const cardW = cardSize.width || Math.min(width - 28, 360);
    const cardH = cardSize.height || CARD_ESTIMATE_H;
    const stageExtra = step?.beat === 'stageDesk' ? 96 : 0;
    return placeCallout({
      screenW: width,
      screenH: height,
      insets,
      target,
      cardW,
      cardH: cardH + stageExtra,
      preferred: step?.preferredPlacement,
    });
  }, [width, height, insets, target, cardSize, step?.preferredPlacement, step?.beat]);

  useEffect(() => {
    if (!visible) {
      fade.setValue(0);
      return undefined;
    }
    Animated.timing(fade, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    return undefined;
  }, [visible, fade]);

  useEffect(() => {
    if (!visible) return undefined;
    contentAnim.setValue(0);
    Animated.spring(contentAnim, {
      toValue: 1,
      friction: 7,
      tension: 80,
      useNativeDriver: true,
    }).start();
    return undefined;
  }, [step?.id, visible, contentAnim]);

  useEffect(() => {
    if (!visible) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse, step?.id]);

  useEffect(() => {
    setCardSize((prev) => ({
      width: prev.width || Math.min(width - responsiveSize(28), responsiveSize(360)),
      height: CARD_ESTIMATE_H,
    }));
  }, [step?.id, width]);

  if (!step) return null;

  const cardW = Math.min(width - responsiveSize(28), responsiveSize(360));
  const ctaLabel = step.cta || (isLast ? 'Finish' : 'Next');
  const contentTranslate = contentAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });
  const contentScale = contentAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
  });

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onSkip}
    >
      <Animated.View style={[styles.root, { opacity: fade }]}>
        <SpotlightHole rect={target} screenW={width} screenH={height} pulse={pulse} />

        <GiftsWowBeat active={visible && step.beat === 'gifts'} />

        <Animated.View
          style={[
            styles.sheetWrap,
            {
              width: cardW,
              left: placement.x,
              top: placement.y,
              opacity: contentAnim,
              transform: [{ translateY: contentTranslate }, { scale: contentScale }],
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
          <BlurView intensity={34} tint="dark" style={styles.blur}>
            <View style={styles.sheetInner}>
              <LinearGradient
                colors={['rgba(0,210,190,0.95)', 'rgba(0,210,190,0.15)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.accentBar}
              />

              <View style={styles.topRow}>
                <View style={styles.progressChip}>
                  <View style={[styles.trackFillInline, { width: `${Math.round(progress * 100)}%` }]} />
                  <Text style={styles.progressLabel}>
                    {stepIndex + 1}/{stepCount}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={onSkip}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel="Skip tour"
                >
                  <Text style={styles.skip}>Skip</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.titleRow}>
                <View style={styles.iconWrap}>
                  <Icon name={step.icon || 'sparkles'} size={18} color={COLORS.black} />
                </View>
                <Text style={styles.title} numberOfLines={1}>
                  {step.title}
                </Text>
              </View>

              <Text style={styles.body} numberOfLines={2}>
                {step.body}
              </Text>

              {step.beat === 'stageDesk' ? <StageDeskPeek active /> : null}

              {step.soft ? (
                <Text style={styles.softNote}>Available with Blyp Plus</Text>
              ) : null}

              <View style={styles.actions}>
                {stepIndex > 0 ? (
                  <TouchableOpacity
                    style={styles.backBtn}
                    onPress={onBack}
                    accessibilityRole="button"
                    accessibilityLabel="Previous step"
                  >
                    <Icon name="chevron-back" size={18} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.backBtnPlaceholder} />
                )}

                <PressableLift
                  style={styles.nextBtn}
                  onPress={isLast ? onDone : onNext}
                  accessibilityRole="button"
                  accessibilityLabel={ctaLabel}
                >
                  <Text style={styles.nextText}>{ctaLabel}</Text>
                  {!isLast ? (
                    <Icon name="arrow-forward" size={16} color={COLORS.black} />
                  ) : null}
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
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  scrimBlock: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  holeRing: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: 'rgba(0,210,190,0.95)',
    backgroundColor: 'transparent',
  },
  holeGlow: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
    backgroundColor: 'transparent',
  },
  beatLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  giftBurst: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  giftBurstGrad: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 48,
  },
  giftSpark: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  stagePeek: {
    marginTop: responsiveSize(10),
    marginBottom: responsiveSize(4),
    borderRadius: responsiveSize(14),
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
    backgroundColor: 'rgba(8,12,16,0.72)',
    padding: responsiveSize(10),
  },
  stagePeekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  stageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  stagePeekTitle: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  stagePeekBadge: {
    color: COLORS.black,
    backgroundColor: COLORS.primary,
    fontSize: responsiveFont(10),
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  stageModules: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stageModule: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  stageModuleText: {
    color: 'rgba(226,232,240,0.9)',
    fontSize: responsiveFont(11),
    fontWeight: '700',
  },
  stagePeekHint: {
    marginTop: 8,
    color: COLORS.textMuted,
    fontSize: responsiveFont(11),
    fontWeight: '600',
  },
  sheetWrap: {
    position: 'absolute',
    borderRadius: responsiveSize(18),
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    maxWidth: '100%',
    shadowColor: '#00D2BE',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  blur: {
    borderRadius: responsiveSize(18),
    overflow: 'hidden',
  },
  sheetInner: {
    backgroundColor: 'rgba(12,14,18,0.78)',
    paddingHorizontal: responsiveSize(16),
    paddingTop: responsiveSize(12),
    paddingBottom: responsiveSize(12),
  },
  accentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: responsiveSize(10),
  },
  progressChip: {
    height: 18,
    minWidth: 52,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.08)',
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
    color: COLORS.textMuted,
    fontSize: responsiveFont(11),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  skip: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(13),
    fontWeight: '600',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(10),
    marginBottom: responsiveSize(6),
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
    color: 'rgba(226,232,240,0.9)',
    fontSize: responsiveFont(13.5),
    lineHeight: responsiveFont(19),
    marginBottom: responsiveSize(4),
  },
  softNote: {
    color: COLORS.primary,
    fontSize: responsiveFont(11),
    fontWeight: '700',
    marginTop: responsiveSize(2),
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(10),
    marginTop: responsiveSize(12),
  },
  backBtn: {
    width: responsiveSize(44),
    height: responsiveSize(44),
    borderRadius: responsiveSize(12),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnPlaceholder: {
    width: responsiveSize(8),
  },
  nextBtn: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: responsiveSize(12),
    paddingVertical: responsiveSize(12),
    paddingHorizontal: responsiveSize(14),
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  nextText: {
    color: COLORS.black,
    fontSize: responsiveFont(15),
    fontWeight: '800',
  },
});
