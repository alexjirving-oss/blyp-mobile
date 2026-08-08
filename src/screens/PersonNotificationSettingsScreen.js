import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import SettingsScreenShell from '../components/SettingsScreenShell';
import { useAuth } from '../hooks/useCommon';
import {
  CATEGORY_META,
  NOTIFICATION_CATEGORIES,
  OVERRIDE_MODES,
} from '../constants/notificationCategories';
import {
  subscribePersonOverride,
  setPersonOverride,
  clearPersonOverride,
} from '../services/notificationPreferencesService';

const CATEGORY_KEYS = [
  'live',
  'message',
  'call',
  'gift',
  'presence',
  'battle',
  'team',
  'follow',
  'social',
];

const PersonNotificationSettingsScreen = ({ navigation, route }) => {
  const { uid } = useAuth();
  const targetUid = String(route?.params?.targetUid || '').trim();
  const handle = String(route?.params?.username || route?.params?.handle || '').trim();
  const displayName = String(route?.params?.displayName || '').trim();

  const [override, setOverride] = useState(null);
  const [busy, setBusy] = useState(null);

  const titleLabel = useMemo(() => {
    if (handle) return `@${handle.replace(/^@/, '')}`;
    if (displayName) return displayName;
    if (targetUid) return `user ${targetUid.slice(0, 8)}…`;
    return 'Person';
  }, [handle, displayName, targetUid]);

  useEffect(() => {
    if (!uid || !targetUid) return undefined;
    return subscribePersonOverride(uid, targetUid, setOverride);
  }, [uid, targetUid]);

  const mode = override?.mode || 'custom';
  const categories = override?.categories || {};

  const saveMode = async (nextMode) => {
    if (!uid || !targetUid) return;
    setBusy('mode');
    try {
      await setPersonOverride(uid, targetUid, {
        mode: nextMode,
        categories: nextMode === 'custom' ? categories : {},
      });
    } catch (error) {
      Alert.alert('Couldn't save', error?.message || 'Try again.');
    } finally {
      setBusy(null);
    }
  };

  const saveCategory = async (key, enabled) => {
    if (!uid || !targetUid) return;
    setBusy(key);
    try {
      const nextCategories = { ...categories };
      if (enabled === null) {
        delete nextCategories[key];
      } else {
        nextCategories[key] = enabled === true;
      }
      await setPersonOverride(uid, targetUid, {
        mode: 'custom',
        categories: nextCategories,
      });
    } catch (error) {
      Alert.alert('Couldn't save', error?.message || 'Try again.');
    } finally {
      setBusy(null);
    }
  };

  const onClear = () => {
    Alert.alert(
      'Reset to global?',
      'This person will follow your global notification settings again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setBusy('clear');
            try {
              await clearPersonOverride(uid, targetUid);
            } catch (error) {
              Alert.alert('Couldn't reset', error?.message || 'Try again.');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  if (!targetUid) {
    return (
      <SettingsScreenShell navigation={navigation} title="Notifications">
        <Text style={styles.lead}>Missing person. Go back and open a profile.</Text>
      </SettingsScreenShell>
    );
  }

  return (
    <SettingsScreenShell
      navigation={navigation}
      title={`Notifications from ${titleLabel}`}
    >
      <Text style={styles.lead}>
        Per-person choices beat your global toggles. Use a preset, or customize categories.
      </Text>

      <Text style={styles.sectionTitle}>Presets</Text>
      {(['everything', 'nothing', 'custom']).map((key) => {
        const meta = OVERRIDE_MODES[key];
        const selected = mode === key;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.presetRow, selected && styles.presetRowSelected]}
            onPress={() => saveMode(key)}
            disabled={busy != null}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{meta.title}</Text>
              <Text style={styles.rowSubtitle}>{meta.subtitle}</Text>
            </View>
            {busy === 'mode' && selected ? (
              <ActivityIndicator color="#00A89E" />
            ) : (
              <View style={[styles.radio, selected && styles.radioOn]} />
            )}
          </TouchableOpacity>
        );
      })}

      {mode === 'custom' ? (
        <>
          <Text style={[styles.sectionTitle, styles.sectionSpaced]}>Categories</Text>
          <Text style={styles.hint}>
            Off = never from this person. On = always from them. Leave unset to follow global.
            Tap a switch twice after On to clear back to "follow global" via long-press reset
            below, or use Reset.
          </Text>
          {CATEGORY_KEYS.map((key) => {
            const meta = CATEGORY_META[key] || { title: key, subtitle: '' };
            const explicit = typeof categories[key] === 'boolean';
            const value = explicit ? categories[key] === true : false;
            return (
              <View key={key} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{meta.title}</Text>
                  <Text style={styles.rowSubtitle}>
                    {explicit
                      ? value
                        ? 'Always on for this person'
                        : 'Always off for this person'
                      : 'Follows your global setting'}
                  </Text>
                </View>
                {busy === key ? (
                  <ActivityIndicator color="#00A89E" />
                ) : (
                  <Switch
                    value={value}
                    disabled={busy != null}
                    onValueChange={(next) => {
                      // Cycle: unset → on → off → unset is awkward with Switch.
                      // Simple: switch sets explicit true/false. Use Reset to clear.
                      saveCategory(key, next);
                    }}
                    trackColor={{ false: '#141418', true: '#00A89E' }}
                    thumbColor="#F5F5F7"
                  />
                )}
              </View>
            );
          })}
          {NOTIFICATION_CATEGORIES.filter((k) => !CATEGORY_KEYS.includes(k)).length > 0 ? (
            <Text style={styles.hint}>
              System, streak, topics, and dating stay on your global settings (not person-scoped).
            </Text>
          ) : null}
        </>
      ) : null}

      <TouchableOpacity
        style={[styles.clearRow, styles.sectionSpaced]}
        onPress={onClear}
        disabled={busy != null || override?.exists === false}
      >
        {busy === 'clear' ? (
          <ActivityIndicator color="#FB7185" />
        ) : (
          <Text style={styles.clearText}>Reset to global defaults</Text>
        )}
      </TouchableOpacity>
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
  presetRow: {
    backgroundColor: '#141418',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  presetRowSelected: {
    borderColor: '#00A89E',
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
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#3F3F46',
  },
  radioOn: {
    borderColor: '#00A89E',
    backgroundColor: '#00A89E',
  },
  clearRow: {
    backgroundColor: '#1C1214',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  clearText: { color: '#FB7185', fontSize: 15, fontWeight: '600' },
});

export default PersonNotificationSettingsScreen;
