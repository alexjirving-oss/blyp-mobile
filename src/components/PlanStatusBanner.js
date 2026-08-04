// PlanStatusBanner.js
//
// A compact, always-visible banner for users who aren't on an active paid plan:
//   • Free tier  -> teal "Upgrade now" upsell so they can always upgrade.
//   • Past due   -> amber "your payment didn't go through, you're on Free now"
//                   with a one-tap "Fix payment" button.
// Renders nothing for trialing / Plus / Plus+Coins users (we don't nag payers).

import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from './Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont } from '../utils/scaleUtils';
import { useEntitlement } from '../hooks/useEntitlement';

export default function PlanStatusBanner(props = {}) {
  const { style } = props;
  const ent = useEntitlement();
  const navigation = useNavigation();

  const goPlans = useCallback(() => {
    try { navigation.navigate('Plans'); } catch { /* route may not exist in some stacks */ }
  }, [navigation]);

  if (!ent) return null;
  // Active paid or trialing users don't see a banner.
  if (ent.trialing || ent.effectiveTier === 'plus' || ent.effectiveTier === 'plus_coins') return null;
  if (ent.effectiveTier !== 'free') return null;

  const pastDue = !!ent.pastDue;

  if (pastDue) {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={goPlans}
        style={[styles.base, styles.pastDue, style]}
      >
        <Icon name="alert-circle" size={18} color="#FFB020" style={styles.icon} />
        <View style={styles.textWrap}>
          <Text style={styles.titlePastDue}>Your payment didn’t go through</Text>
          <Text style={styles.sub}>You’re back on Free and premium features are paused.</Text>
        </View>
        <View style={[styles.cta, styles.ctaPastDue]}>
          <Text style={styles.ctaTextPastDue}>Fix payment</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={goPlans}
      style={[styles.base, styles.free, style]}
    >
      <Icon name="sparkles" size={18} color={COLORS.primary} style={styles.icon} />
      <View style={styles.textWrap}>
        <Text style={styles.titleFree}>You’re on the Free plan</Text>
        <Text style={styles.sub}>Upgrade to unlock all the AI features.</Text>
      </View>
      <View style={[styles.cta, styles.ctaFree]}>
        <Text style={styles.ctaTextFree}>Upgrade</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  free: {
    backgroundColor: 'rgba(0,210,190,0.10)',
    borderColor: 'rgba(0,210,190,0.35)',
  },
  pastDue: {
    backgroundColor: 'rgba(255,176,32,0.12)',
    borderColor: 'rgba(255,176,32,0.45)',
  },
  icon: { marginRight: 10 },
  textWrap: { flex: 1 },
  titleFree: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '800' },
  titlePastDue: { color: '#FFB020', fontSize: responsiveFont(13), fontWeight: '800' },
  sub: { color: COLORS.textSecondary, fontSize: responsiveFont(11), marginTop: 1 },
  cta: {
    marginLeft: 10,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  ctaFree: { backgroundColor: COLORS.primary },
  ctaPastDue: { backgroundColor: '#FFB020' },
  ctaTextFree: { color: '#001b18', fontSize: responsiveFont(12), fontWeight: '800' },
  ctaTextPastDue: { color: '#2A1B00', fontSize: responsiveFont(12), fontWeight: '800' },
});
