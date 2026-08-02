import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  Alert,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import Icon from '../components/Icon';
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
      if (next) {
        initSentryIfPossible();
      }
      setSentryEnabled?.(next);
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
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#a855f7" style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="chevron-back" size={24} color="#e2e8f0" />
        </TouchableOpacity>
        <Text style={styles.title}>Privacy & Security</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
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
            trackColor={{ false: '#334155', true: '#7c3aed' }}
            thumbColor="#f8fafc"
          />
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Your data</Text>
        <TouchableOpacity
          style={styles.actionRow}
          disabled={busy}
          onPress={() => requestLifecycle('export')}
        >
          <Icon name="download-outline" size={22} color="#cbd5e1" />
          <Text style={styles.actionText}>Request data export</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionRow}
          disabled={busy}
          onPress={() => requestLifecycle('deletion')}
        >
          <Icon name="trash-outline" size={22} color="#f87171" />
          <Text style={[styles.actionText, { color: '#f87171' }]}>Request account deletion</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          Deletion and export are queued for verified processing. Currency, moderation, and safety
          records may be retained where legally required.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backButton: { padding: 8 },
  title: { color: '#f1f5f9', fontSize: 18, fontWeight: '600' },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  row: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: { flex: 1, paddingRight: 8 },
  rowTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  rowSubtitle: { color: '#94a3b8', fontSize: 13, lineHeight: 18 },
  actionRow: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  actionText: { color: '#e2e8f0', fontSize: 16, fontWeight: '500' },
  footnote: { color: '#64748b', fontSize: 12, lineHeight: 18, marginTop: 16 },
});

export default PrivacySettingsScreen;
