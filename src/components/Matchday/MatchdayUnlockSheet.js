// MatchdayUnlockSheet
//
// Zero-friction unlock bottom sheet. One confirm: if the wallet holds enough
// BlypCoins the grant is instant (no store round-trip); if short, the same
// button launches a single native top-up and auto-continues into the room.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import { checkEntitlement, unlockMatchday } from '../../services/matchdayEntitlementService';
import { logMatchdayEvent } from '../../services/matchdayAnalytics';

const ACCENT = '#19D27C';

export default function MatchdayUnlockSheet({ visible, eventId, eventMeta, uid, onClose, onUnlocked }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible || !eventId) return undefined;
    let active = true;
    setLoading(true);
    setError(null);
    logMatchdayEvent('unlock_sheet_open', { eventId });
    checkEntitlement(eventId)
      .then((s) => {
        if (!active) return;
        setStatus(s);
        if (s.entitled) onUnlocked?.({ viaTopUp: false });
      })
      .catch((e) => {
        if (active) setError(e?.message || 'Could not load pricing right now.');
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [visible, eventId, onUnlocked]);

  const price = Number(status?.priceCoins ?? 0);
  const balance = Number(status?.wallet?.coinBalance || 0) + Number(status?.wallet?.bonusCoinBalance || 0);
  const enough = balance >= price;

  const handleUnlock = useCallback(async () => {
    if (!uid) {
      setError('Sign in to unlock Matchday Live.');
      return;
    }
    setBusy(true);
    setError(null);
    const out = await unlockMatchday(eventId, eventMeta);
    setBusy(false);
    if (out.ok) {
      onUnlocked?.({ viaTopUp: out.viaTopUp });
      return;
    }
    if (out.reason === 'cancelled') return; // silent: user backed out of the store sheet
    if (out.reason === 'billing-unavailable') {
      setError('Top-up is unavailable in this build. Add coins from the store and try again.');
      return;
    }
    if (out.reason === 'insufficient-after-topup') {
      setError('Still short on coins. Add more from the store to unlock.');
      return;
    }
    setError(out.message || 'Something went wrong. Please try again.');
  }, [uid, eventId, eventMeta, onUnlocked]);

  const matchup =
    eventMeta?.homeTeam && eventMeta?.awayTeam ? `${eventMeta.homeTeam} v ${eventMeta.awayTeam}` : 'Matchday Live';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.badge}>
              <Icon name="football" size={responsiveFont(18)} color={COLORS.background} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>MATCHDAY LIVE</Text>
              <Text style={styles.title} numberOfLines={1}>{matchup}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={responsiveFont(22)} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.perks}>
            {[
              { icon: 'chatbubbles', label: 'Live banter room' },
              { icon: 'flash', label: 'Coin-prize predictions' },
              { icon: 'pulse', label: 'Reaction storms' },
              { icon: 'trophy', label: 'Friends leaderboard' },
            ].map((p) => (
              <View key={p.icon} style={styles.perkRow}>
                <Icon name={p.icon} size={responsiveFont(16)} color={ACCENT} />
                <Text style={styles.perkText}>{p.label}</Text>
              </View>
            ))}
          </View>

          {loading ? (
            <ActivityIndicator color={ACCENT} style={{ marginVertical: responsiveSize(20) }} />
          ) : (
            <>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Unlock for this match</Text>
                <View style={styles.coinPill}>
                  <Icon name="logo-bitcoin" size={responsiveFont(15)} color="#0A0A0C" />
                  <Text style={styles.coinPillText}>{price}</Text>
                </View>
              </View>
              <Text style={styles.balance}>
                You have {balance} coins{!enough ? ' · top-up needed' : ''}
              </Text>

              {!!error && <Text style={styles.error}>{error}</Text>}

              <TouchableOpacity
                style={[styles.cta, busy && styles.ctaDisabled]}
                activeOpacity={0.85}
                onPress={handleUnlock}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color={COLORS.background} />
                ) : (
                  <>
                    <Icon name={enough ? 'lock-open' : 'card'} size={responsiveFont(17)} color={COLORS.background} />
                    <Text style={styles.ctaText}>{enough ? 'Unlock now' : 'Top up & unlock'}</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={styles.fineprint}>One tap. Instant access for the rest of the match.</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.backgroundLight,
    borderTopLeftRadius: responsiveSize(24),
    borderTopRightRadius: responsiveSize(24),
    paddingHorizontal: responsiveSize(20),
    paddingTop: responsiveSize(10),
    paddingBottom: Platform.OS === 'ios' ? responsiveSize(34) : responsiveSize(22),
  },
  handle: {
    alignSelf: 'center',
    width: responsiveSize(40),
    height: responsiveSize(4),
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: responsiveSize(14),
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(12) },
  badge: {
    width: responsiveSize(38),
    height: responsiveSize(38),
    borderRadius: responsiveSize(11),
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: { color: ACCENT, fontSize: responsiveFont(11), fontWeight: '800', letterSpacing: 1.5 },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800', marginTop: 1 },
  perks: {
    marginTop: responsiveSize(18),
    backgroundColor: COLORS.background,
    borderRadius: responsiveSize(16),
    padding: responsiveSize(14),
    gap: responsiveSize(10),
  },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(10) },
  perkText: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '600' },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: responsiveSize(20),
  },
  priceLabel: { color: COLORS.textSecondary, fontSize: responsiveFont(14) },
  coinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(5),
    backgroundColor: '#FFD24A',
    paddingHorizontal: responsiveSize(12),
    paddingVertical: responsiveSize(6),
    borderRadius: 999,
  },
  coinPillText: { color: '#FFFFFF', fontWeight: '900', fontSize: responsiveFont(15) },
  balance: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: responsiveSize(6) },
  error: { color: '#F87171', fontSize: responsiveFont(13), marginTop: responsiveSize(12), fontWeight: '600' },
  cta: {
    marginTop: responsiveSize(18),
    backgroundColor: ACCENT,
    borderRadius: responsiveSize(14),
    height: responsiveSize(52),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(8),
  },
  ctaDisabled: { opacity: 0.7 },
  ctaText: { color: COLORS.background, fontWeight: '800', fontSize: responsiveFont(16) },
  fineprint: { color: COLORS.textMuted, fontSize: responsiveFont(11), textAlign: 'center', marginTop: responsiveSize(10) },
});
