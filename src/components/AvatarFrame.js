// AvatarFrame — optional decorative ring around avatars (admin-granted).
// First frame: gold circle + crown at the top.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export const AVATAR_FRAME_IDS = {
  GOLD_CROWN: 'gold_crown',
};

const FRAME_META = {
  [AVATAR_FRAME_IDS.GOLD_CROWN]: {
    borderColor: '#F5C542',
    borderWidth: 3,
    crown: true,
  },
};

/**
 * @param {{ frameId?: string | null, size: number, children: React.ReactNode }} props
 */
export default function AvatarFrame({ frameId, size, children }) {
  const meta = frameId ? FRAME_META[frameId] : null;
  if (!meta) return children;

  const pad = meta.borderWidth + 2;
  const crownSize = Math.max(14, Math.round(size * 0.28));

  return (
    <View style={{ width: size + pad * 2, height: size + pad * 2, alignItems: 'center', justifyContent: 'center' }}>
      {meta.crown ? (
        <Text style={[styles.crown, { fontSize: crownSize, top: -crownSize * 0.35 }]}>👑</Text>
      ) : null}
      <View
        style={{
          width: size + meta.borderWidth * 2,
          height: size + meta.borderWidth * 2,
          borderRadius: (size + meta.borderWidth * 2) / 2,
          borderWidth: meta.borderWidth,
          borderColor: meta.borderColor,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: meta.borderColor,
          shadowOpacity: 0.45,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  crown: {
    position: 'absolute',
    zIndex: 2,
    textAlign: 'center',
  },
});
