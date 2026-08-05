// AvatarFrame — optional decorative ring with soft opacity pulse.
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

export const AVATAR_FRAME_IDS = { GOLD_CROWN: 'gold_crown' };

const FRAME_META = {
  [AVATAR_FRAME_IDS.GOLD_CROWN]: { borderColor: '#F5C542', borderWidth: 3, crown: true },
};

export default function AvatarFrame({ frameId, size, children }) {
  const meta = frameId ? FRAME_META[frameId] : null;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!meta) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [meta, pulse]);
  if (!meta) return children;
  const pad = meta.borderWidth + 2;
  const crownSize = Math.max(14, Math.round(size * 0.28));
  const ringSize = size + meta.borderWidth * 2;
  return (
    <View style={{ width: size + pad * 2, height: size + pad * 2, alignItems: 'center', justifyContent: 'center' }}>
      {meta.crown ? <Text style={[styles.crown, { fontSize: crownSize, top: -crownSize * 0.35 }]}>👑</Text> : null}
      <Animated.View
        style={{
          width: ringSize, height: ringSize, borderRadius: ringSize / 2,
          borderWidth: meta.borderWidth, borderColor: meta.borderColor,
          alignItems: 'center', justifyContent: 'center', opacity: pulse,
          shadowColor: meta.borderColor, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  crown: { position: 'absolute', zIndex: 2, textAlign: 'center' },
});
