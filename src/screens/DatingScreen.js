// DatingScreen.js
//
// Blyp Dating — Phase 4 prefs + Phase 5 soft age gate / report path.
// Matches deep-link into Messenger (createOrGetDirectThread) — unchanged from Phase 3.
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
  TextInput,
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
import { db } from '../config/firebase';
import { conversationsMessagingService } from '../services/messaging';
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';
import {
  AGE_MAX_CEIL,
  AGE_MIN_FLOOR,
  BIO_MAX,
  DATING_GENDER_OPTIONS,
  DATING_PROMPT_OPTIONS,
  DISTANCE_OPTIONS_KM,
  PROMPT_MAX,
  canParticipateInDiscover,
  confirmAdult,
  fetchDiscoveryCards,
  fetchMatches,
  getDatingPrefs,
  recordLike,
  recordPass,
  setDatingOptIn,
  setDatingPrefs,
} from '../services/datingService';
import { getCurrentGeo } from '../services/locationService';
import { blockUser, loadBlockedUsers } from '../services/BlockService';

const TABS = [
  { id: 'discover', label: 'Discover' },
  { id: 'matches', label: 'Matches' },
  { id: 'prefs', label: 'Prefs' },
];

const distanceLabel = (km) => (km == null ? 'Off' : km + ' km');

const datingActionError = (code) => {
  switch (code) {
    case 'subscription_required':
      return 'Dating likes need an active Plus or trial.';
    case 'dating_not_enabled':
      return 'Turn on discovery in Prefs first.';
    case 'birth_year_required':
      return 'Add your birth year in Prefs before liking or passing.';
    case 'blocked':
      return "You can't interact with this person.";
    case 'rate_limited':
      return 'Slow down — try again in a minute.';
    case 'target_unavailable':
      return 'This person is no longer available.';
    default:
      return 'Please try again.';
  }
};

