// SportPagesWidget.js — only real pages the user has. No decorative catalog junk.

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont } from '../../utils/scaleUtils';
import {
  INTEREST_CATALOG,
  SPORT_PAGE_IDS,
  TOPIC_PREFIX,
  isTopicPageKey,
  topicIdFromKey,
} from '../../services/userPreferencesService';

const ACCENTS = {
  football: '#22C55E',
  f1: '#E10600',
  sport: '#34D399',
  gaming: '#A78BFA',
  music: '#F472B6',
  default: COLORS.primary,
};

function accentFor(id) {
  return ACCENTS[id] || ACCENTS.default;
}

const SportPagesWidget = ({
  pages = [],
  interests = [],
  config = {},
  editMode = false,
  onOpenPage,
  onTogglePageKey,
}) => {
  const byId = useMemo(() => new Map(INTEREST_CATALOG.map((i) => [i.id, i])), []);

  // Real topic pages the user actually has enabled — never invent from interests.
  const realTopicPages = useMemo(() => {
    return (pages || []).filter((p) => isTopicPageKey(p?.key) && p.enabled !== false);
  }, [pages]);

  const configuredKeys = Array.isArray(config.pageKeys) ? config.pageKeys : [];

  const cards = useMemo(() => {
    const realByKey = new Map(realTopicPages.map((p) => [p.key, p]));
    // Only show pages the user explicitly pinned in this widget config.
    // Never invent Football/F1 tiles from interests alone — that reads as junk.
    const keys = configuredKeys.filter((k) => realByKey.has(k)).slice(0, 8);
    return keys
      .map((key) => {
        const page = realByKey.get(key);
        if (!page) return null;
        const id = topicIdFromKey(key);
        const interest = byId.get(id);
        return {
          key,
          id,
          label: page.label || interest?.label || id,
          icon: interest?.icon || 'apps-outline',
          accent: accentFor(id),
          isSport: SPORT_PAGE_IDS.includes(id),
        };
      })
      .filter(Boolean);
  }, [configuredKeys, realTopicPages, byId]);

  const availableToPin = useMemo(() => {
    if (!editMode) return [];
    const pinned = new Set(configuredKeys.length ? configuredKeys : cards.map((c) => c.key));
    // Offer interests the user follows that aren't pinned yet — only in edit mode.
    const followSet = new Set(interests || []);
    return INTEREST_CATALOG.filter((i) => {
      const key = `${TOPIC_PREFIX}${i.id}`;
      if (pinned.has(key)) return false;
      // Prefer interests they already follow; fall back to full catalog if none.
      return followSet.size === 0 || followSet.has(i.id);
    }).slice(0, 12);
  }, [editMode, configuredKeys, cards, interests]);

  // Product rule: hide entirely when empty (no decorative Football/F1 placeholders).
  if (cards.length === 0 && !editMode) {
    return null;
  }

  if (cards.length === 0 && editMode) {
    return (
      <View>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Your pages</Text>
          <Text style={styles.hint}>Pin real pages</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {availableToPin.map((i) => (
            <TouchableOpacity
              key={`add_${i.id}`}
              style={styles.addCard}
              activeOpacity={0.88}
              onPress={() => onTogglePageKey?.(`${TOPIC_PREFIX}${i.id}`, true)}
            >
              <View style={styles.addOrb}>
                <Icon name="add" size={22} color={COLORS.primary} />
              </View>
              <Text style={styles.addLabel} numberOfLines={2}>
                {i.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Your pages</Text>
        {!editMode && <Text style={styles.hint}>Tap to open</Text>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {cards.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.card, { borderColor: `${c.accent}55` }]}
            activeOpacity={0.88}
            onPress={() => {
              if (editMode) {
                onTogglePageKey?.(c.key, false);
                return;
              }
              onOpenPage?.(c.key);
            }}
          >
            <View style={[styles.iconOrb, { backgroundColor: `${c.accent}22` }]}>
              <Icon name={c.icon} size={22} color={c.accent} />
            </View>
            <Text style={styles.cardLabel} numberOfLines={2}>
              {c.label}
            </Text>
            {c.isSport ? (
              <View style={[styles.sportPill, { backgroundColor: `${c.accent}22` }]}>
                <Text style={[styles.sportPillText, { color: c.accent }]}>Sport</Text>
              </View>
            ) : (
              <Text style={styles.cardHint}>Open</Text>
            )}
            {editMode && (
              <View style={styles.removeBadge}>
                <Icon name="remove-circle" size={18} color="#FF8A80" />
              </View>
            )}
          </TouchableOpacity>
        ))}
        {editMode &&
          availableToPin.map((i) => (
            <TouchableOpacity
              key={`add_${i.id}`}
              style={styles.addCard}
              activeOpacity={0.88}
              onPress={() => onTogglePageKey?.(`${TOPIC_PREFIX}${i.id}`, true)}
            >
              <View style={styles.addOrb}>
                <Icon name="add" size={22} color={COLORS.primary} />
              </View>
              <Text style={styles.addLabel} numberOfLines={2}>
                {i.label}
              </Text>
            </TouchableOpacity>
          ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 10,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(18),
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  hint: { color: COLORS.textMuted, fontSize: responsiveFont(12), fontWeight: '600' },
  row: { paddingRight: 8, gap: 12 },
  card: {
    width: 118,
    minHeight: 132,
    borderRadius: 18,
    padding: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    justifyContent: 'space-between',
  },
  iconOrb: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(14),
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 12,
  },
  cardHint: { color: COLORS.textMuted, fontSize: responsiveFont(11), fontWeight: '600', marginTop: 6 },
  sportPill: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  sportPillText: { fontSize: responsiveFont(10), fontWeight: '800', letterSpacing: 0.2 },
  removeBadge: { position: 'absolute', top: 8, right: 8 },
  addCard: {
    width: 118,
    minHeight: 132,
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(0,210,190,0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,210,190,0.35)',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  addOrb: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(0,210,190,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: {
    color: COLORS.primary,
    fontSize: responsiveFont(13),
    fontWeight: '700',
    textAlign: 'center',
  },
});

export default SportPagesWidget;
