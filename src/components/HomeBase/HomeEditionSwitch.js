import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../../styles/theme';
import { responsiveFont } from '../../utils/scaleUtils';

export default function HomeEditionSwitch({ edition, onChange }) {
  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.chip, edition === 'next' && styles.chipOn]}
        onPress={() => onChange?.('next')}
        activeOpacity={0.85}
      >
        <Text style={[styles.label, edition === 'next' && styles.labelOn]}>New</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.chip, edition === 'classic' && styles.chipOn]}
        onPress={() => onChange?.('classic')}
        activeOpacity={0.85}
      >
        <Text style={[styles.label, edition === 'classic' && styles.labelOn]}>Classic</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipOn: {
    backgroundColor: COLORS.primary,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(12),
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  labelOn: {
    color: '#FFFFFF',
  },
});
