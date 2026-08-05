// BlypAvatar.js — avatar + standing badge; optional pulse ring for live/active.
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import StandingBadge from './StandingBadge';
import AvatarFrame from './AvatarFrame';
import AvatarRing from './motion/AvatarRing';
import { COLORS } from '../styles/theme';

const initialsOf = (name) => {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
};

const BlypAvatar = ({
  uri,
  name,
  profile,
  size = 44,
  showBadge = true,
  frame,
  pulse = false,
  pulseTone = 'brand',
  style,
}) => {
  const badgeSize = Math.max(14, Math.round(size * 0.38));
  const frameId = frame || profile?.avatarFrame || null;
  const framed = !!frameId;
  const outerSize = framed ? size + 14 : pulse ? size + 10 : size;

  const avatarBody = (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <Image source={{ uri }} style={[styles.img, { width: size, height: size, borderRadius: size / 2 }]} />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initialsOf(name)}</Text>
        </View>
      )}
      {showBadge && (
        <StandingBadge profile={profile} variant="dot" size={badgeSize} style={styles.badgeOverlay} />
      )}
    </View>
  );

  const content = framed ? (
    <AvatarFrame frameId={frameId} size={size}>{avatarBody}</AvatarFrame>
  ) : pulse ? (
    <AvatarRing variant={pulseTone} animated size={size} ringWidth={2}>{avatarBody}</AvatarRing>
  ) : (
    avatarBody
  );

  return (
    <View style={[{ width: outerSize, height: outerSize, alignItems: 'center', justifyContent: 'center' }, style]}>
      {content}
    </View>
  );
};

const styles = StyleSheet.create({
  img: { backgroundColor: COLORS.backgroundCard },
  fallback: {
    backgroundColor: COLORS.backgroundCard,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  initials: { color: COLORS.textPrimary, fontWeight: '800' },
  badgeOverlay: { position: 'absolute', right: -2, bottom: -2 },
});

export default BlypAvatar;