const DatingScreen = ({ navigation }) => {
  const { uid, user: authUser, getDisplayName } = useAuth();
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
  const [chatBusyId, setChatBusyId] = useState(null);

  const [bioDraft, setBioDraft] = useState('');
  const [birthYearDraft, setBirthYearDraft] = useState('');
  const [selectedPromptIds, setSelectedPromptIds] = useState([]);
  const [promptAnswers, setPromptAnswers] = useState({});

  useEffect(() => {
    if (!prefs) return;
    setBioDraft(prefs.bio || '');
    setBirthYearDraft(prefs.birthYear != null ? String(prefs.birthYear) : '');
    const ids = (prefs.prompts || []).map((p) => p.id);
    setSelectedPromptIds(ids);
    const answers = {};
    (prefs.prompts || []).forEach((p) => {
      if (p?.id) answers[p.id] = p.answer || '';
    });
    setPromptAnswers(answers);
  }, [prefs]);

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
      if (canParticipateInDiscover(p)) {
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

  const savePrefsPatch = useCallback(
    async (patch, { refreshCards = false } = {}) => {
      if (!uid || busy) return null;
      setBusy(true);
      try {
        const next = await setDatingPrefs(uid, patch);
        setPrefs(next);
        if (refreshCards && canParticipateInDiscover(next)) {
          await refreshDiscovery();
        }
        return next;
      } catch (e) {
        Alert.alert("Couldn't save", e?.message || 'Please try again.');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [uid, busy, refreshDiscovery],
  );

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
      if (value && !(prefs?.birthYear != null && Number(prefs.birthYear) > 0)) {
        Alert.alert('Birth year required', 'Add your birth year below before joining Discover.');
        return;
      }
      setBusy(true);
      try {
        const next = await setDatingOptIn(uid, value);
        setPrefs(next);
        if (canParticipateInDiscover(next)) {
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
    [uid, busy, prefs?.adultConfirmed, prefs?.birthYear, refreshDiscovery],
  );

  const onSaveBio = useCallback(async () => {
    await savePrefsPatch({ bio: bioDraft });
  }, [savePrefsPatch, bioDraft]);

  const onSaveBirthYear = useCallback(async () => {
    const trimmed = birthYearDraft.trim();
    if (!trimmed) {
      if (prefs?.optedIn) {
        Alert.alert('Birth year required', 'Turn off Show me in Dating before clearing your birth year.');
        return;
      }
      await savePrefsPatch({ birthYear: null });
      return;
    }
    const year = Number(trimmed);
    if (!Number.isFinite(year) || String(Math.round(year)).length !== 4) {
      Alert.alert('Check birth year', 'Enter a four-digit year (self-report, no ID check).');
      return;
    }
    await savePrefsPatch({ birthYear: year }, { refreshCards: true });
  }, [savePrefsPatch, birthYearDraft, prefs?.optedIn]);

  const togglePromptSelection = useCallback((id) => {
    setSelectedPromptIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= PROMPT_MAX) {
        Alert.alert('Limit reached', 'Pick up to ' + PROMPT_MAX + ' prompts.');
        return prev;
      }
      return [...prev, id];
    });
  }, []);

  const onSavePrompts = useCallback(async () => {
    const prompts = selectedPromptIds
      .map((id) => {
        const opt = DATING_PROMPT_OPTIONS.find((p) => p.id === id);
        const answer = (promptAnswers[id] || '').trim();
        if (!opt || !answer) return null;
        return { id, question: opt.question, answer };
      })
      .filter(Boolean);
    await savePrefsPatch({ prompts });
  }, [savePrefsPatch, selectedPromptIds, promptAnswers]);

  const onToggleUseProfilePhoto = useCallback(
    async (value) => {
      await savePrefsPatch({ useProfilePhoto: value });
    },
    [savePrefsPatch],
  );

  const onSelectGender = useCallback(
    async (id) => {
      await savePrefsPatch({ gender: id });
    },
    [savePrefsPatch],
  );

  const onAdjustAge = useCallback(
    async (field, delta) => {
      const curMin = prefs?.ageMin ?? AGE_MIN_FLOOR;
      const curMax = prefs?.ageMax ?? AGE_MAX_CEIL;
      let ageMin = curMin;
      let ageMax = curMax;
      if (field === 'min') ageMin = Math.max(AGE_MIN_FLOOR, Math.min(AGE_MAX_CEIL, curMin + delta));
      else ageMax = Math.max(AGE_MIN_FLOOR, Math.min(AGE_MAX_CEIL, curMax + delta));
      if (ageMin > ageMax) {
        if (field === 'min') ageMax = ageMin;
        else ageMin = ageMax;
      }
      await savePrefsPatch({ ageMin, ageMax }, { refreshCards: true });
    },
    [prefs?.ageMin, prefs?.ageMax, savePrefsPatch],
  );

  const onToggleLookingFor = useCallback(
    async (id) => {
      const current = Array.isArray(prefs?.lookingFor) ? prefs.lookingFor : [];
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      await savePrefsPatch({ lookingFor: next }, { refreshCards: true });
    },
    [prefs?.lookingFor, savePrefsPatch],
  );

  const captureGeo = useCallback(async () => {
    const res = await getCurrentGeo();
    if (!res.ok) {
      const msg =
        res.reason === 'denied'
          ? 'Allow location access to filter by distance.'
          : 'Location is unavailable right now.';
      Alert.alert('Location needed', msg);
      return null;
    }
    return res.geo;
  }, []);

  const onUpdateLocation = useCallback(async () => {
    const geo = await captureGeo();
    if (!geo) return;
    await savePrefsPatch(
      {
        geoLat: geo.lat,
        geoLon: geo.lon,
        geoUpdatedAt: Date.now(),
      },
      { refreshCards: true },
    );
  }, [captureGeo, savePrefsPatch]);

  const onSelectDistance = useCallback(
    async (km) => {
      if (km == null) {
        await savePrefsPatch({ maxDistanceKm: null }, { refreshCards: true });
        return;
      }
      const geo = await captureGeo();
      if (!geo) return;
      await savePrefsPatch(
        {
          maxDistanceKm: km,
          geoLat: geo.lat,
          geoLon: geo.lon,
          geoUpdatedAt: Date.now(),
        },
        { refreshCards: true },
      );
    },
    [captureGeo, savePrefsPatch],
  );

  const current = cards[cardIndex] || null;

  const advanceCard = useCallback(() => {
    setCardIndex((i) => Math.min(i + 1, cards.length));
  }, [cards.length]);

  const passCard = useCallback(async () => {
    if (!uid || !current || actionBusy) return;
    setActionBusy(true);
    try {
      const result = await recordPass(uid, current.id);
      if (!result.ok) {
        Alert.alert("Couldn't pass", datingActionError(result.code));
        return;
      }
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
        Alert.alert("Couldn't like", datingActionError(result.code));
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

  const openMatchChat = useCallback(
    async (item) => {
      if (!item || chatBusyId) return;

      const otherUserId = item.otherUserId || item.id;
      if (!otherUserId || item.unavailable) {
        Alert.alert(
          'Unavailable',
          'This person is no longer on Blyp, so chat cannot be opened.',
        );
        return;
      }

      if (!uid) {
        Alert.alert('Sign in required', 'Please sign in to start a chat.');
        return;
      }

      try {
        setChatBusyId(item.matchId || otherUserId);

        if (!__DEV__) {
          try {
            await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
          } catch (e) {
            const code = e?.code || e?.name || 'FIREBASE_AUTH_ERROR';
            const msg = e?.message || String(e);
            const status = typeof e?.status === 'number' ? ` (HTTP ${e.status})` : '';
            console.error('[CHAT][AUTH] Firebase auth bridge not ready', {
              code,
              msg,
              status,
              detail: e?.detail,
              url: e?.url,
            });
            Alert.alert(
              'Auth Error',
              `Cannot start chat until Firebase auth is ready.\n\n${code}${status}\n${msg}`,
            );
            return;
          }
        }

        const meName =
          (typeof getDisplayName === 'function' ? getDisplayName() : null) ||
          authUser?.displayName ||
          authUser?.username ||
          authUser?.email ||
          'Unknown';
        const otherName = item.displayName || item.username || 'Unknown';
        const otherUser = {
          id: otherUserId,
          username: item.username || null,
          displayName: otherName,
          photoURL: item.photoURL || null,
          avatar: item.photoURL || null,
        };

        const conversationId = await conversationsMessagingService.createOrGetDirectThread(
          db,
          uid,
          otherUserId,
          meName,
          otherName,
        );

        navigation.navigate('ChatConversation', {
          conversationId,
          chatId: conversationId,
          otherUser,
        });
      } catch (error) {
        console.error('Error starting chat from dating match:', error);
        Alert.alert('Error', 'Failed to start chat. Please try again.');
      } finally {
        setChatBusyId(null);
      }
    },
    [uid, chatBusyId, getDisplayName, authUser, navigation],
  );

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

  const showCardStack = canParticipateInDiscover(prefs) && current;
  const lookingFor = Array.isArray(prefs.lookingFor) ? prefs.lookingFor : [];
  const needsBirthYear = !!prefs.optedIn && !(prefs.birthYear != null && Number(prefs.birthYear) > 0);

  const renderMatch = ({ item }) => {
    const rowKey = item.matchId || item.id;
    const opening = chatBusyId === rowKey;
    const unavailable = !!item.unavailable || !(item.otherUserId || item.id);
    return (
      <TouchableOpacity
        style={[styles.matchRow, unavailable && styles.matchRowMuted]}
        onPress={() => openMatchChat(item)}
        activeOpacity={0.85}
        disabled={!!chatBusyId}
        accessibilityRole="button"
        accessibilityLabel={
          unavailable
            ? 'Match unavailable'
            : 'Message ' + (item.displayName || 'match')
        }
      >
        {item.photoURL && !unavailable ? (
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
        {opening ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : unavailable ? (
          <Text style={styles.matchUnavailable}>Unavailable</Text>
        ) : (
          <Icon name="chatbubble-outline" size={20} color={COLORS.primary} />
        )}
      </TouchableOpacity>
    );
  };

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
            ) : needsBirthYear ? (
              <View style={styles.emptyBlock}>
                <Icon name="calendar-outline" size={32} color={COLORS.textMuted} />
                <Text style={styles.emptyTitle}>Birth year needed</Text>
                <Text style={styles.emptyBody}>
                  Discover needs a self-reported birth year (18+). No government ID — just your year so age filters work.
                </Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => setTab('prefs')}>
                  <Text style={styles.primaryBtnText}>Add birth year</Text>
                </TouchableOpacity>
              </View>
            ) : showCardStack ? (
              <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
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
                  <Text style={styles.personName}>
                    {current.displayName}
                    {current.age != null ? ', ' + current.age : ''}
                  </Text>
                  {current.bio ? (
                    <Text style={styles.personBio}>{current.bio}</Text>
                  ) : (
                    <Text style={styles.personTagline}>{current.tagline}</Text>
                  )}
                  {(current.prompts || []).length > 0 && (
                    <View style={styles.promptBubbleWrap}>
                      {current.prompts.map((p) => (
                        <View key={p.id} style={styles.promptBubble}>
                          <Text style={styles.promptQuestion}>{p.question}</Text>
                          <Text style={styles.promptAnswer}>{p.answer}</Text>
                        </View>
                      ))}
                    </View>
                  )}
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
              </ScrollView>
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
                  When someone you like likes you back, they will show up here. Tap a match to open Messenger.
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
          <ScrollView style={styles.panel} contentContainerStyle={styles.prefsPad} keyboardShouldPersistTaps="handled">
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

            <View style={styles.prefSection}>
              <Text style={styles.sectionTitle}>Short bio</Text>
              <TextInput
                style={styles.textInput}
                value={bioDraft}
                onChangeText={setBioDraft}
                placeholder="Say a little about yourself…"
                placeholderTextColor={COLORS.textMuted}
                multiline
                maxLength={BIO_MAX}
              />
              <Text style={styles.charCount}>
                {bioDraft.length}/{BIO_MAX}
              </Text>
              <TouchableOpacity
                style={[styles.saveBtn, busy && styles.btnDisabled]}
                onPress={onSaveBio}
                disabled={busy}
              >
                <Text style={styles.saveBtnText}>Save bio</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.prefSection}>
              <Text style={styles.sectionTitle}>Birth year (required for Discover)</Text>
              <Text style={styles.prefBody}>
                Self-report only — used for age on your card and filters. No ID verification.
              </Text>
              <TextInput
                style={styles.textInputSingle}
                value={birthYearDraft}
                onChangeText={setBirthYearDraft}
                placeholder="e.g. 1995"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="number-pad"
                maxLength={4}
              />
              <TouchableOpacity
                style={[styles.saveBtn, busy && styles.btnDisabled]}
                onPress={onSaveBirthYear}
                disabled={busy}
              >
                <Text style={styles.saveBtnText}>Save birth year</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.prefSection}>
              <Text style={styles.sectionTitle}>Prompts (up to {PROMPT_MAX})</Text>
              <View style={styles.chipRow}>
                {DATING_PROMPT_OPTIONS.map((p) => {
                  const selected = selectedPromptIds.includes(p.id);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.optionChip, selected && styles.optionChipActive]}
                      onPress={() => togglePromptSelection(p.id)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.optionChipText, selected && styles.optionChipTextActive]} numberOfLines={2}>
                        {p.question}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {selectedPromptIds.map((id) => {
                const opt = DATING_PROMPT_OPTIONS.find((p) => p.id === id);
                if (!opt) return null;
                return (
                  <View key={id} style={styles.promptEditBlock}>
                    <Text style={styles.promptEditLabel}>{opt.question}</Text>
                    <TextInput
                      style={styles.textInputSingle}
                      value={promptAnswers[id] || ''}
                      onChangeText={(t) => setPromptAnswers((prev) => ({ ...prev, [id]: t }))}
                      placeholder="Your answer…"
                      placeholderTextColor={COLORS.textMuted}
                      maxLength={120}
                    />
                  </View>
                );
              })}
              <TouchableOpacity
                style={[styles.saveBtn, busy && styles.btnDisabled]}
                onPress={onSavePrompts}
                disabled={busy}
              >
                <Text style={styles.saveBtnText}>Save prompts</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.prefRow}>
              <View style={styles.prefCopy}>
                <Text style={styles.prefTitle}>Use profile photo</Text>
                <Text style={styles.prefBody}>Show your main Blyp avatar on your Dating card.</Text>
              </View>
              <Switch
                value={prefs.useProfilePhoto !== false}
                onValueChange={onToggleUseProfilePhoto}
                disabled={busy}
                trackColor={{ false: COLORS.backgroundLight, true: COLORS.primaryDark }}
                thumbColor={prefs.useProfilePhoto !== false ? COLORS.primary : COLORS.textMuted}
              />
            </View>

            <View style={styles.prefSection}>
              <Text style={styles.sectionTitle}>I am</Text>
              <View style={styles.chipRow}>
                {DATING_GENDER_OPTIONS.map((g) => {
                  const active = prefs.gender === g.id;
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={[styles.optionChip, active && styles.optionChipActive]}
                      onPress={() => onSelectGender(g.id)}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>{g.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.prefSection}>
              <Text style={styles.sectionTitle}>Discover filters</Text>

              <Text style={styles.filterLabel}>Age range</Text>
              <View style={styles.stepperRow}>
                <View style={styles.stepperBlock}>
                  <Text style={styles.stepperLabel}>Min</Text>
                  <View style={styles.stepperControls}>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => onAdjustAge('min', -1)}
                      disabled={busy}
                    >
                      <Icon name="remove" size={18} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{prefs.ageMin ?? AGE_MIN_FLOOR}</Text>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => onAdjustAge('min', 1)}
                      disabled={busy}
                    >
                      <Icon name="add" size={18} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.stepperBlock}>
                  <Text style={styles.stepperLabel}>Max</Text>
                  <View style={styles.stepperControls}>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => onAdjustAge('max', -1)}
                      disabled={busy}
                    >
                      <Icon name="remove" size={18} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{prefs.ageMax ?? AGE_MAX_CEIL}</Text>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => onAdjustAge('max', 1)}
                      disabled={busy}
                    >
                      <Icon name="add" size={18} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <Text style={styles.filterLabel}>Looking for</Text>
              <View style={styles.chipRow}>
                {DATING_GENDER_OPTIONS.map((g) => {
                  const active = lookingFor.includes(g.id);
                  return (
                    <TouchableOpacity
                      key={'lf-' + g.id}
                      style={[styles.optionChip, active && styles.optionChipActive]}
                      onPress={() => onToggleLookingFor(g.id)}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>{g.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.filterLabel}>Max distance</Text>
              <View style={styles.chipRow}>
                {DISTANCE_OPTIONS_KM.map((km) => {
                  const active =
                    (prefs.maxDistanceKm == null && km == null) || prefs.maxDistanceKm === km;
                  return (
                    <TouchableOpacity
                      key={'dist-' + String(km)}
                      style={[styles.optionChip, active && styles.optionChipActive]}
                      onPress={() => onSelectDistance(km)}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>
                        {distanceLabel(km)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {prefs.maxDistanceKm != null && prefs.maxDistanceKm > 0 && (
                <TouchableOpacity
                  style={[styles.secondaryBtn, busy && styles.btnDisabled]}
                  onPress={onUpdateLocation}
                  disabled={busy}
                >
                  <Text style={styles.secondaryBtnText}>Update location</Text>
                </TouchableOpacity>
              )}
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
        surface="dating"
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
  prefsPad: { paddingBottom: 40, gap: 12 },
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

  cardScroll: { paddingBottom: 24, gap: 20 },
  personCard: {
    borderRadius: 20,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 24,
    alignItems: 'center',
    gap: 10,
    minHeight: responsiveSize(280),
  },
  avatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 4,
    backgroundColor: COLORS.primaryDark,
  },
  avatarLetter: { color: COLORS.textPrimary, fontSize: responsiveFont(36), fontWeight: '800' },
  personName: { color: COLORS.textPrimary, fontSize: responsiveFont(22), fontWeight: '800' },
  personBio: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(14),
    textAlign: 'center',
    lineHeight: 20,
  },
  personTagline: { color: COLORS.textSecondary, fontSize: responsiveFont(14), textAlign: 'center', lineHeight: 20 },
  promptBubbleWrap: { width: '100%', gap: 8, marginTop: 4 },
  promptBubble: {
    width: '100%',
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,210,190,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.2)',
    gap: 4,
  },
  promptQuestion: { color: COLORS.primary, fontSize: responsiveFont(12), fontWeight: '700' },
  promptAnswer: { color: COLORS.textPrimary, fontSize: responsiveFont(14), lineHeight: 18 },

  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 8,
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
  matchRowMuted: { opacity: 0.72 },
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
  matchUnavailable: { color: COLORS.textMuted, fontSize: responsiveFont(12), fontWeight: '600' },

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
  prefSection: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  sectionTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700' },
  filterLabel: { color: COLORS.textSecondary, fontSize: responsiveFont(13), fontWeight: '600', marginTop: 4 },
  textInput: {
    minHeight: 88,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundLight || 'rgba(0,0,0,0.2)',
    color: COLORS.textPrimary,
    fontSize: responsiveFont(14),
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  textInputSingle: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundLight || 'rgba(0,0,0,0.2)',
    color: COLORS.textPrimary,
    fontSize: responsiveFont(14),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  charCount: { color: COLORS.textMuted, fontSize: responsiveFont(11), textAlign: 'right' },
  saveBtn: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primaryDark,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  saveBtnText: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundLight || 'rgba(0,0,0,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    maxWidth: '100%',
  },
  optionChipActive: {
    backgroundColor: COLORS.primaryDark,
    borderColor: COLORS.primary,
  },
  optionChipText: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '600' },
  optionChipTextActive: { color: COLORS.textPrimary },
  promptEditBlock: { gap: 6 },
  promptEditLabel: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '600' },
  stepperRow: { flexDirection: 'row', gap: 16 },
  stepperBlock: { flex: 1, gap: 6 },
  stepperLabel: { color: COLORS.textMuted, fontSize: responsiveFont(12), fontWeight: '600' },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.backgroundLight || 'rgba(0,0,0,0.15)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '800' },
  prefNote: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(0,210,190,0.08)',
  },
  prefNoteText: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: 18 },
});

export default DatingScreen;
