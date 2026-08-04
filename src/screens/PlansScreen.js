// PlansScreen.js
//
// The plans / paywall. Honest by design (see BLYP_CHARTER.md → Money):
//   • A plan buys features and coins — it NEVER buys reach.
//   • Coins from the $9.99 tier are spendable in-app but never cashable.
//   • Billing for digital goods goes through the app store, not card capture.
//
// Reachable from the gated AI upsell points and from the Transparency hub.

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { PLANS } from '../services/transparencyService';
import { useEntitlement } from '../hooks/useEntitlement';
import { useAuth } from '../hooks/useCommon';
import { startCheckout, restoreSubscription } from '../services/subscriptionService';

const CHECKOUT_MESSAGES = {
  'billing-pending':
    'Subscriptions are finished through the Google Play store, and we’re putting the final pieces in place. You’re on the free 30-day trial in the meantime — nothing’s locked.',
  'platform-not-supported': 'Subscriptions are handled by your device’s app store, which isn’t available here yet.',
  'user-cancelled': null,
  'unknown-plan': 'That plan isn’t available right now.',
};

const PlansScreen = ({ navigation }) => {
  const ent = useEntitlement();
  const { uid } = useAuth();
  const [busy, setBusy] = useState(null);

  const effectiveTier = ent?.effectiveTier || 'trial';
  const trialing = !!ent?.trialing;
  const trialDaysLeft = ent?.trialDaysLeft || 0;

  const banner = useMemo(() => {
    if (trialing) {
      return {
        icon: 'sparkles-outline',
        text:
          trialDaysLeft <= 1
            ? 'Your free trial ends today — everything is still unlocked.'
            : `${trialDaysLeft} days left on your free trial. Everything’s unlocked until then.`,
      };
    }
    if (effectiveTier === 'plus' || effectiveTier === 'plus_coins') {
      return { icon: 'checkmark-circle-outline', text: 'You’re subscribed — all AI features are on.' };
    }
    return {
      icon: 'information-circle-outline',
      text: 'You’re on the Free plan. The core app works fully; the premium AI extras are paused.',
    };
  }, [trialing, trialDaysLeft, effectiveTier]);

  const onSubscribe = useCallback(
    async (planId) => {
      setBusy(planId);
      try {
        const res = await startCheckout(planId, uid);
        if (res.ok) {
          Alert.alert('You’re in', 'Your subscription is active — enjoy all the AI features.');
          return;
        }
        const msg = CHECKOUT_MESSAGES[res.reason] || 'Something went wrong starting checkout. Please try again.';
        if (msg) Alert.alert('Subscriptions', msg);
      } finally {
        setBusy(null);
      }
    },
    [uid],
  );

  const isSubscribed = effectiveTier === 'plus' || effectiveTier === 'plus_coins';

  const onManage = useCallback(() => {
    // Google Play manages cancellation/renewal for digital subscriptions.
    Linking.openURL('https://play.google.com/store/account/subscriptions').catch(() => {
      Alert.alert('Manage subscription', 'Open the Google Play Store → Menu → Subscriptions to manage or cancel.');
    });
  }, []);

  const onRestore = useCallback(async () => {
    setBusy('restore');
    try {
      const res = await restoreSubscription(uid);
      if (res.ok) {
        Alert.alert('Restored', 'Your subscription has been restored.');
        return;
      }
      const map = {
        'nothing-to-restore': 'We couldn’t find an active subscription to restore on this account.',
        'billing-pending': CHECKOUT_MESSAGES['billing-pending'],
        'platform-not-supported': CHECKOUT_MESSAGES['platform-not-supported'],
      };
      Alert.alert('Restore purchases', map[res.reason] || 'Couldn’t restore right now. Please try again.');
    } finally {
      setBusy(null);
    }
  }, [uid]);

  const isCurrent = useCallback(
    (planId) => {
      if (planId === 'trial') return trialing;
      if (planId === 'free') return !trialing && effectiveTier === 'free';
      return effectiveTier === planId;
    },
    [trialing, effectiveTier],
  );

  return (
    <ScreenContainer>
      <View style={styles.topRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Plans</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.banner}>
          <Icon name={banner.icon} size={20} color={COLORS.primary} />
          <Text style={styles.bannerText}>{banner.text}</Text>
        </View>

        <Text style={styles.honest}>Paying buys features and coins — never reach. Coins are spendable in-app but never cashable.</Text>

        {PLANS.map((p) => {
          const current = isCurrent(p.id);
          const payable = p.id === 'plus' || p.id === 'plus_coins';
          return (
            <View key={p.id} style={[styles.planRow, p.highlight && styles.planRowHighlight, current && styles.planRowCurrent]}>
              <View style={styles.planHeader}>
                <Text style={styles.planName}>{p.name}</Text>
                <Text style={[styles.planPrice, p.highlight && { color: COLORS.primary }]}>{p.price}</Text>
              </View>
              <Text style={styles.planBlurb}>{p.blurb}</Text>

              {current ? (
                <View style={styles.currentTag}>
                  <Icon name="checkmark-circle" size={15} color={COLORS.primary} />
                  <Text style={styles.currentTagText}>Your current plan</Text>
                </View>
              ) : payable ? (
                <TouchableOpacity
                  style={[styles.cta, p.highlight && styles.ctaPrimary, busy && styles.ctaDisabled]}
                  activeOpacity={0.85}
                  disabled={!!busy}
                  onPress={() => onSubscribe(p.id)}
                >
                  <Text style={[styles.ctaText, p.highlight && styles.ctaTextPrimary]}>
                    {busy === p.id ? 'Opening…' : `Choose ${p.name}`}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}

        {isSubscribed && (
          <TouchableOpacity style={styles.restoreBtn} activeOpacity={0.8} onPress={onManage}>
            <Text style={styles.restoreText}>Manage or cancel subscription</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.restoreBtn} activeOpacity={0.8} disabled={!!busy} onPress={onRestore}>
          <Text style={styles.restoreText}>{busy === 'restore' ? 'Restoring…' : 'Restore purchases'}</Text>
        </TouchableOpacity>

        <Text style={styles.footNote}>
          Subscriptions are billed and managed through your device’s app store. Cancel any time — you keep access until the period
          you’ve paid for ends.
        </Text>
      </ScrollView>
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
  scroll: { paddingHorizontal: 16, paddingBottom: 120 },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,210,190,0.10)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
    padding: 14,
    marginTop: 12,
    marginBottom: 12,
  },
  bannerText: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(13), lineHeight: responsiveFont(18), fontWeight: '600' },
  honest: { color: COLORS.textMuted, fontSize: responsiveFont(12), lineHeight: responsiveFont(17), marginBottom: 14 },

  planRow: { backgroundColor: COLORS.backgroundCard, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  planRowHighlight: { borderColor: COLORS.primary, borderWidth: 1.5 },
  planRowCurrent: { borderColor: COLORS.primary, backgroundColor: 'rgba(0,210,190,0.06)' },
  planHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  planName: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '800' },
  planPrice: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '800' },
  planBlurb: { color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(19) },

  currentTag: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  currentTagText: { color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700' },

  cta: { marginTop: 14, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  ctaPrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '800' },
  ctaTextPrimary: { color: '#001b18' },

  restoreBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  restoreText: { color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700' },
  footNote: { color: COLORS.textMuted, fontSize: responsiveFont(12), lineHeight: responsiveFont(18), marginTop: 8 },
});

export default PlansScreen;
