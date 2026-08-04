// LocationPermissionOverlay — shown when a Blyp search needs "near me" coords.
// Requests permission in-app; if blocked, opens system location settings.

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from './Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { getCurrentGeo, openLocationSettings } from '../services/locationService';

const LocationPermissionOverlay = ({ visible, query, onClose, onGranted }) => {
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const finishGrant = useCallback(
    async () => {
      setBusy(true);
      setDenied(false);
      try {
        const res = await getCurrentGeo();
        if (res.ok) {
          onGranted?.(res.geo);
          return;
        }
        if (res.reason === 'denied') setDenied(true);
      } finally {
        setBusy(false);
      }
    },
    [onGranted]
  );

  const onOpenSettings = useCallback(async () => {
    setBusy(true);
    try {
      await openLocationSettings();
    } finally {
      setBusy(false);
    }
  }, []);

  const handleClose = useCallback(() => {
    if (busy) return;
    setDenied(false);
    onClose?.();
  }, [busy, onClose]);

  const hint = String(query || '').trim();
  const subtitle = hint
    ? `To answer “${hint}”, Blyp needs your location.`
    : 'Blyp needs your location to find places near you.';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Icon name="location" size={28} color={COLORS.black} />
          </View>
          <Text style={styles.title}>Turn on location</Text>
          <Text style={styles.body}>{subtitle}</Text>
          <Text style={styles.finePrint}>
            We only use your location for this search — not stored on our servers.
          </Text>

          {denied ? (
            <Text style={styles.denied}>
              Location is off for Blyp. Enable it in your phone settings, then try again.
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            activeOpacity={0.85}
            disabled={busy}
            onPress={denied ? onOpenSettings : finishGrant}
          >
            {busy ? (
              <ActivityIndicator color={COLORS.black} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {denied ? 'Open location settings' : 'Enable location'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.7} onPress={handleClose} disabled={busy}>
            <Text style={styles.secondaryBtnText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: responsiveSize(24),
  },
  card: {
    backgroundColor: COLORS.cardGlass || '#141418',
    borderRadius: responsiveSize(16),
    padding: responsiveSize(22),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  iconWrap: {
    width: responsiveSize(52),
    height: responsiveSize(52),
    borderRadius: responsiveSize(26),
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: responsiveSize(14),
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(20),
    fontWeight: '700',
    marginBottom: responsiveSize(8),
  },
  body: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(15),
    lineHeight: responsiveFont(22),
    marginBottom: responsiveSize(8),
  },
  finePrint: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(12),
    lineHeight: responsiveFont(17),
    marginBottom: responsiveSize(16),
    opacity: 0.85,
  },
  denied: {
    color: '#fbbf24',
    fontSize: responsiveFont(13),
    lineHeight: responsiveFont(18),
    marginBottom: responsiveSize(12),
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: responsiveSize(12),
    paddingVertical: responsiveSize(14),
    alignItems: 'center',
    marginBottom: responsiveSize(10),
  },
  btnDisabled: { opacity: 0.7 },
  primaryBtnText: {
    color: COLORS.black,
    fontSize: responsiveFont(16),
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingVertical: responsiveSize(10),
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(15),
  },
});

export default LocationPermissionOverlay;
