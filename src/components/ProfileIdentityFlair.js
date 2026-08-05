// ProfileIdentityFlair — quiet club + badge chips under a profile bio.
// Tasteful Ionicons labels; no emoji rows. Read-only display.
// Teal clubs + soft violet badges align with ProfileScreen.v3 accent language.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Icon from './Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont } from '../utils/scaleUtils';
import { resolveBadges, resolveClubs } from '../services/profileIdentityCatalog';

/**
 * @param {object} props
 * @param {string[]|undefined} props.clubIds
 * @param {string[]|undefined} props.badgeIds
 * @param {object} [props.style]
 */
export default function ProfileIdentityFlair({ clubIds, badgeIds, style }) {
  const clubs = useMemo(() => resolveClubs(clubIds), [clubIds]);
  const badges = useMemo(() => resolveBadges(badgeIds), [badgeIds]);

  if (!clubs.length && !badges.length) return null;

  return (
    <View style={[styles.wrap, style]} accessibilityLabel="Clubs and badges">
      {clubs.length > 0 ? (
        <View style={styles.row}>
          {clubs.map((c) => (
            <View key={c.id} style={[styles.chip, styles.clubChip]}>
              <Icon name={c.icon} size={11} color={COLORS.accent || '#00D2BE'} />
              <Text style={styles.clubText} numberOfLines={1}>
                {c.shortLabel || c.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {badges.length > 0 ? (
        <View style={styles.row}>
          {badges.map((b) => (
            <View key={b.id} style={[styles.chip, styles.badgeChip]}>
              <Icon name={b.icon} size={11} color="#A78BFA" />
              <Text style={styles.badgeText} numberOfLines={1}>
                {b.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
    marginTop: 2,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
  clubChip: {
    backgroundColor: 'rgba(0, 210, 190, 0.10)',
    borderColor: 'rgba(0, 210, 190, 0.32)',
  },
  badgeChip: {
    backgroundColor: 'rgba(167, 139, 250, 0.10)',
    borderColor: 'rgba(167, 139, 250, 0.28)',
  },
  clubText: {
    color: COLORS.textPrimary || '#F8FAFC',
    fontSize: responsiveFont(11),
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  badgeText: {
    color: '#EDE9FE',
    fontSize: responsiveFont(11),
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
