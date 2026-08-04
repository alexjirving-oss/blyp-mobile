import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Icon from '../components/Icon';
import SettingsScreenShell from '../components/SettingsScreenShell';
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
} from '../services/PrivacyConsent';
import { submitPrivacyRequest } from '../services/PrivacyRequests';
import { initSentryIfPossible, setSentryEnabled } from '../monitoring/sentry';

const PrivacySettingsScreen = ({ navigation }) => {
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const value = await getAnalyticsConsent();
      if (mounted) {
        setConsent(value);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const onToggleConsent = async (next) => {
    setBusy(true);
    try {
      await setAnalyticsConsent(next);
      setConsent(next);
      setSentryEnabled?.(next);
      if (next) {
        initSentryIfPossible();
      }
    } catch (error) {
      Alert.alert('Error', error?.message || 'Could not update consent');
    } finally {
      setBusy(false);
    }
  };

  const requestLifecycle = (type) => {
    const title = type === 'deletion' ? 'Delete account data' : 'Export my data';
    const body =
      type === 'deletion'
        ? 'This queues a deletion request for your account data. Processing is not instant and may require identity verification.'
        : 'This queues an export of data linked to your account. You will be contacted when it is ready.';

    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: type === 'deletion' ? 'Request deletion' : 'Request export',
        style: type === 'deletion' ? 'destructive' : 'default',
        onPress: async () => {
          setBusy(true);
          try {
            const result = await submitPrivacyRequest(type);
            Alert.alert(
              'Request queued',
              `Reference: ${result.id}\nWe will process this as soon as possible.`,
            );
          } catch (error) {
            Alert.alert(
              'Request failed',
              error?.message === 'AUTH_REQUIRED'
                ? 'Please sign in again, then retry.'
                : error?.message || 'Could not queue request',
            );
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SettingsScreenShell navigation={navigation} title="Privacy & Security" scroll={false}>
        <ActivityIndicator color="#00D2BE" style={{ marginTop: 40 }} />
      </SettingsScreenShell>
    );
  }

  return (
    <SettingsScreenShell navigation={navigation} title="Privacy & Security">
      <Text style={styles.sectionTitle}>Telemetry</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Analytics & crash reporting</Text>
          <Text style={styles.rowSubtitle}>
            Off by default. When enabled, limited diagnostics may be sent to help improve Blyp.
          </Text>
        </View>
        <Switch
          value={consent}
          onValueChange={onToggleConsent}
          disabled={busy}
          trackColor={{ false: '#141418', true: '#00A89E' }}
          thumbColor="#F5F5F7"
        />
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Your data</Text>
      <TouchableOpacity
        style={styles.actionRow}
        disabled={busy}
        onPress={() => requestLifecycle('export')}
        accessibilityRole="button"
        accessibilityLabel="Request data export"
      >
        <Icon name="download-outline" size={22} color="#A1A1AA" />
        <Text style={styles.actionText}>Request data export</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.actionRow}
        disabled={busy}
        onPress={() => requestLifecycle('deletion')}
        accessibilityRole="button"
        accessibilityLabel="Request account deletion"
      >
        <Icon name="trash-outline" size={22} color="#FB7185" />
        <Text style={[styles.actionText, { color: '#FB7185' }]}>Request account deletion</Text>
      </TouchableOpacity>

      <Text style={styles.footnote}>
        Deletion and export are queued for verified processing. Currency, moderation, and safety
        records may be retained where legally required.
      </Text>
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
  footnote: { color: '#52525B', fontSize: 12, lineHeight: 18, marginTop: 16 },
});

export default PrivacySettingsScreen;
