// Mandatory SafetyGate sheet — ToS + Community Guidelines + age declaration.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Linking,
  ScrollView,
  Alert,
} from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont } from '../../utils/scaleUtils';
import {
  SAFETY_POLICY_SUMMARY,
  SAFETY_POLICY_BUNDLE_VERSION,
  MIN_BROADCAST_AGE,
  evaluateSafetyGate,
  acceptSafetyPolicies,
  declareAge,
} from '../../services/safety/SafetyGateService';

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {string} props.uid
 * @param {() => void} props.onClose - cancel / dismiss without completing
 * @param {() => void} props.onPassed - gate satisfied; caller may proceed
 * @param {string} [props.purpose] - "upload" | "go_live" | "create"
 */
export default function SafetyGateModal({ visible, uid, onClose, onPassed, purpose = 'create' }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [evalState, setEvalState] = useState(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptGuidelines, setAcceptGuidelines] = useState(false);
  const [birthYear, setBirthYear] = useState('');

  const refresh = useCallback(async () => {
    if (!uid) {
      setEvalState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const ev = await evaluateSafetyGate(uid);
      setEvalState(ev);
      if (ev.birthYear) setBirthYear(String(ev.birthYear));
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (visible) {
      setAcceptTerms(false);
      setAcceptGuidelines(false);
      refresh();
    }
  }, [visible, refresh]);

  const openUrl = (url) => {
    Linking.openURL(url).catch(() => Alert.alert('Could not open link'));
  };

  const submit = async () => {
    if (!uid) return;
    setSaving(true);
    try {
      if (evalState?.needsTerms) {
        if (!acceptTerms || !acceptGuidelines) {
          Alert.alert('Required', 'Please accept Terms of Service and Community Guidelines.');
          setSaving(false);
          return;
        }
        await acceptSafetyPolicies(uid, {
          acceptedTerms: acceptTerms,
          acceptedGuidelines: acceptGuidelines,
        });
      }

      if (evalState?.needsAge || evalState?.underage) {
        const year = Number(String(birthYear).trim());
        if (!Number.isFinite(year)) {
          Alert.alert('Age required', 'Enter your birth year (YYYY).');
          setSaving(false);
          return;
        }
        const ageResult = await declareAge(uid, { birthYear: year });
        if (ageResult.underage) {
          Alert.alert(
            'Age restriction',
            `You must be ${MIN_BROADCAST_AGE}+ to ${purpose === 'go_live' ? 'go live' : 'upload content'} on Blyp.`,
          );
          setSaving(false);
          await refresh();
          return;
        }
      }

      const ev = await evaluateSafetyGate(uid);
      setEvalState(ev);
      if (ev.ok) {
        onPassed?.();
      } else if (ev.underage) {
        Alert.alert('Age restriction', `Broadcasting and uploads require age ${MIN_BROADCAST_AGE}+.`);
      } else {
        Alert.alert('Almost there', 'Please complete the remaining safety steps.');
      }
    } catch (e) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const purposeLabel =
    purpose === 'go_live' ? 'go live' : purpose === 'upload' ? 'upload' : 'create content';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Safety check</Text>
          <Text style={styles.subtitle}>
            Before you {purposeLabel}, confirm you accept our policies and are {MIN_BROADCAST_AGE}+.
          </Text>

          {loading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 24 }} />
          ) : (
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
              {SAFETY_POLICY_SUMMARY.bullets.map((b) => (
                <View key={b} style={styles.bulletRow}>
                  <Icon name="shield-checkmark-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.bullet}>{b}</Text>
                </View>
              ))}

              {evalState?.needsTerms ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Policies (v{SAFETY_POLICY_BUNDLE_VERSION})</Text>
                  <TouchableOpacity
                    style={styles.checkRow}
                    onPress={() => setAcceptTerms((v) => !v)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: acceptTerms }}
                  >
                    <View style={[styles.box, acceptTerms && styles.boxOn]}>
                      {acceptTerms ? <Icon name="checkmark" size={14} color="#000" /> : null}
                    </View>
                    <Text style={styles.checkLabel}>
                      I accept the{' '}
                      <Text style={styles.link} onPress={() => openUrl(SAFETY_POLICY_SUMMARY.termsUrl)}>
                        {SAFETY_POLICY_SUMMARY.termsTitle}
                      </Text>
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.checkRow}
                    onPress={() => setAcceptGuidelines((v) => !v)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: acceptGuidelines }}
                  >
                    <View style={[styles.box, acceptGuidelines && styles.boxOn]}>
                      {acceptGuidelines ? <Icon name="checkmark" size={14} color="#000" /> : null}
                    </View>
                    <Text style={styles.checkLabel}>
                      I accept the{' '}
                      <Text
                        style={styles.link}
                        onPress={() => openUrl(SAFETY_POLICY_SUMMARY.guidelinesUrl)}
                      >
                        {SAFETY_POLICY_SUMMARY.guidelinesTitle}
                      </Text>
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {(evalState?.needsAge || evalState?.underage) ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Age assurance</Text>
                  <Text style={styles.hint}>Birth year (YYYY) — required for live & uploads</Text>
                  <TextInput
                    style={styles.input}
                    value={birthYear}
                    onChangeText={setBirthYear}
                    keyboardType="number-pad"
                    maxLength={4}
                    placeholder="e.g. 1998"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />
                  {evalState?.underage ? (
                    <Text style={styles.warn}>
                      Under {MIN_BROADCAST_AGE}: create/upload/go-live stay locked.
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
              onPress={submit}
              disabled={saving || loading}
            >
              {saving ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.primaryText}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#121216',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 18,
    paddingBottom: 28,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: 10,
    marginBottom: 12,
  },
  title: {
    color: '#fff',
    fontSize: responsiveFont(18),
    fontWeight: '800',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: responsiveFont(13),
    marginTop: 6,
    marginBottom: 12,
    lineHeight: 18,
  },
  scroll: { maxHeight: 420 },
  bulletRow: { flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'flex-start' },
  bullet: { flex: 1, color: 'rgba(255,255,255,0.8)', fontSize: responsiveFont(13), lineHeight: 18 },
  section: { marginTop: 14, marginBottom: 8 },
  sectionTitle: { color: '#fff', fontWeight: '700', fontSize: responsiveFont(14), marginBottom: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkLabel: { flex: 1, color: 'rgba(255,255,255,0.88)', fontSize: responsiveFont(13), lineHeight: 18 },
  link: { color: COLORS.primary, textDecorationLine: 'underline' },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: responsiveFont(12), marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: responsiveFont(16),
  },
  warn: { color: '#FB7185', marginTop: 8, fontSize: responsiveFont(12) },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  cancelText: { color: '#fff', fontWeight: '600' },
  primaryBtn: {
    flex: 1.4,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: COLORS.primary,
  },
  primaryText: { color: '#000', fontWeight: '800' },
});
