// StageDeskChrome.js — compact on-stream host chrome for pinned Stage Desk modules.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../../styles/theme';
import { responsiveFont } from '../../../utils/scaleUtils';
import {
  getChromeWidgets,
  getCatalogEntry,
  getTheme,
} from '../../../services/liveDashboardService';

/**
 * Renders a slim host-only rail for chrome-surface widgets (goal, top gifters, stats).
 * Does not cover gift cinema / chat overlays — sits above the host control row.
 */
export default function StageDeskChrome({
  layout,
  isPro = false,
  viewCount = 0,
  heartCount = 0,
  giftTotalsByUser = {},
  publicLabelsByUser = {},
  topInset = 0,
}) {
  const chrome = useMemo(
    () => getChromeWidgets(layout, { isPro }),
    [layout, isPro]
  );
  const theme = getTheme(layout?.themeId);
  const accent = theme?.accent || COLORS.primary;

  const topGifters = useMemo(() => {
    return Object.entries(giftTotalsByUser || {})
      .map(([userId, total]) => ({ userId, total: Number(total) || 0 }))
      .filter((e) => e.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
  }, [giftTotalsByUser]);

  const giftSum = useMemo(
    () => topGifters.reduce((s, g) => s + g.total, 0),
    [topGifters]
  );

  if (!chrome.length) return null;

  return (
    <View style={[styles.rail, { top: topInset }]} pointerEvents="none">
      {chrome.map((widget) => {
        const meta = getCatalogEntry(widget.type);
        if (!meta) return null;
        const cfg = widget.config || {};

        if (widget.type === 'sessionStats') {
          return (
            <View key={widget.id} style={styles.pill}>
              <Text style={styles.pillText}>
                {viewCount} viewers · {heartCount} hearts · {giftSum} gifts
              </Text>
            </View>
          );
        }

        if (widget.type === 'goalBar') {
          const target = Number(cfg.target) || 500;
          const pct = Math.min(100, Math.round((giftSum / target) * 100));
          return (
            <View key={widget.id} style={styles.goalCard}>
              <View style={styles.goalHead}>
                <Text style={styles.goalLabel} numberOfLines={1}>
                  {cfg.label || 'Gift goal'}
                </Text>
                <Text style={[styles.goalPct, { color: accent }]}>{pct}%</Text>
              </View>
              <View style={styles.goalTrack}>
                <View style={[styles.goalFill, { width: `${pct}%`, backgroundColor: accent }]} />
              </View>
            </View>
          );
        }

        if (widget.type === 'topGifters' && topGifters.length > 0) {
          return (
            <View key={widget.id} style={styles.pill}>
              <Text style={styles.pillText} numberOfLines={1}>
                Top · {topGifters.map((g) => `${publicLabelsByUser[g.userId] || 'Supporter'} ${g.total}`).join(' · ')}
              </Text>
            </View>
          );
        }

        // giftAlerts / comboTicker are driven by LiveGiftOverlay cinema — do not
        // paint placeholder accent dots on the chrome rail (they read as stray
        // cyan dashes on the left of the host live stage).
        if (widget.type === 'giftAlerts' || widget.type === 'comboTicker') {
          return null;
        }

        return null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 20,
    gap: 6,
    alignItems: 'flex-start',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    maxWidth: '92%',
  },
  pillText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: responsiveFont(11),
    fontWeight: '700',
  },
  goalCard: {
    width: '72%',
    maxWidth: 280,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(10,10,12,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  goalHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  goalLabel: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(11),
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  goalPct: {
    fontSize: responsiveFont(11),
    fontWeight: '800',
  },
  goalTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  goalFill: { height: '100%', borderRadius: 3 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.85,
  },
});
