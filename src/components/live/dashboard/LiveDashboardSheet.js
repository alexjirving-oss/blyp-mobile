// LiveDashboardSheet.js — Stage Desk host control surface (in-app, mobile-first).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Icon from '../../Icon';
import { COLORS } from '../../../styles/theme';
import { responsiveFont } from '../../../utils/scaleUtils';
import { useHasAI } from '../../../hooks/useEntitlement';
import {
  STAGE_DESK_NAME,
  ALERT_THEMES,
  FREE_SLOT_LIMIT,
  PRO_SLOT_LIMIT,
  getCatalogEntry,
  getEnabledWidgets,
  getSlotLimit,
  getTheme,
  listAddableWidgets,
  listLockedProWidgets,
  resolveStageDeskPro,
  subscribeLiveDashboard,
  getLiveDashboard,
  reorderLiveDashboardWidget,
  setLiveDashboardWidgetEnabled,
  removeLiveDashboardWidget,
  addLiveDashboardWidget,
  updateLiveDashboardWidgetConfig,
  setLiveDashboardTheme,
  resetLiveDashboard,
} from '../../../services/liveDashboardService';
import StageDeskWidgetFrame from './StageDeskWidgetFrame';
import StageDeskModuleBody from './StageDeskModuleBodies';

export default function LiveDashboardSheet({
  visible,
  onClose,
  uid,
  isStreaming = false,
  viewCount = 0,
  heartCount = 0,
  giftTotalsByUser = {},
  publicLabelsByUser = {},
  guestLayoutMode,
  micOn = true,
  cameraOn = true,
  marbleEnabled = false,
  battleActive = false,
  onSetLayout,
  onToggleMic,
  onFlipCamera,
  onToggleCamera,
  onOpenChat,
  onInviteGuests,
  onOpenGuestSheet,
  onShare,
  onOpenGames,
  onSendComment,
  onNavigatePlans,
}) {
  const entitled = useHasAI();
  const isPro = resolveStageDeskPro({ entitled: !!entitled });
  const { height: winH, width: winW } = useWindowDimensions();
  const foldWide = winW >= 600;

  const [layout, setLayout] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    if (!visible || !uid) return undefined;
    let alive = true;
    getLiveDashboard(uid).then((d) => {
      if (alive) setLayout(d);
    });
    const unsub = subscribeLiveDashboard(uid, (d) => {
      if (alive) setLayout(d);
    });
    return () => {
      alive = false;
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [visible, uid]);

  const theme = getTheme(layout?.themeId);
  const enabledCount = getEnabledWidgets(layout, { isPro }).length;
  const slotLimit = getSlotLimit(isPro);
  const addable = useMemo(() => listAddableWidgets(layout, { isPro }), [layout, isPro]);
  const lockedPro = useMemo(() => (!isPro ? listLockedProWidgets(layout) : []), [layout, isPro]);

  const widgets = layout?.widgets || [];

  const actions = useMemo(
    () => ({
      onSetLayout,
      onToggleMic,
      onFlipCamera,
      onToggleCamera,
      onOpenChat,
      onInviteGuests,
      onOpenGuestSheet,
      onShare,
      onOpenGames,
      onSendComment,
      onSetTheme: async (themeId) => {
        if (!uid) return;
        const next = await setLiveDashboardTheme(uid, themeId);
        setLayout(next);
      },
      onSetWidgetTheme: async (widgetId, themeId) => {
        if (!uid) return;
        const next = await updateLiveDashboardWidgetConfig(uid, widgetId, { themeId });
        setLayout(next);
      },
      onSetGoalTarget: async (widgetId, target) => {
        if (!uid) return;
        const next = await updateLiveDashboardWidgetConfig(uid, widgetId, { target });
        setLayout(next);
      },
      onToggleSound: async (widgetId, enabled) => {
        if (!uid) return;
        const next = await updateLiveDashboardWidgetConfig(uid, widgetId, { enabled });
        setLayout(next);
      },
    }),
    [
      uid,
      onSetLayout,
      onToggleMic,
      onFlipCamera,
      onToggleCamera,
      onOpenChat,
      onInviteGuests,
      onOpenGuestSheet,
      onShare,
      onOpenGames,
      onSendComment,
    ]
  );

  const onMove = useCallback(
    async (widgetId, direction) => {
      if (!uid) return;
      const next = await reorderLiveDashboardWidget(uid, widgetId, direction);
      setLayout(next);
    },
    [uid]
  );

  const onToggle = useCallback(
    async (widget) => {
      if (!uid) return;
      const next = await setLiveDashboardWidgetEnabled(uid, widget.id, widget.enabled === false);
      setLayout(next);
    },
    [uid]
  );

  const onRemove = useCallback(
    async (widgetId) => {
      if (!uid) return;
      const next = await removeLiveDashboardWidget(uid, widgetId);
      setLayout(next);
    },
    [uid]
  );

  const onAdd = useCallback(
    async (type) => {
      if (!uid) return;
      if (enabledCount >= slotLimit && getCatalogEntry(type)) {
        // Still allow adding disabled; pin count is enforced on enable/chrome.
      }
      const next = await addLiveDashboardWidget(uid, type, undefined, { isPro });
      setLayout(next);
      setCatalogOpen(false);
    },
    [uid, isPro, enabledCount, slotLimit]
  );

  const onReset = useCallback(async () => {
    if (!uid) return;
    const next = await resetLiveDashboard(uid);
    setLayout(next);
    setCatalogOpen(false);
  }, [uid]);

  const sheetMaxH = Math.min(winH * 0.88, foldWide ? winH * 0.78 : winH * 0.88);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: sheetMaxH }, foldWide && styles.sheetWide]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <View style={styles.brandRow}>
                <View style={[styles.brandDot, { backgroundColor: theme.accent }]} />
                <Text style={styles.brand}>{STAGE_DESK_NAME}</Text>
                {isPro ? (
                  <View style={styles.plusBadge}>
                    <Text style={styles.plusBadgeText}>Plus</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.sub}>
                Pin your live chrome — {enabledCount}/{slotLimit} active
                {isStreaming ? ' · live' : ' · pre-live'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.toolbar}>
            <TouchableOpacity
              style={[styles.toolBtn, editMode && styles.toolBtnActive]}
              onPress={() => setEditMode((v) => !v)}
              activeOpacity={0.85}
            >
              <Icon name="options-outline" size={16} color={editMode ? COLORS.black : COLORS.textPrimary} />
              <Text style={[styles.toolBtnText, editMode && styles.toolBtnTextActive]}>
                {editMode ? 'Done' : 'Edit'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={() => setCatalogOpen((v) => !v)}
              activeOpacity={0.85}
            >
              <Icon name="add" size={16} color={COLORS.textPrimary} />
              <Text style={styles.toolBtnText}>Add</Text>
            </TouchableOpacity>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.themeRow}>
              {ALERT_THEMES.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    styles.themeSwatch,
                    { backgroundColor: t.accent },
                    layout?.themeId === t.id && styles.themeSwatchActive,
                  ]}
                  onPress={() => actions.onSetTheme?.(t.id)}
                  accessibilityLabel={`Theme ${t.label}`}
                />
              ))}
            </ScrollView>
          </View>

          {!isPro ? (
            <TouchableOpacity
              style={styles.upsell}
              activeOpacity={0.88}
              onPress={onNavigatePlans}
            >
              <Icon name="sparkles" size={16} color={COLORS.primary} />
              <Text style={styles.upsellText}>
                Unlock Plus modules — sound alerts, marble race, shoutouts, more slots ({PRO_SLOT_LIMIT}).
              </Text>
              <Icon name="chevron-forward" size={16} color={COLORS.primary} />
            </TouchableOpacity>
          ) : null}

          {catalogOpen ? (
            <View style={styles.catalog}>
              <Text style={styles.section}>Catalog</Text>
              {addable.length === 0 && lockedPro.length === 0 ? (
                <Text style={styles.emptyCat}>All modules are on your desk.</Text>
              ) : null}
              {addable.map((w) => (
                <TouchableOpacity
                  key={w.type}
                  style={styles.catRow}
                  activeOpacity={0.88}
                  onPress={() => onAdd(w.type)}
                >
                  <View style={styles.catIcon}>
                    <Icon name={w.icon} size={18} color={COLORS.primary} />
                  </View>
                  <View style={styles.catBody}>
                    <Text style={styles.catTitle}>{w.title}</Text>
                    <Text style={styles.catBlurb} numberOfLines={2}>
                      {w.blurb}
                    </Text>
                  </View>
                  <Icon name="add-circle" size={22} color={COLORS.primary} />
                </TouchableOpacity>
              ))}
              {lockedPro.map((w) => (
                <TouchableOpacity
                  key={w.type}
                  style={[styles.catRow, styles.catRowLocked]}
                  activeOpacity={0.88}
                  onPress={onNavigatePlans}
                >
                  <View style={[styles.catIcon, styles.catIconMuted]}>
                    <Icon name={w.icon} size={18} color={COLORS.textMuted} />
                  </View>
                  <View style={styles.catBody}>
                    <View style={styles.catTitleRow}>
                      <Text style={styles.catTitleMuted}>{w.title}</Text>
                      <View style={styles.plusBadge}>
                        <Text style={styles.plusBadgeText}>Plus</Text>
                      </View>
                    </View>
                    <Text style={styles.catBlurb} numberOfLines={2}>
                      {w.blurb}
                    </Text>
                  </View>
                  <Icon name="lock-closed" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.resetBtn} onPress={onReset} activeOpacity={0.85}>
                <Icon name="refresh-outline" size={14} color={COLORS.textSecondary} />
                <Text style={styles.resetText}>Reset Stage Desk</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.scroll,
              foldWide && styles.scrollWide,
            ]}
          >
            <View style={foldWide ? styles.gridWide : null}>
              {widgets.map((widget, index) => {
                const meta = getCatalogEntry(widget.type);
                if (!meta) return null;
                if (meta.tier === 'pro' && !isPro && !editMode) return null;
                return (
                  <View
                    key={widget.id}
                    style={foldWide ? styles.gridItem : null}
                  >
                    <StageDeskWidgetFrame
                      widget={widget}
                      editMode={editMode}
                      canMoveUp={index > 0}
                      canMoveDown={index < widgets.length - 1}
                      onMoveUp={() => onMove(widget.id, -1)}
                      onMoveDown={() => onMove(widget.id, 1)}
                      onToggle={() => onToggle(widget)}
                      onRemove={() => onRemove(widget.id)}
                    >
                      <StageDeskModuleBody
                        widget={widget}
                        themeId={layout?.themeId}
                        isStreaming={isStreaming}
                        viewCount={viewCount}
                        heartCount={heartCount}
                        giftTotalsByUser={giftTotalsByUser}
                        publicLabelsByUser={publicLabelsByUser}
                        guestLayoutMode={guestLayoutMode}
                        micOn={micOn}
                        cameraOn={cameraOn}
                        marbleEnabled={marbleEnabled}
                        battleActive={battleActive}
                        actions={actions}
                      />
                    </StageDeskWidgetFrame>
                  </View>
                );
              })}
            </View>

            {editMode ? (
              <Text style={styles.editHint}>
                Free hosts: {FREE_SLOT_LIMIT} active slots. Plus: {PRO_SLOT_LIMIT}. Reorder, hide, or remove modules for this stream.
              </Text>
            ) : null}
            <View style={{ height: 36 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: '#0E0E12',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,45,85,0.22)',
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  sheetWide: {
    alignSelf: 'center',
    width: '92%',
    maxWidth: 720,
    borderRadius: 24,
    marginBottom: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerTitles: { flex: 1, paddingRight: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandDot: { width: 8, height: 8, borderRadius: 4 },
  brand: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(22),
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  plusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255,45,85,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,45,85,0.4)',
  },
  plusBadgeText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '800',
  },
  sub: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(12),
    marginTop: 4,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  toolBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  toolBtnText: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(12),
    fontWeight: '800',
  },
  toolBtnTextActive: { color: COLORS.black },
  themeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4 },
  themeSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeSwatchActive: {
    borderColor: '#fff',
  },
  upsell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,45,85,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,45,85,0.28)',
    marginBottom: 10,
  },
  upsellText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: responsiveFont(12),
    lineHeight: 16,
  },
  catalog: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: 220,
  },
  section: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(11),
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  emptyCat: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginBottom: 8 },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  catRowLocked: { opacity: 0.75 },
  catIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,45,85,0.1)',
  },
  catIconMuted: { backgroundColor: 'rgba(255,255,255,0.05)' },
  catBody: { flex: 1, minWidth: 0 },
  catTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  catTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    fontWeight: '800',
  },
  catTitleMuted: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(13),
    fontWeight: '800',
  },
  catBlurb: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(11),
    marginTop: 2,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
  },
  resetText: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '600' },
  scroll: { paddingBottom: 8 },
  scrollWide: { paddingHorizontal: 4 },
  gridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  gridItem: {
    width: '50%',
    paddingHorizontal: 4,
  },
  editHint: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(11),
    lineHeight: 15,
    marginTop: 4,
    paddingHorizontal: 4,
  },
});
