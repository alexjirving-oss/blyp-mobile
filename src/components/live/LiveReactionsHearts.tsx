import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Icon from '../Icon';

type Heart = {
  id: string;
  translateY: Animated.Value;
  opacity: Animated.Value;
  scale: Animated.Value;
  xJitter: number;
};

export default function LiveReactionsHearts({
  burstKey,
  bottomOffset = 90,
  rightOffset = 18,
  heartSize = 22,
  heartColor = '#ff4d6d',
}: {
  burstKey: any;
  bottomOffset?: number;
  rightOffset?: number;
  heartSize?: number;
  heartColor?: string;
}) {
  const [hearts, setHearts] = React.useState<Heart[]>([]);

  React.useEffect(() => {
    if (burstKey == null) return;

    const id = `${Date.now()}-${Math.random()}`;
    const translateY = new Animated.Value(0);
    const opacity = new Animated.Value(1);
    const scale = new Animated.Value(0.8);
    const xJitter = (Math.random() - 0.5) * 20;

    setHearts((prev) => [...prev, { id, translateY, opacity, scale, xJitter }]);

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -120,
        duration: 1400,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 1400,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1.2,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setHearts((prev) => prev.filter((h) => h.id !== id));
    });
  }, [burstKey]);

  if (!hearts.length) return null;

  return (
    <View style={[styles.container, { bottom: bottomOffset, right: rightOffset }]} pointerEvents="none">
      {hearts.map((h) => (
        <Animated.View
          key={h.id}
          style={{
            transform: [{ translateX: h.xJitter }, { translateY: h.translateY }, { scale: h.scale }],
            opacity: h.opacity,
          }}
        >
          <Icon name="heart" size={heartSize} color={heartColor} style={{}} strokeWidth={undefined} />
        </Animated.View>
      ))}
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
});
