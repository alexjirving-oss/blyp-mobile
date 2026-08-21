/**
 * Portrait Host+9 watch shell: header and footer stay in flow.
 * Video + 3×3 + chat/gift fit the measured window between them.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { HOST_TOP_9_PINK, measureHostTop9WatchLayout } from '../../live/ivs/multiGuestLayout';
import Icon from '../Icon';

export function formatWatchCount(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 10000) return `${Math.round(v / 1000)}K`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(v);
}

export function HostTop9DailyExploreRow({ top3 = [], onPressExplore }) {
  return (
    <View style={styles.subRow}>
      <View style={styles.dailyCard}>
        <Text style={styles.dailyTitle} allowFontScaling={false}>
          Daily Top 3
        </Text>
        {top3.map((row, i) => (
          <Text
            key={row.userId || `top-${i}`}
            style={[styles.dailyLine, row.empty && styles.dailyEmpty]}
            numberOfLines={1}
            allowFontScaling={false}
          >
            {i + 1}. {row.empty ? '—' : `${row.name}${row.coins ? ` · ${formatWatchCount(row.coins)}` : ''}`}
          </Text>
        ))}
      </View>
      <TouchableOpacity
        style={styles.exploreBtn}
        onPress={onPressExplore}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Explore"
      >
        <Icon name="compass-outline" size={16} color="#fff" />
        <Text style={styles.exploreText} allowFontScaling={false}>
          Explore
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export function HostTop9GiftRail({ gifts = [], onPressGift }) {
  const chips = (Array.isArray(gifts) ? gifts : []).slice(0, 6);
  return (
    <View style={styles.giftPanel}>
      <Text style={styles.giftTitle} allowFontScaling={false}>
        Send a gift
      </Text>
      {chips.length === 0 ? (
        <TouchableOpacity style={styles.giftEmpty} onPress={() => onPressGift()} activeOpacity={0.85}>
          <Text style={styles.giftEmptyText} allowFontScaling={false}>
            Open gifts
          </Text>
        </TouchableOpacity>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.giftChips}>
          {chips.map((g) => (
            <TouchableOpacity
              key={String(g.id || g.name)}
              style={styles.giftChip}
              onPress={() => onPressGift(g)}
              activeOpacity={0.85}
            >
              <Text style={styles.giftEmoji} allowFontScaling={false}>
                {g.emoji || '🎁'}
              </Text>
              <Text style={styles.giftCost} allowFontScaling={false}>
                {Number(g.cost || g.coinCost) || 0}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export default function HostTop9WatchChrome({
  topInset = 0,
  header,
  footer,
  stage,
  chat,
  giftRail,
  dailyTop3 = [],
  onPressExplore,
  expanded = false,
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const layout = useMemo(
    () => measureHostTop9WatchLayout(box.w, box.h, { expanded }),
    [box.w, box.h, expanded],
  );

  return (
    <View style={[styles.root, { paddingTop: topInset }]}>
      {header}
      <HostTop9DailyExploreRow top3={dailyTop3} onPressExplore={onPressExplore} />
      <View
        style={styles.content}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout || {};
          if (!(width > 0 && height > 0)) return;
          setBox((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
        }}
      >
        <View style={{ height: layout.hostH + layout.gridH }}>{stage(layout)}</View>
        {layout.chatH > 0 ? (
          <View style={[styles.chatGiftRow, { height: layout.chatH }]}>
            <View style={styles.chatCol}>{chat}</View>
            <View style={styles.giftCol}>{giftRail}</View>
          </View>
        ) : null}
      </View>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 10,
    paddingBottom: 6,
    gap: 8,
  },
  dailyCard: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(18,18,22,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,45,85,0.35)',
  },
  dailyTitle: {
    color: HOST_TOP_9_PINK,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  dailyLine: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 11,
    fontWeight: '700',
  },
  dailyEmpty: {
    color: 'rgba(255,255,255,0.38)',
    fontWeight: '600',
  },
  exploreBtn: {
    width: 76,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: HOST_TOP_9_PINK,
  },
  exploreText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  chatGiftRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 4,
    gap: 8,
  },
  chatCol: {
    flex: 1.15,
    minWidth: 0,
  },
  giftCol: {
    flex: 0.85,
    minWidth: 0,
  },
  giftPanel: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(18,18,22,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,45,85,0.4)',
  },
  giftTitle: {
    color: HOST_TOP_9_PINK,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  giftChips: {
    alignItems: 'center',
    gap: 6,
  },
  giftChip: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  giftEmoji: {
    fontSize: 18,
  },
  giftCost: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
  },
  giftEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  giftEmptyText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
});
