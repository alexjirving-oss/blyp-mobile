// DatingScreen.js
//
// Blyp Dating — Phase 0/1: entitlement-gated shell with 18+ attestation,
// opt-in prefs, discovery card stub, and matches empty state.
// Gated by the same subscription package as AI (useHasAI) — no second paywall.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import ReportModal from '../components/ReportModal';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useHasAI } from '../hooks/useEntitlement';
import { useAuth } from '../hooks/useCommon';
import {
  confirmAdult,
  getDatingPrefs,
  getStubDiscoveryCards,
  setDatingOptIn,
} from '../services/datingService';
import { blockUser, loadBlockedUsers } from '../services/BlockService';

const TABS = [
  { id: 'discover', label: 'Discover' },
  { id: 'matches', label: 'Matches' },
  { id: 'prefs', label: 'Prefs' },
];

const DatingScreen = ({ navigation }) => {
  const { uid } = useAuth();
  const entitled = useHasAI();
  const [tab, setTab] = useState('discover');
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [reportTarget, setReportTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!uid) {
      setPrefs(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      await loadBlockedUsers().catch(() => {});
      const p = await getDatingPrefs(uid);
      setPrefs(p);
      setCards(getStubDiscoveryCards());
      setCardIndex(0);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onConfirmAdult = useCallback(async () => {
    if (!uid || busy) return;
    setBusy(true);
    try {
      const next = await confirmAdult(uid);
      setPrefs(next);
    } catch (e) {
      Alert.alert('Couldn’t save', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [uid, busy]);

  const onToggleOptIn = useCallback(
    async (value) => {
      if (!uid || busy) return;
      if (value && !prefs?.adultConfirmed) {
        Alert.alert('18+ required', 'Confirm you are 18 or older before joining Dating.');
        return;
      }
      setBusy(true);
      try {
        const next = await setDatingOptIn(uid, value);
        setPrefs(next);
      } catch (e) {
        Alert.alert('Couldn’t update', e?.message || 'Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [uid, busy, prefs?.adultConfirmed],
  );

  const current = cards[cardIndex] || null;

  const passCard = useCallback(() => {
    setCardIndex((i) => Math.min(i + 1, cards.length));
  }, [cards.length]);

  const likeCard = useCallback(() => {
    // Phase 1: local advance only. Mutual match writes land in Phase 2.
    setCardIndex((i) => Math.min(i + 1, cards.length));
  }, [cards.length]);

  const onBlockCurrent = useCallback(() => {
    if (!current || current.stub) {
      Alert.alert('Demo card', 'Stub profiles can’t be blocked. Real profiles in the next phase will use your block list.');
      return;
    }
    Alert.alert(
      'Block user',
      `You won’t see ${current.displayName} in Dating or elsewhere.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(current.id);
              passCard();
            } catch (e) {
              Alert.alert('Couldn’t block', e?.message || 'Please try again.');
            }
          },
        },
      ],
    );
  }, [current, passCard]);

  // --- Gated: free / no entitlement -----------------------------------------
  if (!entitled) {
    return (
      <ScreenContainer>
        <View style={styles.container}>
          <View style={styles.topRow}>
            <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.title}>Dating</Text>
            <View style={styles.backBtn} />
          </View>

          <View style={styles.gateCard}>
            <View style={styles.gateIcon}>
              <Icon name="heart" size={28} color={COLORS.primary} />
            </View>
            <Text style={styles.gateTitle}>Dating is in Blyp Plus</Text>
            <Text style={styles.gateBody}>
              Meet people on Blyp with Discover and Matches. It’s part of the same subscription package as Blyp AI — included in your trial and Plus, not on Free after the trial ends.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Plans')}
            >
              <Text style={styles.primaryBtnText}>See plans</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  // --- Loading --------------------------------------------------------------
  if (loading || !prefs) {
    return (
      <ScreenContainer>
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // --- 18+ gate -------------------------------------------------------------
  if (!prefs.adultConfirmed) {
    return (
      <ScreenContainer>
        <View style={styles.container}>
          <View style={styles.topRow}>
            <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.title}>Dating</Text>
            <View style={styles.backBtn} />
          </View>

          <View style={styles.gateCard}>
            <View style={styles.gateIcon}>
              <Icon name="shield-checkmark-outline" size={28} color={COLORS.primary} />
            </View>
            <Text style={styles.gateTitle}>18+ only</Text>
            <Text style={styles.gateBody}>
              Blyp Dating is for adults. Confirm you are at least 18 years old to continue. You can turn discovery off any time in Prefs.
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              activeOpacity={0.85}
              disabled={busy}
              onPress={onConfirmAdult}
            >
              <Text style={styles.primaryBtnText}>I am 18 or older</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.secondaryBtnText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  const showStubStack = prefs.optedIn && current;

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Dating</Text>
          <View style={styles.backBtn} />
        </View>

        <View style={styles.tabRow}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.tabChip, active && styles.tabChipActive]}
                onPress={() => setTab(t.id)}
                activeOpacity={0.85}
              >
                <Text style={[styles.tabChipText, active && styles.tabChipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === 'discover' && (
          <View style={styles.panel}>
            {!prefs.optedIn ? (
              <View style={styles.emptyBlock}>
                <Icon name="heart-outline" size={32} color={COLORS.textMuted} />
                <Text style={styles.emptyTitle}>Discovery is off</Text>
                <Text style={styles.emptyBody}>
                  Turn on “Show me in Dating” under Prefs to join the pool. You’ll only see people who opted in too.
                </Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => setTab('prefs')}>
                  <Text style={styles.primaryBtnText}>Open prefs</Text>
                </TouchableOpacity>
              </View>
            ) : showStubStack ? (
              <View style={styles.cardStack}>
                <View style={styles.personCard}>
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarLetter}>
                      {(current.displayName || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.personName}>{current.displayName}</Text>
                  <Text style={styles.personTagline}>{current.tagline}</Text>
                  {current.stub ? (
                    <Text style={styles.stubBadge}>Preview card — real people in the next update</Text>
                  ) : null}
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.roundBtn} onPress={passCard} accessibilityLabel="Pass">
                    <Icon name="close" size={26} color={COLORS.textPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.roundBtn}
                    onPress={() =>
                      setReportTarget({
                        id: current.id,
                        label: current.displayName,
                      })
                    }
                    accessibilityLabel="Report"
                  >
                    <Icon name="flag" size={22} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.roundBtn} onPress={onBlockCurrent} accessibilityLabel="Block">
                    <Icon name="hand-left-outline" size={22} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.roundBtn, styles.likeBtn]} onPress={likeCard} accessibilityLabel="Like">
                    <Icon name="heart" size={26} color={COLORS.white} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.emptyBlock}>
                <Icon name="checkmark-circle" size={32} color={COLORS.primary} />
                <Text style={styles.emptyTitle}>You’re caught up</Text>
                <Text style={styles.emptyBody}>
                  No more preview cards. Live discovery of opted-in members ships next — your block list will filter them automatically.
                </Text>
              </View>
            )}
          </View>
        )}

        {tab === 'matches' && (
          <View style={[styles.panel, styles.emptyBlock]}>
            <Icon name="chatbubbles-outline" size={32} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>No matches yet</Text>
            <Text style={styles.emptyBody}>
              When someone you like likes you back, they’ll show up here. Matches will open into Messenger — no separate chat stack.
            </Text>
          </View>
        )}

        {tab === 'prefs' && (
          <ScrollView style={styles.panel} contentContainerStyle={styles.prefsPad}>
            <View style={styles.prefRow}>
              <View style={styles.prefCopy}>
                <Text style={styles.prefTitle}>Show me in Dating</Text>
                <Text style={styles.prefBody}>
                  Opt in to appear in Discover for other entitled adults. Off by default.
                </Text>
              </View>
              <Switch
                value={!!prefs.optedIn}
                onValueChange={onToggleOptIn}
                disabled={busy}
                trackColor={{ false: COLORS.backgroundLight, true: COLORS.primaryDark }}
                thumbColor={prefs.optedIn ? COLORS.primary : COLORS.textMuted}
              />
            </View>

            <View style={styles.prefNote}>
              <Icon name="shield-checkmark" size={18} color={COLORS.primary} />
              <Text style={styles.prefNoteText}>
                Report and block work the same as the rest of Blyp. Free users never see Dating — it’s part of your Plus / trial package.
              </Text>
            </View>
          </ScrollView>
        )}
      </View>

      <ReportModal
        visible={!!reportTarget}
        onClose={() => setReportTarget(null)}
        targetType="user"
        targetId={reportTarget?.id}
        targetLabel={reportTarget?.label}
        reportedUserId={reportTarget?.stub ? undefined : reportTarget?.id}
      />
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: responsiveSize(8) },
  centered: { alignItems: 'center', justifyContent: 'center' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },

  tabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  tabChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border || 'rgba(255,255,255,0.08)',
  },
  tabChipActive: {
    backgroundColor: COLORS.primaryDark,
    borderColor: COLORS.primary,
  },
  tabChipText: { color: COLORS.textSecondary, fontSize: responsiveFont(13), fontWeight: '600' },
  tabChipTextActive: { color: COLORS.textPrimary },

  panel: { flex: 1, paddingHorizontal: 16 },
  prefsPad: { paddingBottom: 40 },

  gateCard: {
    marginHorizontal: 16,
    marginTop: 24,
    padding: 20,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
  },
  gateIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,210,190,0.12)',
  },
  gateTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(20), fontWeight: '800' },
  gateBody: { color: COLORS.textSecondary, fontSize: responsiveFont(14), lineHeight: 20 },

  primaryBtn: {
    marginTop: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: COLORS.black || '#0a0a0a', fontSize: responsiveFont(15), fontWeight: '800' },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center' },
  secondaryBtnText: { color: COLORS.textSecondary, fontSize: responsiveFont(14), fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },

  emptyBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  emptyTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800', textAlign: 'center' },
  emptyBody: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(14),
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 8,
  },

  cardStack: { flex: 1, justifyContent: 'center', gap: 20, paddingBottom: 24 },
  personCard: {
    borderRadius: 20,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 24,
    alignItems: 'center',
    gap: 10,
    minHeight: responsiveSize(320),
    justifyContent: 'center',
  },
  avatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatarLetter: { color: COLORS.textPrimary, fontSize: responsiveFont(36), fontWeight: '800' },
  personName: { color: COLORS.textPrimary, fontSize: responsiveFont(22), fontWeight: '800' },
  personTagline: { color: COLORS.textSecondary, fontSize: responsiveFont(14), textAlign: 'center', lineHeight: 20 },
  stubBadge: {
    marginTop: 8,
    color: COLORS.textMuted,
    fontSize: responsiveFont(12),
    textAlign: 'center',
  },

  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  roundBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  likeBtn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },

  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  prefCopy: { flex: 1, gap: 4 },
  prefTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700' },
  prefBody: { color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: 18 },
  prefNote: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(0,210,190,0.08)',
  },
  prefNoteText: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: 18 },
});

export default DatingScreen;
