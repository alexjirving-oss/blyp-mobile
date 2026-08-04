// BlypAvatar.js
//
// Avatar + positive-only standing badge overlay, so the badge can appear on a
// user's avatar wherever it shows (posts, comments, live, profile) — per the
// Charter. New code should prefer this; existing inline avatars can adopt it
// incrementally.

import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import StandingBadge from './StandingBadge';
import AvatarFrame from './AvatarFrame';
import { COLORS } from '../styles/theme';

const initialsOf = (name) => {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
};

/**
 * @param {object} props
 * @param {string} [props.uri] avatar image url
 * @param {string} [props.name] for initials fallback
 * @param {object} [props.profile] used to derive the standing badge
 * @param {number} [props.size]
 * @param {boolean} [props.showBadge]
 * @param {string} [props.frame] admin-granted avatar frame id (e.g. gold_crown)
 */
const BlypAvatar = ({ uri, name, profile, size = 44, showBadge = true, frame, style }) => {
  const badgeSize = Math.max(14, Math.round(size * 0.38));
  const frameId = frame || profile?.avatarFrame || null;
  const framed = !!frameId;
  const outerSize = framed ? size + 14 : size;

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
        <StandingBadge
          profile={profile}
          variant="dot"
          size={badgeSize}
          style={styles.badgeOverlay}
        />
      )}
    </View>
  );

  return (
    <View style={[{ width: outerSize, height: outerSize, alignItems: 'center', justifyContent: 'center' }, style]}>
      {framed ? (
        <AvatarFrame frameId={frameId} size={size}>
          {avatarBody}
        </AvatarFrame>
      ) : (
        avatarBody
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  img: { backgroundColor: COLORS.backgroundCard },
  fallback: { backgroundColor: COLORS.backgroundCard, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  initials: { color: COLORS.textPrimary, fontWeight: '800' },
  badgeOverlay: { position: 'absolute', right: -2, bottom: -2 },
});

export default BlypAvatar;
