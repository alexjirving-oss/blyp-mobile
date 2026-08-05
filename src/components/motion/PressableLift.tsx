/**
 * PressableLift — light press scale + optional soft shadow for CTAs.
 */
import React, { useCallback, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { COLORS, SHADOWS } from '../../styles/theme';

export type PressableLiftProps = Omit<PressableProps, 'style'> & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  pressedScale?: number;
  lifted?: boolean;
};

export function PressableLift({
  children,
  style,
  contentStyle,
  pressedScale = 0.97,
  lifted = true,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: PressableLiftProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = useCallback(
    (value: number) => {
      Animated.spring(scale, {
        toValue: value,
        useNativeDriver: true,
        friction: 7,
        tension: 220,
        overshootClamping: true,
      }).start();
    },
    [scale],
  );

  return (
    <Pressable
      disabled={disabled}
      onPressIn={(e) => {
        if (!disabled) to(pressedScale);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      style={({ pressed }) => [
        lifted && styles.lift,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      <Animated.View style={[{ transform: [{ scale }] }, contentStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lift: { ...SHADOWS.small, shadowColor: COLORS.black },
  pressed: { shadowOpacity: 0.1, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  disabled: { opacity: 0.5 },
});

export default PressableLift;
