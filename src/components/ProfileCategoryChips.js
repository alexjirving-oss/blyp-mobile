import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from './Icon';
import { COLORS } from '../styles/theme';

/**
 * Horizontal category chips for a profile post grid.
 */
export default function ProfileCategoryChips({
  chips = [],
  selectedId = 'all',
  onSelect,
  onManage,
  showManage = false,
}) {
  const items = useMemo(() => (Array.isArray(chips) ? chips : []), [chips]);
  if (items.length <= 1 && !showManage) return null;

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {items.map((chip) => {
          const active = String(selectedId) === String(chip.id);
          return (
            <TouchableOpacity
              key={chip.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onSelect?.(chip.id)}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {chip.label}
                {typeof chip.count === 'number' ? ` · ${chip.count}` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
        {showManage ? (
          <TouchableOpacity style={styles.manageChip} onPress={onManage} activeOpacity={0.85}>
            <Icon name="settings" size={14} color={COLORS.primary} />
            <Text style={styles.manageText}>Manage</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 4,
    paddingBottom: 10,
  },
  row: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    maxWidth: 180,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#0A0A0C',
  },
  manageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.45)',
    backgroundColor: 'rgba(0,210,190,0.12)',
  },
  manageText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '700',
  },
});
