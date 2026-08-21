// HowBlypWorksScreen.js
//
// Layer-1 terms — "How Blyp works", the plain-English statement of what we stand
// for (see BLYP_CHARTER.md). Two modes:
//   • mode: 'accept'  — shown at sign-up / when terms version changed; has an
//                       "I understand" button that records versioned acceptance.
//   • mode: 'review'  — read-only, opened from Profile / Transparency.

import React, { useCallback, useState, useEffect } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, BackHandler, Alert } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import { HOW_BLYP_WORKS, LAYER_2_NOTE, recordAcceptance } from '../services/termsService';

const HowBlypWorksScreen = ({ navigation, route }) => {
  const { uid } = useAuth();
  const mode = route?.params?.mode || 'review';
  const [saving, setSaving] = useState(false);

  const onAccept = useCallback(async () => {
    if (!uid) {
      Alert.alert('One moment', 'Still signing you in — try again in a second.');
      return;
    }
    setSaving(true);
    try {
      await recordAcceptance(uid);
    } finally {
      setSaving(false);
      if (route?.params?.onAccepted) {
        route.params.onAccepted();
      } else {
        navigation.goBack();
      }
    }
  }, [uid, navigation, route]);

  useEffect(() => {
    if (mode !== 'accept') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    const removeNav = navigation.addListener('beforeRemove', (e) => {
      if (saving) return;
      e.preventDefault();
    });
    return () => {
      sub.remove();
      removeNav();
    };
  }, [mode, navigation, saving]);

  return (
    <ScreenContainer>
      <View style={styles.topRow}>
        {mode === 'review' ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={styles.title}>How Blyp works</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Most apps bury this. We don’t — we genuinely recommend reading it, not out of fear, but because it’s what Blyp is built
          on.
        </Text>

        {HOW_BLYP_WORKS.map((item) => (
          <View key={item.title} style={styles.row}>
            <View style={styles.iconWrap}>
              <Icon name={item.icon} size={18} color={COLORS.primary} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowBody}>{item.body}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.layer2}>{LAYER_2_NOTE}</Text>
      </ScrollView>

      {mode === 'accept' && (
        <View style={styles.acceptBar}>
          <TouchableOpacity style={styles.acceptBtn} activeOpacity={0.85} disabled={saving} onPress={onAccept}>
            <Text style={styles.acceptText}>{saving ? 'Saving…' : 'I understand'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: responsiveSize(8),
    marginBottom: 6,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  intro: { color: COLORS.textSecondary, fontSize: responsiveFont(14), lineHeight: responsiveFont(20), marginVertical: 12 },

  row: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255, 45, 85,0.12)', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '800', marginBottom: 3 },
  rowBody: { color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(19) },

  layer2: { color: COLORS.textMuted, fontSize: responsiveFont(12), lineHeight: responsiveFont(18), marginTop: 8, fontStyle: 'italic' },

  acceptBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: responsiveSize(20), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  acceptBtn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  acceptText: { color: '#001b18', fontSize: responsiveFont(15), fontWeight: '900' },
});

export default HowBlypWorksScreen;
