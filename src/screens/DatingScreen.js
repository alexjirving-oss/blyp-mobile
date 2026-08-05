// DatingScreen.js
//
// Blyp Dating — Phase 2: real discovery + like/pass + mutual matches.
// Gated by the same subscription package as AI (useHasAI) — no second paywall.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
  fetchDiscoveryCards,
  fetchMatches,
  getDatingPrefs,
  recordLike,
  recordPass,
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
  const [matches, setMatches] = useState([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const refreshDiscovery = useCallback(async () => {
    if (!uid) {
      setCards([]);
      setCardIndex(0);
      return;
    }
    await loadBlockedUsers().catch(() => {});
    const nextCards = await fetchDiscoveryCards(uid);
    setCards(nextCards);
    setCardIndex(0);
  }, [uid]);

  const refreshMatches = useCallback(async () => {
    if (!uid) {
      setMatches([]);
      return;
    }
    setMatchesLoading(true);
    try {
      const list = await fetchMatches(uid);
      setMatches(list);
    } finally {
      setMatchesLoading(false);
    }
  }, [uid]);

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
      if (p?.optedIn) {
        await refreshDiscovery();
      } else {
        setCards([]);
        setCardIndex(0);
      }
      await refreshMatches();
    } finally {
      setLoading(false);
    }
  }, [uid, refreshDiscovery, refreshMatches]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab === 'matches' && uid && prefs?.adultConfirmed) {
      refreshMatches();
    }
  }, [tab, uid, prefs?.adultConfirmed, refreshMatches]);

  const onConfirmAdult = useCallback(async () => {
    if (!uid || busy) return;
    setBusy(true);
    try {
      const next = await confirmAdult(uid);
      setPrefs(next);
    } catch (e) {
      Alert.alert("Couldn't save", e?.message || 'Please try again.');
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
        if (value) {
          await refreshDiscovery();
        } else {
          setCards([]);
          setCardIndex(0);
        }
      } catch (e) {
        Alert.alert("Couldn't update", e?.message || 'Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [uid, busy, prefs?.adultConfirmed, refreshDiscovery],
  );

  const current = cards[cardIndex] || null;

  const advanceCard = useCallback(() => {
    setCardIndex((i) => Math.min(i + 1, cards.length));
  }, [cards.length]);

  const passCard = useCallback(async () => {
    if (!uid || !current || actionBusy) return;
    setActionBusy(true);
    try {
      await recordPass(uid, current.id);
      advanceCard();
    } catch (e) {
      Alert.alert("Couldn't pass", e?.message || 'Please try again.');
    } finally {
      setActionBusy(false);
    }
  }, [uid, current, actionBusy, advanceCard]);

  const likeCard = useCallback(async () => {
    if (!uid || !current || actionBusy) return;
    setActionBusy(true);
    try {
      const result = await recordLike(uid, current.id);
      if (!result.ok) {
        const msg =
          result.code === 'subscription_required'
            ? 'Dating likes need an active Plus or trial.'
            : result.code === 'dating_not_enabled'
              ? 'Turn on discovery in Prefs first.'
              : result.code === 'blocked'
                ? "You can't like this person."
                : 'Please try again.';
        Alert.alert("Couldn't like", msg);
        return;
      }
      if (result.matched) {
        Alert.alert("It's a match!", 'You and ' + current.displayName + ' liked each other.', [
          { text: 'Nice', style: 'cancel' },
          {
            text: 'View matches',
            onPress: () => {
              setTab('matches');
              refreshMatches();
            },
          },
        ]);
        refreshMatches();
      }
      advanceCard();
    } finally {
      setActionBusy(false);
    }
  }, [uid, current, actionBusy, advanceCard, refreshMatches]);

  const onBlockCurrent = useCallback(() => {
    if (!current) return;
    Alert.alert(
      'Block user',
      "You won't see " + current.displayName + ' in Dating or elsewhere.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(current.id);
              try {
                await recordPass(uid, current.id);
              } catch {
                /* pass is best-effort after block */
              }
              advanceCard();
              refreshMatches();
            } catch (e) {
              Alert.alert("Couldn't block", e?.message || 'Please try again.');
            }
          },
        },
      ],
    );
  }, [current, uid, advanceCard, refreshMatches]);

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
              Meet people on Blyp with Discover and Matches. It is part of the same subscription package as Blyp AI — included in your trial and Plus, not on Free after the trial ends.
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

  if (loading || !prefs) {
    return (
      <ScreenContainer>
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      </ScreenContainer>
    );
  }

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

  const showCardStack = prefs.optedIn && current;

  const renderMatch = ({ item }) => (
    <View style={styles.matchRow}>
      {item.photoURL ? (
        <Image source={{ uri: item.photoURL }} style={styles.matchAvatar} />
      ) : (
        <View style={[styles.matchAvatar, styles.matchAvatarFallback]}>
          <Text style={styles.matchAvatarLetter}>
            {(item.displayName || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.matchCopy}>
        <Text style={styles.matchName} numberOfLines={1}>
          {item.displayName}
        </Text>
        <Text style={styles.matchMeta} numberOfLines={1}>
          {item.tagline || 'Matched on Blyp'}
        </Text>
      </View>
      <Text style={styles.matchSoon}>Chat soon</Text>
    </View>
  );

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
                  Turn on Show me in Dating under Prefs to join the pool. You will only see people who opted in too.
                </Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => setTab('prefs')}>
                  <Text style={styles.primaryBtnText}>Open prefs</Text>
                </TouchableOpacity>
              </View>
            ) : showCardStack ? (
              <View style={styles.cardStack}>
                <View style={styles.personCard}>
                  {current.photoURL ? (
                    <Image source={{ uri: current.photoURL }} style={styles.avatarImage} />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarLetter}>
                        {(current.displayName || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.personName}>{current.displayName}</Text>
                  <Text style={styles.personTagline}>{current.tagline}</Text>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.roundBtn, actionBusy && styles.btnDisabled]}
                    onPress={passCard}
                    disabled={actionBusy}
                    accessibilityLabel="Pass"
                  >
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
                  <TouchableOpacity
                    style={[styles.roundBtn, styles.likeBtn, actionBusy && styles.btnDisabled]}
                    onPress={likeCard}
                    disabled={actionBusy}
                    accessibilityLabel="Like"
                  >
                    {actionBusy ? (
                      <ActivityIndicator color={COLORS.white || '#fff'} />
                    ) : (
                      <Icon name="heart" size={26} color={COLORS.white} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.emptyBlock}>
                <Icon name="checkmark-circle" size={32} color={COLORS.primary} />
                <Text style={styles.emptyTitle}>You are caught up</Text>
                <Text style={styles.emptyBody}>
                  No more opted-in people right now. Check back later — your block list and past passes stay filtered out.
                </Text>
                <TouchableOpacity style={styles.secondaryBtn} onPress={refreshDiscovery}>
                  <Text style={styles.secondaryBtnText}>Refresh</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {tab === 'matches' && (
          <View style={styles.panel}>
            {matchesLoading ? (
              <View style={[styles.emptyBlock, { justifyContent: 'center' }]}>
                <ActivityIndicator color={COLORS.primary} />
              </View>
            ) : matches.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Icon name="chatbubbles-outline" size={32} color={COLORS.textMuted} />
                <Text style={styles.emptyTitle}>No matches yet</Text>
                <Text style={styles.emptyBody}>
                  When someone you like likes you back, they will show up here. Messaging from a match lands in Phase 3.
                </Text>
              </View>
            ) : (
              <FlatList
                data={matches}
                keyExtractor={(item) => item.matchId || item.id}
                renderItem={renderMatch}
                contentContainerStyle={styles.matchesPad}
              />
            )}
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
                Report and block work the same as the rest of Blyp. Free users never see Dating — it is part of your Plus / trial package.
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
        reportedUserId={reportTarget?.id}
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
  matchesPad: { paddingBottom: 40, gap: 10 },

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
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 8,
    backgroundColor: COLORS.primaryDark,
  },
  avatarLetter: { color: COLORS.textPrimary, fontSize: responsiveFont(36), fontWeight: '800' },
  personName: { color: COLORS.textPrimary, fontSize: responsiveFont(22), fontWeight: '800' },
  personTagline: { color: COLORS.textSecondary, fontSize: responsiveFont(14), textAlign: 'center', lineHeight: 20 },

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

  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  matchAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primaryDark,
  },
  matchAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchAvatarLetter: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  matchCopy: { flex: 1, gap: 2 },
  matchName: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700' },
  matchMeta: { color: COLORS.textSecondary, fontSize: responsiveFont(12) },
  matchSoon: { color: COLORS.textMuted, fontSize: responsiveFont(12), fontWeight: '600' },

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
