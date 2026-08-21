// StageDeskModuleBodies.js — interactive bodies for Stage Desk modules.

import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../../Icon';
import { COLORS } from '../../../styles/theme';
import { responsiveFont } from '../../../utils/scaleUtils';
import {
  ALERT_THEMES,
  getCatalogEntry,
  getTheme,
} from '../../../services/liveDashboardService';
import { LIVE_LAYOUT_OPTIONS } from '../../../live/ivs/multiGuestLayout';

function ModuleCard({ children, accent }) {
  return (
    <View style={[styles.card, accent ? { borderColor: `${accent}55` } : null]}>
      {children}
    </View>
  );
}

function ActionChip({ icon, label, onPress, active, accent }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && { borderColor: accent || COLORS.primary, backgroundColor: 'rgba(255,45,85,0.12)' }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {icon ? <Icon name={icon} size={14} color={active ? (accent || COLORS.primary) : COLORS.textSecondary} /> : null}
      <Text style={[styles.chipText, active && { color: accent || COLORS.primary }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function StageDeskModuleBody({
  widget,
  themeId,
  isStreaming,
  viewCount = 0,
  heartCount = 0,
  giftTotalsByUser = {},
  publicLabelsByUser = {},
  guestLayoutMode,
  micOn = true,
  cameraOn = true,
  marbleEnabled = false,
  battleActive = false,
  actions = {},
}) {
  const meta = getCatalogEntry(widget?.type);
  const theme = getTheme(widget?.config?.themeId || themeId);
  const accent = theme?.accent || COLORS.primary;

  const topGifters = useMemo(() => {
    const entries = Object.entries(giftTotalsByUser || {})
      .map(([userId, total]) => ({ userId, total: Number(total) || 0 }))
      .filter((e) => e.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    return entries;
  }, [giftTotalsByUser]);

  const giftSum = useMemo(
    () => topGifters.reduce((sum, g) => sum + g.total, 0),
    [topGifters]
  );

  if (!meta) return null;
  const cfg = widget?.config || {};

  switch (widget.type) {
    case 'sessionStats':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Session pulse</Text>
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Icon name="eye" size={16} color={accent} />
              <Text style={styles.statVal}>{viewCount}</Text>
              <Text style={styles.statLbl}>Viewers</Text>
            </View>
            <View style={styles.stat}>
              <Icon name="heart" size={16} color="#FB7185" />
              <Text style={styles.statVal}>{heartCount}</Text>
              <Text style={styles.statLbl}>Hearts</Text>
            </View>
            <View style={styles.stat}>
              <Icon name="gift" size={16} color={accent} />
              <Text style={styles.statVal}>{giftSum}</Text>
              <Text style={styles.statLbl}>Gifts</Text>
            </View>
          </View>
        </ModuleCard>
      );

    case 'giftAlerts':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Gift alerts</Text>
          <Text style={styles.cardBlurb}>
            Cinema + toast overlays stay live. Theme: {theme.label}.
          </Text>
          <View style={styles.chipRow}>
            {ALERT_THEMES.map((t) => (
              <ActionChip
                key={t.id}
                label={t.label}
                active={(cfg.themeId || themeId) === t.id}
                accent={t.accent}
                onPress={() => actions.onSetWidgetTheme?.(widget.id, t.id)}
              />
            ))}
          </View>
        </ModuleCard>
      );

    case 'comboTicker':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Combo ticker</Text>
          <Text style={styles.cardBlurb}>
            Chain streaks show on chrome when gifters spam gifts.
          </Text>
        </ModuleCard>
      );

    case 'goalBar': {
      const target = Number(cfg.target) || 500;
      const progress = Math.min(1, giftSum / target);
      return (
        <ModuleCard accent={accent}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{cfg.label || 'Gift goal'}</Text>
            <Text style={[styles.goalFrac, { color: accent }]}>
              {giftSum}/{target}
            </Text>
          </View>
          <View style={styles.goalTrack}>
            <View style={[styles.goalFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: accent }]} />
          </View>
          <View style={styles.chipRow}>
            {[250, 500, 1000, 2500].map((n) => (
              <ActionChip
                key={n}
                label={`${n}`}
                active={target === n}
                accent={accent}
                onPress={() => actions.onSetGoalTarget?.(widget.id, n)}
              />
            ))}
          </View>
        </ModuleCard>
      );
    }

    case 'topGifters':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Top gifters</Text>
          {topGifters.length === 0 ? (
            <Text style={styles.cardBlurb}>No gifts yet this stream.</Text>
          ) : (
            topGifters.map((g, i) => (
              <View key={g.userId} style={styles.gifterRow}>
                <Text style={[styles.gifterRank, { color: accent }]}>#{i + 1}</Text>
                <Text style={styles.gifterId} numberOfLines={1}>
                  {publicLabelsByUser[g.userId] || 'Supporter'}
                </Text>
                <Text style={styles.gifterTotal}>{g.total}</Text>
              </View>
            ))
          )}
        </ModuleCard>
      );

    case 'chatHighlight':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Chat highlight</Text>
          <Text style={styles.cardBlurb}>Open chat to pin standout messages for yourself.</Text>
          <ActionChip icon="chatbubble" label="Open chat" accent={accent} onPress={actions.onOpenChat} />
        </ModuleCard>
      );

    case 'quickReplies':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Quick replies</Text>
          <View style={styles.chipRow}>
            {(cfg.replies || []).map((r) => (
              <ActionChip
                key={r}
                label={r}
                accent={accent}
                onPress={() => actions.onSendComment?.(r)}
              />
            ))}
          </View>
        </ModuleCard>
      );

    case 'guestInvites':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Guest invites</Text>
          <Text style={styles.cardBlurb}>Pull followers onto sticky stage slots.</Text>
          <ActionChip icon="person-add" label="Invite guests" accent={accent} onPress={actions.onInviteGuests} />
        </ModuleCard>
      );

    case 'battleControls':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Battle controls</Text>
          <Text style={styles.cardBlurb}>
            {battleActive
              ? 'Battle is live — manage from guest sheet or overlay.'
              : 'Challenge a guest from the guest control sheet.'}
          </Text>
          <ActionChip
            icon="people"
            label="Guest sheet"
            accent={accent}
            onPress={actions.onOpenGuestSheet}
          />
        </ModuleCard>
      );

    case 'layoutPicker':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Stage layout</Text>
          <View style={styles.chipRow}>
            {LIVE_LAYOUT_OPTIONS.map((opt) => (
              <ActionChip
                key={opt.id}
                icon={opt.icon}
                label={opt.label}
                active={guestLayoutMode === opt.id}
                accent={accent}
                onPress={() => actions.onSetLayout?.(opt.id)}
              />
            ))}
          </View>
        </ModuleCard>
      );

    case 'mediaControls':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Mic & camera</Text>
          <View style={styles.chipRow}>
            <ActionChip
              icon={micOn ? 'mic' : 'mic-off'}
              label={micOn ? 'Mute' : 'Unmute'}
              accent={accent}
              onPress={actions.onToggleMic}
            />
            <ActionChip
              icon="camera-reverse"
              label="Flip"
              accent={accent}
              onPress={actions.onFlipCamera}
            />
            <ActionChip
              icon={cameraOn ? 'videocam' : 'videocam-off'}
              label={cameraOn ? 'Cam off' : 'Cam on'}
              accent={accent}
              onPress={actions.onToggleCamera}
            />
          </View>
        </ModuleCard>
      );

    case 'sharePromote':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Share & promote</Text>
          <View style={styles.chipRow}>
            <ActionChip icon="share-social" label="Share live" accent={accent} onPress={actions.onShare} />
          </View>
        </ModuleCard>
      );

    case 'marbleRace':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Marble Race</Text>
          <Text style={styles.cardBlurb}>
            {marbleEnabled
              ? isStreaming
                ? 'Open Games to launch Guest Grand Prix.'
                : 'Available once you go live.'
              : 'Marble Race is off for this build.'}
          </Text>
          {marbleEnabled && isStreaming ? (
            <ActionChip icon="game-controller" label="Open games" accent={accent} onPress={actions.onOpenGames} />
          ) : null}
        </ModuleCard>
      );

    case 'teamShoutouts':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Team shoutouts</Text>
          <View style={styles.chipRow}>
            {(cfg.lines || []).map((line) => (
              <ActionChip
                key={line}
                label={line}
                accent={accent}
                onPress={() => actions.onSendComment?.(line)}
              />
            ))}
          </View>
        </ModuleCard>
      );

    case 'subscriberBadges':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Subscriber badges</Text>
          <Text style={styles.cardBlurb}>
            Plus / sub viewers get badge chrome when entitlement data is present.
          </Text>
        </ModuleCard>
      );

    case 'soundAlerts':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Sound alerts</Text>
          <Text style={styles.cardBlurb}>
            Device-side cues on gifts. {cfg.enabled === false ? 'Currently muted.' : 'Armed.'}
          </Text>
          <ActionChip
            icon={cfg.enabled === false ? 'volume-mute' : 'volume-high'}
            label={cfg.enabled === false ? 'Enable sounds' : 'Mute sounds'}
            accent={accent}
            onPress={() => actions.onToggleSound?.(widget.id, cfg.enabled === false)}
          />
        </ModuleCard>
      );

    case 'alertTheme':
      return (
        <ModuleCard accent={accent}>
          <Text style={styles.cardTitle}>Alert theme</Text>
          <View style={styles.chipRow}>
            {ALERT_THEMES.map((t) => (
              <ActionChip
                key={t.id}
                label={t.label}
                active={themeId === t.id}
                accent={t.accent}
                onPress={() => actions.onSetTheme?.(t.id)}
              />
            ))}
          </View>
        </ModuleCard>
      );

    default:
      return (
        <ModuleCard>
          <Text style={styles.cardTitle}>{meta.title}</Text>
          <Text style={styles.cardBlurb}>{meta.blurb}</Text>
        </ModuleCard>
      );
  }
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(18,18,22,0.92)',
    padding: 12,
  },
  cardTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(14),
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  cardBlurb: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(12),
    lineHeight: 16,
    marginBottom: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  stat: { alignItems: 'center', flex: 1, gap: 2 },
  statVal: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(16),
    fontWeight: '800',
  },
  statLbl: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    fontWeight: '600',
  },
  goalTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  goalFill: {
    height: '100%',
    borderRadius: 4,
  },
  goalFrac: {
    fontSize: responsiveFont(12),
    fontWeight: '800',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    maxWidth: '100%',
  },
  chipText: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(11),
    fontWeight: '700',
    maxWidth: 160,
  },
  gifterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  gifterRank: { fontWeight: '800', width: 28, fontSize: responsiveFont(12) },
  gifterId: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(12) },
  gifterTotal: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(12) },
});

export default StageDeskModuleBody;
