// ReportModal.js
//
// Reusable "Report" sheet used across posts, profiles, comments and live streams.
// Files a report via ReportingService and optionally blocks the user in one step.
// Required for UGC apps (Apple 1.2 / Google UGC policy): every piece of
// user-generated content and every user must be reportable.

import React, { useState, useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import Icon from './Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont } from '../utils/scaleUtils';
import ReportingService from '../services/ReportingService';
import { blockUser } from '../services/BlockService';

export const REPORT_REASONS = [
  { code: 'spam', label: 'Spam or scam' },
  { code: 'harassment', label: 'Harassment or bullying' },
  { code: 'hate', label: 'Hate speech or symbols' },
  { code: 'violence', label: 'Violence or threats' },
  { code: 'nudity_sexual', label: 'Nudity or sexual content' },
  { code: 'self_harm', label: 'Self-harm or suicide' },
  { code: 'child_safety', label: 'Child safety' },
  { code: 'illegal', label: 'Illegal or regulated goods' },
  { code: 'misinformation', label: 'False information' },
  { code: 'other', label: 'Something else' },
];

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {() => void} props.onClose
 * @param {'post'|'user'|'comment'|'stream'} props.targetType
 * @param {string} props.targetId
 * @param {string} [props.targetLabel] e.g. "@alex" or "this post"
 * @param {string} [props.reportedUserId] user to optionally block (for posts/comments/streams)
 */
export default function ReportModal({ visible, onClose, targetType, targetId, targetLabel, reportedUserId }) {
  const [reason, setReason] = useState(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setReason(null);
    setDetails('');
    setSubmitting(false);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose?.();
  }, [reset, onClose]);

  const submit = useCallback(async (alsoBlock) => {
    if (!reason) {
      Alert.alert('Pick a reason', 'Please choose why you’re reporting this.');
      return;
    }
    setSubmitting(true);
    try {
      await ReportingService.reportContent({
        targetType,
        targetId,
        reasonCode: reason,
        details,
      });
      if (alsoBlock && reportedUserId) {
        try { await blockUser(reportedUserId); } catch { /* non-fatal */ }
      }
      close();
      Alert.alert(
        'Thanks for letting us know',
        alsoBlock && reportedUserId
          ? 'We’ll review this. You won’t see content from this account anymore.'
          : 'We’ll review this against our Community Guidelines.'
      );
    } catch (e) {
      setSubmitting(false);
      Alert.alert('Couldn’t send report', e?.message || 'Please try again.');
    }
  }, [reason, details, targetType, targetId, reportedUserId, close]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Report {targetLabel || 'this'}</Text>
          <Text style={styles.subtitle}>Your report is anonymous to the person you’re reporting.</Text>

          <View style={styles.reasons}>
            {REPORT_REASONS.map((r) => {
              const active = reason === r.code;
              return (
                <TouchableOpacity
                  key={r.code}
                  style={[styles.reason, active && styles.reasonActive]}
                  onPress={() => setReason(r.code)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.reasonText, active && styles.reasonTextActive]}>{r.label}</Text>
                  {active ? <Icon name="checkmark-circle" size={18} color={COLORS.primary} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Add any details (optional)"
            placeholderTextColor={COLORS.textMuted}
            value={details}
            onChangeText={setDetails}
            maxLength={500}
            multiline
          />

          {submitting ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 14 }} />
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => submit(false)} activeOpacity={0.85}>
                <Text style={styles.btnPrimaryText}>Submit report</Text>
              </TouchableOpacity>
              {reportedUserId ? (
                <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={() => submit(true)} activeOpacity={0.85}>
                  <Text style={styles.btnDangerText}>Report &amp; block</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.btn} onPress={close} activeOpacity={0.85}>
                <Text style={styles.btnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  backdropTap: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: COLORS.backgroundCard || '#15151B',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '88%',
  },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 12 },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  subtitle: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 4, marginBottom: 12 },
  reasons: { gap: 8 },
  reason: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(255,255,255,0.03)',
  },
  reasonActive: { borderColor: COLORS.primary, backgroundColor: 'rgba(0,210,190,0.08)' },
  reasonText: { color: COLORS.textSecondary, fontSize: responsiveFont(14), fontWeight: '600' },
  reasonTextActive: { color: COLORS.textPrimary, fontWeight: '700' },
  input: {
    marginTop: 12, minHeight: 64, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.textPrimary, padding: 12, textAlignVertical: 'top', fontSize: responsiveFont(13),
  },
  actions: { marginTop: 14, gap: 10 },
  btn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  btnText: { color: COLORS.textSecondary, fontSize: responsiveFont(14), fontWeight: '700' },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnPrimaryText: { color: '#001b18', fontSize: responsiveFont(14), fontWeight: '800' },
  btnDanger: { backgroundColor: 'rgba(255,59,48,0.14)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.5)' },
  btnDangerText: { color: '#FF6B60', fontSize: responsiveFont(14), fontWeight: '800' },
});
