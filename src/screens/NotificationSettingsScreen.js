import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  Linking,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import Icon from '../components/Icon';
import SettingsScreenShell from '../components/SettingsScreenShell';
import { useAuth } from '../hooks/useCommon';
import { registerForPush } from '../services/PushService';
import {
  CATEGORY_META,
} from '../constants/notificationCategories';
import {
  subscribeNotificationSettings,
  setPushEnabled,
  setCategoryEnabled,
  subscribePersonOverridesList,
} from '../services/notificationPreferencesService';

const SECTION_ORDER = [
  { id: 'core', title: 'People & chat', keys: ['live', 'message', 'call', 'gift', 'presence'] },
  { id: 'compete', title: 'Battles & teams', keys: ['battle', 'team'] },
  { id: 'topics', title: 'Topics & product', keys: ['topic', 'streak', 'system'] },
  { id: 'future', title: 'Social & dating', keys: ['follow', 'social', 'dating'] },
];

const NotificationSettingsScreen = ({ navigation }) => {
  const { uid } = useAuth();
  const [granted, setGranted] = useState(false);
  const [loadingPerm, setLoadingPerm] = useState(true);
  const [busyPerm, setBusyPerm] = useState(false);
  const [settings, setSettings] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [busyKey, setBusyKey] = useState(null);

  const refreshPermission = useCallback(async () => {
    try {
      const perms = await Notifications.getPermissionsAsync();
      setGranted(perms?.granted === true || perms?.status === 'granted');
    } catch {
      setGranted(false);
    } finally {
      setLoadingPerm(false);
    }
  }, []);

  useEffect(() => {
    refreshPermission();
  }, [refreshPermission]);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeNotificationSettings(uid, setSettings);
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribePersonOverridesList(uid, setOverrides);
    return unsub;
  }, [uid]);

  const requestPermission = async () => {
    setBusyPerm(true);
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
      setBusyPerm(false);
    }
  };

  const onMasterChange = async (next) => {
    if (!uid) {
      Alert.alert('Sign in', 'Sign in to save notification preferences.');
      return;
    }
    setBusyKey('master');
    try {
      await setPushEnabled(uid, next);
      if (next && !granted) await requestPermission();
    } catch (error) {
      Alert.alert("Couldn't save", error?.message || 'Try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const onCategoryChange = async (category, next) => {
    if (!uid) {
      Alert.alert('Sign in', 'Sign in to save notification preferences.');
      return;
    }
    setBusyKey(category);
    try {
      await setCategoryEnabled(uid, category, next);
      if (next && !granted) await requestPermission();
    } catch (error) {
      Alert.alert("Couldn't save", error?.message || 'Try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const pushMasterOn = settings?.pushEnabled !== false;
  const categories = settings?.categories || {};

  const overrideRows = useMemo(
    () =>
      (overrides || []).filter((row) => row?.targetUid).slice(0, 40),
    [overrides],
  );

  return (
    <SettingsScreenShell navigation={navigation} title="Notifications">
      <Text style={styles.lead}>
        Choose what Blyp can push. Per-person settings beat category toggles; the master switch
        silences everything.
      </Text>

      <Text style={styles.sectionTitle}>Device</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>OS permission</Text>
          <Text style={styles.rowSubtitle}>
            {loadingPerm
              ? 'Checking permission…'
              : granted
                ? 'Enabled on this device.'
                : 'Off — enable to receive pushes.'}
          </Text>
        </View>
        <Switch
          value={granted}
          disabled={busyPerm || loadingPerm}
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

      <Text style={[styles.sectionTitle, styles.sectionSpaced]}>Master</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>All Blyp pushes</Text>
          <Text style={styles.rowSubtitle}>
            Turn off to silence every category (including people overrides).
          </Text>
        </View>
        {busyKey === 'master' ? (
          <ActivityIndicator color="#00A89E" />
        ) : (
          <Switch
            value={pushMasterOn}
            disabled={!uid || busyKey != null}
            onValueChange={onMasterChange}
            trackColor={{ false: '#141418', true: '#00A89E' }}
            thumbColor="#F5F5F7"
          />
        )}
      </View>

      {SECTION_ORDER.map((section) => (
        <View key={section.id}>
          <Text style={[styles.sectionTitle, styles.sectionSpaced]}>{section.title}</Text>
          {section.keys.map((key) => {
            const meta = CATEGORY_META[key] || { title: key, subtitle: '' };
            const enabled =
              typeof categories[key] === 'boolean' ? categories[key] === true : true;
            return (
              <View key={key} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{meta.title}</Text>
                  <Text style={styles.rowSubtitle}>{meta.subtitle}</Text>
                </View>
                {busyKey === key ? (
                  <ActivityIndicator color="#00A89E" />
                ) : (
                  <Switch
                    value={enabled}
                    disabled={!uid || !pushMasterOn || busyKey != null}
                    onValueChange={(next) => onCategoryChange(key, next)}
                    trackColor={{ false: '#141418', true: '#00A89E' }}
                    thumbColor="#F5F5F7"
                  />
                )}
              </View>
            );
          })}
        </View>
      ))}

      <Text style={[styles.sectionTitle, styles.sectionSpaced]}>People</Text>
      <Text style={styles.hint}>
        Open someone's profile → Notifications from @user — or manage overrides below.
      </Text>

      {overrideRows.length === 0 ? (
        <View style={styles.emptyPeople}>
          <Text style={styles.rowSubtitle}>No per-person overrides yet.</Text>
        </View>
      ) : (
        overrideRows.map((row) => (
          <TouchableOpacity
            key={row.targetUid}
            style={styles.actionRow}
            onPress={() => {
              try {
                navigation.navigate('PersonNotificationSettings', {
                  targetUid: row.targetUid,
                });
              } catch {
                /* ignore */
              }
            }}
            accessibilityRole="button"
          >
            <Icon name="person-outline" size={22} color="#A1A1AA" />
            <View style={styles.rowText}>
              <Text style={styles.actionText} numberOfLines={1}>
                Custom · {row.targetUid.slice(0, 10)}…
              </Text>
              <Text style={styles.rowSubtitle}>
                {row.mode === 'everything'
                  ? 'Everything'
                  : row.mode === 'nothing'
                    ? 'Nothing'
                    : 'Custom categories'}
              </Text>
            </View>
            <Icon name="chevron-forward" size={18} color="#71717A" />
          </TouchableOpacity>
        ))
      )}

      <TouchableOpacity
        style={[styles.actionRow, styles.sectionSpaced]}
        onPress={() => {
          try {
            navigation.navigate('Search');
          } catch {
            /* ignore */
          }
        }}
      >
        <Icon name="search-outline" size={22} color="#00A89E" />
        <Text style={[styles.actionText, { color: '#00A89E' }]}>
          Find someone to customize
        </Text>
      </TouchableOpacity>

      <Text style={[styles.hint, styles.sectionSpaced]}>
        Sport topic pages still have their own opt-in toggles. The Topics master above must be on
        for those to deliver.
      </Text>
    </SettingsScreenShell>
  );
};

const styles = StyleSheet.create({
  lead: {
    color: '#A1A1AA',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
  },
  sectionTitle: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  sectionSpaced: { marginTop: 22 },
  hint: {
    color: '#71717A',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  row: {
    backgroundColor: '#141418',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
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
    marginBottom: 10,
  },
  actionText: { color: '#F5F5F7', fontSize: 16, fontWeight: '500' },
  emptyPeople: {
    backgroundColor: '#141418',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
});

export default NotificationSettingsScreen;
