// StageDeskWidgetFrame.js — edit-mode chrome around Stage Desk modules.

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../../Icon';
import { COLORS } from '../../../styles/theme';
import { responsiveFont } from '../../../utils/scaleUtils';
import { getCatalogEntry } from '../../../services/liveDashboardService';

const StageDeskWidgetFrame = ({
  widget,
  editMode,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  onToggle,
  children,
}) => {
  const meta = getCatalogEntry(widget?.type);
  const title = meta?.title || widget?.type || 'Module';
  const disabled = widget?.enabled === false;
  const isPro = meta?.tier === 'pro';

  if (!editMode) {
    if (disabled) return null;
    return <View style={styles.plain}>{children}</View>;
  }

  return (
    <View style={[styles.editWrap, disabled && styles.editWrapOff]}>
      <View style={styles.editHeader}>
        <View style={styles.editTitleRow}>
          <View style={styles.dragHint}>
            <Icon name="menu" size={16} color={COLORS.textMuted} />
          </View>
          <Text style={styles.editTitle} numberOfLines={1}>
            {title}
          </Text>
          {isPro ? (
            <View style={styles.proPill}>
              <Text style={styles.proPillText}>Plus</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.editActions}>
          <TouchableOpacity
            style={[styles.iconBtn, !canMoveUp && styles.iconBtnDisabled]}
            onPress={onMoveUp}
            disabled={!canMoveUp}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="chevron-up" size={18} color={canMoveUp ? COLORS.textPrimary : COLORS.textDisabled} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, !canMoveDown && styles.iconBtnDisabled]}
            onPress={onMoveDown}
            disabled={!canMoveDown}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="chevron-down" size={18} color={canMoveDown ? COLORS.textPrimary : COLORS.textDisabled} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={onToggle}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon
              name={disabled ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={disabled ? COLORS.textMuted : COLORS.primary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, styles.removeBtn]}
            onPress={onRemove}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="close" size={16} color="#FF8A80" />
          </TouchableOpacity>
        </View>
      </View>
      <View style={[styles.editBody, disabled && styles.editBodyOff]} pointerEvents={disabled ? 'none' : 'auto'}>
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  plain: { marginBottom: 8 },
  editWrap: {
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,45,85,0.35)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,45,85,0.05)',
    overflow: 'hidden',
  },
  editWrapOff: {
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    opacity: 0.72,
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  editTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  dragHint: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    fontWeight: '800',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  proPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255,45,85,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,45,85,0.4)',
  },
  proPillText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  iconBtnDisabled: { opacity: 0.35 },
  removeBtn: { backgroundColor: 'rgba(251,113,133,0.12)' },
  editBody: { paddingBottom: 8, paddingTop: 4, paddingHorizontal: 8 },
  editBodyOff: { opacity: 0.45 },
});

export default StageDeskWidgetFrame;
