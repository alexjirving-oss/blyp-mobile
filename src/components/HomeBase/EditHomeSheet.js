// EditHomeSheet.js — add widgets + reset layout.

import React, { useMemo } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont } from '../../utils/scaleUtils';
import { WIDGET_CATALOG, listAddableWidgets, getCatalogEntry } from '../../services/homeLayoutService';

const EditHomeSheet = ({
  visible,
  layout,
  onClose,
  onAdd,
  onReset,
}) => {
  const addable = useMemo(() => listAddableWidgets(layout), [layout]);
  const present = useMemo(
    () => (layout?.widgets || []).map((w) => getCatalogEntry(w.type)).filter(Boolean),
    [layout]
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Add to Home</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.sub}>
            Build your Blyp home — pin pages, messages, live, and more. Reorder with the arrows on each block.
          </Text>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {addable.length > 0 ? (
              <>
                <Text style={styles.section}>Available</Text>
                {addable.map((w) => (
                  <TouchableOpacity
                    key={w.type}
                    style={styles.row}
                    activeOpacity={0.88}
                    onPress={() => onAdd?.(w.type)}
                  >
                    <View style={styles.iconOrb}>
                      <Icon name={w.icon} size={18} color={COLORS.primary} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{w.title}</Text>
                      <Text style={styles.rowBlurb} numberOfLines={2}>
                        {w.blurb}
                      </Text>
                    </View>
                    <View style={styles.addPill}>
                      <Icon name="add" size={16} color={COLORS.black} />
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            ) : (
              <View style={styles.full}>
                <Icon name="checkmark-circle" size={28} color={COLORS.primary} />
                <Text style={styles.fullTitle}>Home is fully stocked</Text>
                <Text style={styles.fullSub}>
                  Remove a widget first if you want to swap something in. You have {WIDGET_CATALOG.length} module types.
                </Text>
              </View>
            )}

            {present.length > 0 && (
              <>
                <Text style={[styles.section, { marginTop: 22 }]}>On your Home</Text>
                {present.map((w) => (
                  <View key={w.type} style={[styles.row, styles.rowMuted]}>
                    <View style={[styles.iconOrb, styles.iconOrbMuted]}>
                      <Icon name={w.icon} size={18} color={COLORS.textMuted} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitleMuted}>{w.title}</Text>
                      <Text style={styles.rowBlurb} numberOfLines={1}>
                        {w.blurb}
                      </Text>
                    </View>
                    <Icon name="checkmark" size={16} color={COLORS.primary} />
                  </View>
                ))}
              </>
            )}

            <TouchableOpacity
              style={styles.resetBtn}
              activeOpacity={0.88}
              onPress={() => {
                Alert.alert(
                  'Reset Home layout?',
                  'This restores the default sections and removes anything you added.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Reset', style: 'destructive', onPress: () => onReset?.() },
                  ],
                );
              }}
            >
              <Icon name="refresh-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.resetText}>Reset to default layout</Text>
            </TouchableOpacity>
            <View style={{ height: 28 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  dismiss: { flex: 1 },
  sheet: {
    maxHeight: '78%',
    backgroundColor: COLORS.backgroundLight,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(20),
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  sub: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(13),
    lineHeight: 18,
    marginBottom: 14,
  },
  scroll: { paddingBottom: 12 },
  section: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(12),
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
  rowMuted: { opacity: 0.7 },
  iconOrb: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 45, 85,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOrbMuted: { backgroundColor: 'rgba(255,255,255,0.06)' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '800' },
  rowTitleMuted: { color: COLORS.textSecondary, fontSize: responsiveFont(15), fontWeight: '700' },
  rowBlurb: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 2 },
  addPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  full: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
    gap: 8,
  },
  fullTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '800' },
  fullSub: { color: COLORS.textMuted, fontSize: responsiveFont(13), textAlign: 'center', lineHeight: 18 },
  resetBtn: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resetText: { color: COLORS.textSecondary, fontSize: responsiveFont(13), fontWeight: '700' },
});

export default EditHomeSheet;
