// StandingBadge.js
//
// The PUBLIC, positive-only standing badge (see BLYP_CHARTER.md → Trust & safety).
// It can ONLY ever say something good — Verified, Trusted, Established. There is
// deliberately no public "low" badge: bad standing is handled privately and
// fairly via the account rating, never broadcast over someone's head.
//
// Two shapes:
//   • variant="dot"  — a small icon disc to overlay on an avatar (default).
//   • variant="chip" — icon + label pill for headers / profile.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Icon from './Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont } from '../utils/scaleUtils';
import { standingFor } from '../services/transparencyService';

export const BADGE_META = {
  verified: { color: '#34c759', icon: 'checkmark-circle', label: 'Verified' },
  trusted: { color: '#FF2D55', icon: 'shield-checkmark', label: 'Trusted' },
  legacy: { color: '#f5a623', icon: 'ribbon', label: 'Established' },
};

/**
 * @param {object} props
 * @param {object} [props.profile] user profile (verified, createdAt, accountRating)
 * @param {string} [props.tier] explicit tier override ('verified'|'trusted'|'legacy')
 * @param {string} [props.label] explicit label override
 * @param {'dot'|'chip'} [props.variant]
 * @param {number} [props.size] dot diameter (variant="dot")
 */
const StandingBadge = ({ profile, tier, label, variant = 'dot', size = 16, style }) => {
  const resolvedTier = tier || (profile ? standingFor(profile).badgeTier : 'new');
  const meta = BADGE_META[resolvedTier];
  if (!meta) return null; // positive-only: nothing for 'new' / unknown

  if (variant === 'chip') {
    return (
      <View style={[styles.chip, { borderColor: meta.color, backgroundColor: `${meta.color}22` }, style]}>
        <Icon name={meta.icon} size={13} color={meta.color} />
        <Text style={[styles.chipText, { color: meta.color }]}>{label || meta.label}</Text>
      </View>
    );
  }

  const dim = size;
  return (
    <View
      style={[
        styles.dot,
        { width: dim, height: dim, borderRadius: dim / 2, backgroundColor: COLORS.background },
        style,
      ]}
    >
      <Icon name={meta.icon} size={dim - 3} color={meta.color} />
    </View>
  );
};

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: responsiveFont(12), fontWeight: '800' },
  dot: { alignItems: 'center', justifyContent: 'center' },
});

export default StandingBadge;
