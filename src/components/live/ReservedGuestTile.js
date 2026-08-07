import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';

/**
 * Authoritative reserved guest box: shown as soon as Dynamo/invite assigns a
 * slotIndex — before IVS media arrives. Prevents black/empty wrong-box flashes.
 */
export default function ReservedGuestTile({ photoUrl = null, label = 'Joining…', style }) {
  return (
    <View style={[styles.fill, style]}>
      {photoUrl ? (
        <Image source={{ uri: String(photoUrl) }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarFallback}>
          <Icon name="person" size={28} color="rgba(255,255,255,0.85)" />
        </View>
      )}
      <ActivityIndicator size="small" color={COLORS.primary || '#00D2BE'} style={styles.spinner} />
      <Text style={styles.label} allowFontScaling={false}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.92)',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(0,210,190,0.55)',
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,210,190,0.45)',
  },
  spinner: {
    marginBottom: 6,
  },
  label: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
