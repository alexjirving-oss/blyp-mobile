// HomeWidgetFrame.js — edit-mode chrome around each home widget.

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont } from '../../utils/scaleUtils';
import { CORE_HOME_WIDGET_TYPES, getCatalogEntry } from '../../services/homeLayoutService';

const HomeWidgetFrame = ({
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
  const title = meta?.title || widget?.type || 'Widget';
  const disabled = widget?.enabled === false;
  const canRemove = !CORE_HOME_WIDGET_TYPES.has(widget?.type);

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
          {canRemove ? (
            <TouchableOpacity
              style={[styles.iconBtn, styles.removeBtn]}
              onPress={onRemove}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="close" size={16} color="#FF8A80" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      <View style={[styles.editBody, disabled && styles.editBodyOff]} pointerEvents={disabled ? 'none' : 'auto'}>
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  plain: { marginBottom: 2 },
  editWrap: {
    marginTop: 10,
    marginBottom: 6,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(0,210,190,0.35)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(0,210,190,0.04)',
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  editTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  dragHint: {
    width: 28,
    height: 28,
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
  editActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  iconBtnDisabled: { opacity: 0.35 },
  removeBtn: { backgroundColor: 'rgba(251,113,133,0.12)' },
  editBody: { paddingBottom: 8, paddingTop: 4 },
  editBodyOff: { opacity: 0.45 },
});

export default HomeWidgetFrame;
