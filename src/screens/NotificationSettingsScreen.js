import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import Icon from '../components/Icon';
import SettingsScreenShell from '../components/SettingsScreenShell';
import { useAuth } from '../hooks/useCommon';
import { registerForPush } from '../services/PushService';

const NotificationSettingsScreen = ({ navigation }) => {
  const { uid } = useAuth();
  const [granted, setGranted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const perms = await Notifications.getPermissionsAsync();
      setGranted(perms?.granted === true || perms?.status === 'granted');
    } catch {
      setGranted(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const requestPermission = async () => {
    setBusy(true);
    try {
      const perms = await Notifications.requestPermissionsAsync();
      const ok = perms?.granted === true || perms?.status === 'granted';
      setGranted(ok);
      if (!ok) {
        Alert.alert(
          'Permission needed',
          'Enable notifications in system settings to get chat and live alerts.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open settings', onPress: () => Linking.openSettings().catch(() => {}) },
          ],
        );
      } else if (uid) {
        await registerForPush(uid);
      }
    } catch (error) {
      Alert.alert('Error', error?.message || 'Could not update notification permission');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsScreenShell navigation={navigation} title="Notification Settings">
      <Text style={styles.sectionTitle}>Device</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Push notifications</Text>
          <Text style={styles.rowSubtitle}>
            {loading
              ? 'Checking permission…'
              : granted
                ? 'Enabled on this device.'
                : 'Off — enable to get chat and live alerts.'}
          </Text>
        </View>
        <Switch
          value={granted}
          disabled={busy || loading}
          onValueChange={(next) => {
            if (next) requestPermission();
            else Linking.openSettings().catch(() => {});
          }}
          trackColor={{ false: '#141418', true: '#00A89E' }}
          thumbColor="#F5F5F7"
        />
      </View>

      <TouchableOpacity
        style={styles.actionRow}
        onPress={() => Linking.openSettings().catch(() => {})}
        accessibilityRole="button"
        accessibilityLabel="Open system settings"
      >
        <Icon name="settings-outline" size={22} color="#A1A1AA" />
        <Text style={styles.actionText}>
          Open {Platform.OS === 'ios' ? 'iOS' : 'Android'} settings
        </Text>
      </TouchableOpacity>
    </SettingsScreenShell>
  );
};

const styles = StyleSheet.create({
  sectionTitle: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  row: {
    backgroundColor: '#141418',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  rowText: { flex: 1, paddingRight: 8 },
  rowTitle: { color: '#F5F5F7', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  rowSubtitle: { color: '#A1A1AA', fontSize: 13, lineHeight: 18 },
  actionRow: {
    backgroundColor: '#141418',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionText: { color: '#F5F5F7', fontSize: 16, fontWeight: '500' },
});

export default NotificationSettingsScreen;
