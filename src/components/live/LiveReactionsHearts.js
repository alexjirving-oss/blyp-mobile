import React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Icon from '../Icon';

/**
 * Floating live reactions.
 *
 * Backwards compatible: pass `burstKey` (number) to launch a heart, OR pass
 * `burst={{ key, emoji }}` to launch any emoji reaction (sticker tray, etc.).
 * Each burst rises with a gentle sway, rotation and fade for a lively feel.
 */
export default function LiveReactionsHearts({
  burst,
  burstKey,
  bottomOffset = 90,
  rightOffset = 18,
  heartSize = 24,
  heartColor = '#ff4d6d',
}) {
  const [items, setItems] = React.useState([]);

  // Resolve the active trigger from either the new object form or legacy number.
  const triggerKey = burst?.key ?? burstKey;
  const triggerEmoji = burst?.emoji ?? null;

  React.useEffect(() => {
    if (triggerKey == null) return;

    const id = `${Date.now()}-${Math.random()}`;
    const progress = new Animated.Value(0);
    const swayDir = Math.random() > 0.5 ? 1 : -1;
    const swayAmount = 16 + Math.random() * 26;
    const rise = -(150 + Math.random() * 110);
    const size = heartSize + Math.floor(Math.random() * 10) - 2;
    const rotateDeg = (Math.random() - 0.5) * 40;
    const duration = 1500 + Math.random() * 700;

    setItems((prev) => [
      ...prev,
      { id, progress, swayDir, swayAmount, rise, size, rotateDeg, emoji: triggerEmoji },
    ]);

    Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setItems((prev) => prev.filter((it) => it.id !== id));
    });
  }, [triggerKey, triggerEmoji, heartSize]);

  if (!items.length) return null;

  return (
    <View style={[styles.container, { bottom: bottomOffset, right: rightOffset }]} pointerEvents="none">
      {items.map((it) => {
        const translateY = it.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, it.rise],
        });
        const translateX = it.progress.interpolate({
          inputRange: [0, 0.4, 0.7, 1],
          outputRange: [0, it.swayDir * it.swayAmount, it.swayDir * -it.swayAmount * 0.6, it.swayDir * it.swayAmount * 0.3],
        });
        const opacity = it.progress.interpolate({
          inputRange: [0, 0.1, 0.75, 1],
          outputRange: [0, 1, 1, 0],
        });
        const scale = it.progress.interpolate({
          inputRange: [0, 0.18, 1],
          outputRange: [0.6, 1.2, 0.95],
        });
        const rotate = it.progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${it.rotateDeg}deg`],
        });
        return (
          <Animated.View
            key={it.id}
            style={[
              styles.item,
              { opacity, transform: [{ translateX }, { translateY }, { scale }, { rotate }] },
            ]}
          >
            {it.emoji ? (
              <Text style={{ fontSize: it.size + 6 }}>{it.emoji}</Text>
            ) : (
              <Icon name="heart" size={it.size} color={heartColor} />
            )}
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  item: {
    position: 'absolute',
    bottom: 0,
  },
});
