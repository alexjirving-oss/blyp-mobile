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
          <Icon name="person" size={26} color="rgba(255,255,255,0.88)" />
        </View>
      )}
      <ActivityIndicator size="small" color={COLORS.primary || '#00D2BE'} style={styles.spinner} />
      <Text style={styles.label} allowFontScaling={false}>
        {String(label || 'Joining…').toUpperCase()}
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
    backgroundColor: 'rgba(10,10,12,0.94)',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(0,210,190,0.65)',
  },
  avatarFallback: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,210,190,0.14)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,210,190,0.5)',
  },
  spinner: {
    marginBottom: 6,
  },
  label: {
    color: 'rgba(127,237,226,0.92)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
});
