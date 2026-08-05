/**
 * AvatarRing — soft breathe ring for active / live / story avatars.
 * Pulse only when animated (default for live/story). Prefer active feed cells only.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { COLORS } from '../../styles/theme';

export type AvatarRingVariant = 'none' | 'brand' | 'live' | 'story';

type Props = {
  size: number;
  children: React.ReactNode;
  variant?: AvatarRingVariant;
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
  ringWidth?: number;
};

const RING_COLORS: Record<Exclude<AvatarRingVariant, 'none'>, string> = {
  brand: COLORS.primary,
  live: '#FB7185',
  story: COLORS.primary,
};

export function AvatarRing({
  size,
  children,
  variant = 'none',
  animated,
  style,
  ringWidth = 2.5,
}: Props) {
  const shouldPulse = animated ?? (variant === 'live' || variant === 'story');
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!shouldPulse || variant === 'none') {
      breath.stopAnimation();
      breath.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shouldPulse, variant, breath]);

  if (variant === 'none') {
    return <View style={style}>{children}</View>;
  }

  const pad = ringWidth + 3;
  const outer = size + pad * 2;
  const color = RING_COLORS[variant];
  const ringOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.88] });
  const ringScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  return (
    <View style={[{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            borderWidth: ringWidth,
            borderColor: color,
            opacity: shouldPulse ? ringOpacity : 0.85,
            transform: shouldPulse ? [{ scale: ringScale }] : undefined,
            shadowColor: color,
            shadowOpacity: 0.16,
            shadowRadius: 5,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
      />
      <View style={[styles.childWrap, { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', elevation: 0 },
  childWrap: { alignItems: 'center', justifyContent: 'center', zIndex: 1 },
});

export default AvatarRing;
