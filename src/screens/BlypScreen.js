// BlypScreen.js
//
// The "blyp it" surface — Blyp's AI front door. A user asks anything (typed or
// spoken) and gets a concise Gemini answer plus blended, real in-app results
// (creators + posts). Tapping a result routes into the live app.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Speech from 'expo-speech';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import BlypItModal from '../components/BlypItModal';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { blypContent, blypAnswer, postThumbnail, isBlypAiAvailable } from '../services/blypAiService';
import speechToTextService from '../services/speechToTextService';
import geminiSpeechService from '../services/geminiSpeechService';
import { useAuth } from '../hooks/useCommon';
import { useHasAI } from '../hooks/useEntitlement';
import {
  getPreferences,
  addRecentSearch,
  clearRecentSearches,
} from '../services/userPreferencesService';
import { subscribeBookmarks, toggleBookmark } from '../services/bookmarkService';
import { sharePost, shareBlyp } from '../services/shareService';
import { reportSearchEvent } from '../services/blypSearchClient';
import {
  resolveReminder,
  createReminder,
  rescheduleReminder,
  removeReminder,
  isMultiReminderRequest,
  planReminders,
  formatLead,
} from '../services/reminderService';
import ReminderEditSheet from '../components/ReminderEditSheet';
import LocationPermissionOverlay from '../components/LocationPermissionOverlay';
import { resolveWatch, findUsersByName, addWatch, watchTypeLabel } from '../services/userWatchService';
import { resolveEventWatch, addEventWatch, eventWatchLabel } from '../services/eventWatchService';
import { needsLocationForQuery } from '../services/locationService';
import { resolveBattle } from '../services/battleIntentService';

const SUGGESTIONS = [
  "What's worth watching tonight?",
  'Find funny football clips',
  'Show me cooking creators',
  'What can I do on Blyp?',
  'Live streams right now',
];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'creators', label: 'Creators' },
  { key: 'videos', label: 'Videos' },
  { key: 'audio', label: 'Audio' },
];

const formatBattleWhen = (ms) => {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const isVideoPost = (p) => p.type === 'video' || !!p?.media?.[0]?.type?.includes?.('video') || !!p.videoUrl;
const isAudioPost = (p) => p.type === 'audio' || !!p.audioUrl;

const BlypScreen = ({ navigation, route }) => {
  const { uid } = useAuth();
  const aiEntitled = useHasAI();
  const [query, setQuery] = useState(route?.params?.initialQuery || '');
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState([]);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recent, setRecent] = useState([]);
  const [filter, setFilter] = useState('all');
  const [savedIds, setSavedIds] = useState(new Set());
  const [blypItVisible, setBlypItVisible] = useState(false);
  const [editReminder, setEditReminder] = useState(null);
  const [locationPrompt, setLocationPrompt] = useState(null);
  const [speakingTurnId, setSpeakingTurnId] = useState(null);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const turnsRef = useRef([]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    // Stop any in-progress read-aloud when leaving the screen.
    return () => {
      try {
        Speech.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const stopSpeaking = useCallback(() => {
    try {
      Speech.stop();
    } catch {
      /* ignore */
    }
    setSpeakingTurnId(null);
  }, []);

  const speakAnswer = useCallback((turnId, text) => {
    const clean = String(text || '')
      .replace(/[`*_#>]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return;
    try {
      Speech.stop();
    } catch {
      /* ignore */
    }
    setSpeakingTurnId(turnId);
    Speech.speak(clean.slice(0, 4000), {
      language: 'en-GB',
      rate: 0.96,
      pitch: 1.0,
      onDone: () => setSpeakingTurnId((cur) => (cur === turnId ? null : cur)),
      onStopped: () => setSpeakingTurnId((cur) => (cur === turnId ? null : cur)),
      onError: () => setSpeakingTurnId((cur) => (cur === turnId ? null : cur)),
    });
  }, []);

  const toggleSpeakAnswer = useCallback(
    (turnId, text) => {
      if (speakingTurnId === turnId) {
        stopSpeaking();
        return;
      }
      speakAnswer(turnId, text);
    },
    [speakingTurnId, speakAnswer, stopSpeaking]
  );

  useEffect(() => {
    let active = true;
    getPreferences(uid).then((p) => {
      if (active) setRecent(p.recentSearches || []);
    });
    const unsub = subscribeBookmarks(uid, (list) => {
      setSavedIds(new Set((list || []).map((b) => b.id)));
    });
    return () => {
      active = false;
      unsub();
    };
  }, [uid]);

  const runSearch = useCallback(
    async (text, geo) => {
      const q = String(text ?? '').trim();
      if (!q) return;
      stopSpeaking();

      if (needsLocationForQuery(q) && !geo) {
        setLocationPrompt({ query: q });
        return;
      }

      Keyboard.dismiss();
      setLoading(true);
      setFilter('all');

      const emptyTurn = {
        answer: '', usedAI: false, related: [], posts: [], creators: [], web: [], sources: [],
      };

      // Push an action turn (watch/battle/pick card) and reset the bar.
      const commitTurn = async (payload) => {
        setTurns((prev) => [
          ...prev,
          { id: `t_${Date.now()}`, query: q, ...emptyTurn, ...payload },
        ]);
        setQuery('');
        try {
          const updated = await addRecentSearch(uid, q);
          if (updated) setRecent(updated.recentSearches || []);
        } catch { /* ignore */ }
        setLoading(false);
        setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50);
      };

      // Battle: "arrange a battle between me and <person> for next Friday 8".
      const battle = await resolveBattle(q);
      if (battle.isBattle) {
        const candidates = battle.opponentName ? await findUsersByName(battle.opponentName, uid, 6) : [];
        if (candidates.length === 1) {
          navigation.navigate('CreateBattle', {
            opponent: candidates[0],
            startAt: battle.startAt || undefined,
            prefillTitle: battle.title || '',
          });
          await commitTurn({ battle: { status: 'opened', name: candidates[0].displayName, startAt: battle.startAt || null } });
        } else if (candidates.length > 1) {
          await commitTurn({ pick: { action: 'battle', candidates, startAt: battle.startAt || null, title: battle.title || '' } });
        } else {
          navigation.navigate('CreateBattle', {
            startAt: battle.startAt || undefined,
            prefillTitle: battle.title || '',
          });
          await commitTurn({ battle: { status: 'pick', name: battle.opponentName || '', startAt: battle.startAt || null } });
        }
        return;
      }

      // Event watch: "notify me when there's a battle".
      const eventWatch = await resolveEventWatch(q);
      if (eventWatch.isEventWatch) {
        const rec = await addEventWatch(uid, eventWatch.type);
        await commitTurn({
          eventWatch: {
            ok: !!rec,
            type: eventWatch.type,
          },
        });
        return;
      }

      // Watch: "notify me when <person> is next live / next on the app".
      const watch = await resolveWatch(q);
      if (watch.isWatch) {
        const candidates = await findUsersByName(watch.targetName, uid, 6);
        if (candidates.length === 1) {
          await addWatch(uid, candidates[0], watch.type);
          await commitTurn({ watch: { found: true, name: candidates[0].displayName, type: watch.type } });
        } else if (candidates.length > 1) {
          await commitTurn({ pick: { action: 'watch', candidates, watchType: watch.type } });
        } else {
          await commitTurn({ watch: { found: false, name: watch.targetName, type: watch.type } });
        }
        return;
      }

      // Multi-event plan: "set a reminder for every Arsenal match, an hour before".
      if (isMultiReminderRequest(q)) {
        const plan = await planReminders(q);
        if (plan?.isPlan && plan.events.length) {
          const recs = [];
          for (const ev of plan.events) {
            // eslint-disable-next-line no-await-in-loop
            const { rec } = await createReminder(uid, { task: ev.task, event: ev.when, leadMinutes: plan.leadMinutes });
            recs.push(rec);
          }
          setTurns((prev) => [
            ...prev,
            { id: `t_${Date.now()}`, query: q, ...emptyTurn, reminders: recs, planNote: plan.note },
          ]);
          setQuery('');
          try {
            const updated = await addRecentSearch(uid, q);
            if (updated) setRecent(updated.recentSearches || []);
          } catch { /* ignore */ }
          setLoading(false);
          setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50);
          return;
        }
      }

      // Single reminder ("remind me to buy potatoes tomorrow") becomes a real
      // scheduled notification instead of an AI search.
      const reminder = await resolveReminder(q);
      if (reminder.isReminder) {
        const { rec, sched } = await createReminder(uid, {
          task: reminder.task,
          event: reminder.when,
          leadMinutes: 0,
        });
        setTurns((prev) => [
          ...prev,
          {
            id: `t_${Date.now()}`,
            query: q,
            ...emptyTurn,
            reminder: rec,
            reminderOk: !!sched?.ok,
            reminderReason: sched?.reason,
          },
        ]);
        setQuery('');
        try {
          const updated = await addRecentSearch(uid, q);
          if (updated) setRecent(updated.recentSearches || []);
        } catch {
          /* ignore */
        }
        setLoading(false);
        setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50);
        return;
      }

      // Capture conversation history BEFORE we push this turn.
      const history = turnsRef.current.map((t) => ({ q: t.query, a: t.answer || '' }));
      // Only spend a Gemini call when the user can actually see the answer.
      const wantAnswer = aiEntitled && isBlypAiAvailable();
      const turnId = `t_${Date.now()}`;
      try {
        // 1) Show real in-app results immediately — no waiting on the AI.
        const content = await blypContent(q, { geo });
        setTurns((prev) => [
          ...prev,
          { id: turnId, ...content, answer: '', usedAI: false, related: [], web: [], answering: wantAnswer },
        ]);
        setQuery('');
        setLoading(false);
        setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50);
        try {
          const updated = await addRecentSearch(uid, q);
          if (updated) setRecent(updated.recentSearches || []);
        } catch { /* ignore */ }

        // 2) Stream the conversational answer in afterwards (Plus only).
        if (wantAnswer) {
          blypAnswer(q, { history, posts: content.posts, creators: content.creators })
            .then((ans) => {
              const answerText = ans.text || '';
              setTurns((prev) =>
                prev.map((t) =>
                  t.id === turnId
                    ? {
                        ...t,
                        answer: answerText,
                        usedAI: ans.usedAI,
                        related: ans.related || [],
                        intent: ans.intent || t.intent,
                        answering: false,
                      }
                    : t
                )
              );
              // Auto-TTS off by default — user taps the speaker to hear answers.
            })
            .catch(() => {
              setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, answering: false } : t)));
            });
        }
      } catch (e) {
        setTurns((prev) => [
          ...prev,
          { id: turnId, query: q, answer: '', usedAI: false, related: [], posts: [], creators: [], sources: [], answering: false },
        ]);
        setLoading(false);
        setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50);
      }
    },
    [uid, navigation, aiEntitled, stopSpeaking]
  );

  // The user tapped a candidate on a "which person did you mean?" card. Carry out
  // the original action (open a battle, or set a watch) for the chosen person and
  // resolve the card in place.
  const onPickPerson = useCallback(
    async (turnId, pick, person) => {
      if (pick.action === 'battle') {
        navigation.navigate('CreateBattle', {
          opponent: person,
          startAt: pick.startAt || undefined,
          prefillTitle: pick.title || '',
        });
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? { ...t, pick: null, battle: { status: 'opened', name: person.displayName, startAt: pick.startAt || null } }
              : t
          )
        );
        return;
      }
      // watch
      await addWatch(uid, person, pick.watchType);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? { ...t, pick: null, watch: { found: true, name: person.displayName, type: pick.watchType } }
            : t
        )
      );
    },
    [uid, navigation]
  );

  const clearChat = () => {
    setTurns([]);
    setQuery('');
    setFilter('all');
  };

  // Auto-run a query passed via navigation (e.g. "Ask Blyp about X").
  const ranInitial = useRef(false);
  useEffect(() => {
    const q = route?.params?.initialQuery;
    const geo = route?.params?.geo;
    if (q && !ranInitial.current) {
      ranInitial.current = true;
      runSearch(q, geo);
    }
  }, [route?.params?.initialQuery, route?.params?.geo, runSearch]);

  const onLocationGranted = useCallback(
    (geo) => {
      const pending = locationPrompt?.query;
      setLocationPrompt(null);
      if (pending) runSearch(pending, geo);
    },
    [locationPrompt, runSearch]
  );

  const onClearRecent = async () => {
    await clearRecentSearches(uid);
    setRecent([]);
  };

  const onToggleSave = async (post) => {
    await toggleBookmark(uid, post);
  };

  // Reminder editing — applies an updated record back into the relevant turn.
  const applyReminderUpdate = (updated) => {
    setTurns((prev) =>
      prev.map((t) => {
        if (t.reminder && t.reminder.id === updated.id) return { ...t, reminder: updated };
        if (Array.isArray(t.reminders)) return { ...t, reminders: t.reminders.map((r) => (r.id === updated.id ? updated : r)) };
        return t;
      })
    );
  };

  const onChangeLead = async (minutes) => {
    if (!editReminder) return;
    let updated = null;
    try {
      updated = await rescheduleReminder(uid, editReminder.id, minutes);
    } catch {
      /* ignore */
    }
    setEditReminder(null);
    if (updated) applyReminderUpdate(updated);
  };

  const onDeleteEditing = async () => {
    if (!editReminder) return;
    const rem = editReminder;
    setEditReminder(null);
    setTurns((prev) =>
      prev.map((t) => {
        if (t.reminder && t.reminder.id === rem.id) return { ...t, reminder: null };
        if (Array.isArray(t.reminders)) return { ...t, reminders: t.reminders.filter((r) => r.id !== rem.id) };
        return t;
      })
    );
    try {
      await removeReminder(uid, rem.id, rem.notificationId);
    } catch {
      /* ignore */
    }
  };

  const handleSubmit = () => runSearch(query);

  const handleSuggestion = (s) => {
    setQuery(s);
    runSearch(s);
  };

  const startVoice = useCallback(async () => {
    try {
      const ok = await speechToTextService.startRecording(() => {});
      if (ok) setListening(true);
    } catch {
      setListening(false);
    }
  }, []);

  const stopVoice = useCallback(async () => {
    setListening(false);
    setTranscribing(true);
    try {
      const uri = await speechToTextService.stopRecording();
      if (uri) {
        const text = await geminiSpeechService.transcribeAudio(uri);
        const clean = String(text || '').trim();
        // Service returns bracketed error tokens like [NO_KEY] on failure.
        if (clean && !clean.startsWith('[')) {
          setQuery(clean);
          await runSearch(clean);
        }
      }
    } catch (e) {
      console.warn('[BLYP] voice failed', e?.message || String(e));
    } finally {
      setTranscribing(false);
    }
  }, [runSearch]);

  const toggleVoice = () => {
    if (transcribing) return;
    if (!aiEntitled) {
      navigation.navigate('Plans');
      return;
    }
    if (listening) stopVoice();
    else startVoice();
  };

  // Holds the current on-screen video results so opening a video can hand the
  // viewer a playlist of *this search's* videos (tapped one first). That makes
  // swiping up continue through the category results instead of falling back to
  // the creator's own uploads. Kept in a ref so openPost (declared here, above
  // where displayPosts is computed) always sees the latest list.
  const displayPostsRef = useRef([]);

  const openPost = (post) => {
    const src = Array.isArray(displayPostsRef.current) ? displayPostsRef.current : [];
    const vids = src.filter((p) => p && isVideoPost(p));
    const playlist = isVideoPost(post)
      ? [post, ...vids.filter((p) => p && p.id !== post.id)]
      : [];
    if (playlist.length > 1) navigation.navigate('MediaViewer', { post, posts: playlist });
    else navigation.navigate('MediaViewer', { post });
  };
  const openCreator = (user) =>
    navigation.navigate('UserProfile', {
      userId: user.id || user.uid || user.userId,
      username: user.username || user.displayName || '@user',
    });
  const openWeb = (url, title, meta = {}) => {
    const clean = String(url || '').trim();
    if (!clean) return;
    // Corpus signal: a click is first-party data we own. Feed it back so Blyp
    // learns which results actually satisfy a query (and grows its own index).
    reportSearchEvent({
      type: 'click',
      query: lastTurn?.query || query,
      url: clean,
      provider: meta.provider,
      position: meta.position,
    });
    try {
      navigation.navigate('WebBrowser', { url: clean, title, query: lastTurn?.query || query });
    } catch (e) {
      Linking.openURL(clean).catch(() => {});
    }
  };

  const dialPhone = (phone) => {
    const clean = String(phone || '').replace(/[^+\d]/g, '');
    if (!clean) return;
    Linking.openURL(`tel:${clean}`).catch(() => {});
  };

  const renderCreator = ({ item }) => {
    const avatar = item.avatar || item.photoURL || item.userPhotoURL;
    const initial = (item.displayName || item.username || '?').slice(0, 1).toUpperCase();
    return (
      <TouchableOpacity style={styles.creatorCard} activeOpacity={0.85} onPress={() => openCreator(item)}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.creatorAvatar} />
        ) : (
          <View style={[styles.creatorAvatar, styles.creatorAvatarFallback]}>
            <Text style={styles.creatorInitial}>{initial}</Text>
          </View>
        )}
        <Text style={styles.creatorName} numberOfLines={1}>
          @{item.username || item.displayName || 'user'}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderPost = (post, carousel = false) => {
    const uri = postThumbnail(post);
    const title = post.title || post.captionTitle || post.caption || post.description || 'Post';
    const isVideo = isVideoPost(post);
    const saved = savedIds.has(post.id);
    return (
      <TouchableOpacity key={post.id} style={[styles.postCard, carousel && styles.postCardCarousel]} activeOpacity={0.85} onPress={() => openPost(post)}>
        <View style={styles.postThumbWrap}>
          {uri ? (
            <Image source={{ uri }} style={styles.postThumb} resizeMode="cover" />
          ) : (
            <View style={[styles.postThumb, styles.postThumbFallback]}>
              <Icon name="image-outline" size={26} color={COLORS.textMuted} />
            </View>
          )}
          {isVideo && (
            <View style={styles.playBadge}>
              <Icon name="play" size={14} color={COLORS.white} />
            </View>
          )}
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={() => onToggleSave(post)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name={saved ? 'bookmark' : 'bookmark-outline'} size={16} color={saved ? COLORS.primary : COLORS.white} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={() => sharePost(post)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="share-social-outline" size={15} color={COLORS.white} />
          </TouchableOpacity>
        </View>
        <Text style={styles.postTitle} numberOfLines={2}>
          {title}
        </Text>
      </TouchableOpacity>
    );
  };

  const lastTurn = turns.length ? turns[turns.length - 1] : null;
  const allPosts = lastTurn?.posts || [];
  const allCreators = lastTurn?.creators || [];
  const displayCreators = filter === 'all' || filter === 'creators' ? allCreators : [];
  const displayPosts = useMemo(() => {
    if (filter === 'creators') return [];
    if (filter === 'videos') return allPosts.filter(isVideoPost);
    if (filter === 'audio') return allPosts.filter(isAudioPost);
    return allPosts;
  }, [filter, allPosts]);

  // Keep the playlist source in sync for openPost (see ref above).
  useEffect(() => { displayPostsRef.current = displayPosts; }, [displayPosts]);

  const filterCount = (key) => {
    if (key === 'all') return allPosts.length + allCreators.length;
    if (key === 'creators') return allCreators.length;
    if (key === 'videos') return allPosts.filter(isVideoPost).length;
    if (key === 'audio') return allPosts.filter(isAudioPost).length;
    return 0;
  };

  const lastHasResults =
    lastTurn &&
    (lastTurn.posts?.length > 0 ||
      lastTurn.creators?.length > 0 ||
      !!lastTurn.answer ||
      !!lastTurn.answering ||
      !!lastTurn.place ||
      !!lastTurn.reminder ||
      lastTurn.reminders?.length > 0 ||
      !!lastTurn.watch ||
      !!lastTurn.eventWatch ||
      !!lastTurn.battle ||
      !!lastTurn.pick);

  const intent = lastTurn?.intent || 'info';
  const place = lastTurn?.place || null;
  const isPlace = intent === 'place';

  const seeAllPosts = (title) =>
    navigation.navigate('BlypResults', {
      posts: displayPosts,
      title,
      query: lastTurn?.query || '',
    });

  // Actionable contact card for retail/place intent (B&Q, Nando's, etc.).
  // This is the HERO of a place search — the reason someone typed the name is to
  // call, navigate to, or open the website of the business. So it sits right
  // under the search bar with big, obvious action buttons; everything else
  // (the AI "answer", related searches, web results) is secondary.
  const renderPlaceCard = (placeArg) => {
    const p = placeArg || place;
    if (!p) return null;
    const actions = [
      p.phone && { icon: 'call', label: 'Call', onPress: () => dialPhone(p.phone) },
      (p.directionsUrl || p.mapUrl) && {
        icon: 'navigate',
        label: 'Directions',
        onPress: () => openWeb(p.directionsUrl || p.mapUrl, `${p.name} — directions`),
      },
      p.website && { icon: 'globe-outline', label: 'Website', onPress: () => openWeb(p.website, p.name) },
    ].filter(Boolean);
    return (
      <View style={styles.placeCard} key="place">
        <View style={styles.placeHeaderRow}>
          <View style={styles.placePin}>
            <Icon name="location" size={15} color={COLORS.black} />
          </View>
          <Text style={styles.placeName} numberOfLines={2}>{p.name}</Text>
        </View>

        {!!p.address && (
          <TouchableOpacity style={styles.placeInfoRow} activeOpacity={0.7} onPress={() => openWeb(p.mapUrl || p.directionsUrl, p.name)}>
            <Icon name="map-outline" size={15} color={COLORS.textMuted} />
            <Text style={styles.placeAddr} numberOfLines={2}>{p.address}</Text>
          </TouchableOpacity>
        )}
        {!!p.phone && (
          <TouchableOpacity style={styles.placeInfoRow} activeOpacity={0.7} onPress={() => dialPhone(p.phone)}>
            <Icon name="call-outline" size={15} color={COLORS.textMuted} />
            <Text style={styles.placeInfoText}>{p.phone}</Text>
          </TouchableOpacity>
        )}
        {!!p.openingHours && (
          <View style={styles.placeInfoRow}>
            <Icon name="time-outline" size={15} color={COLORS.textMuted} />
            <Text style={styles.placeInfoText} numberOfLines={2}>{p.openingHours}</Text>
          </View>
        )}

        {actions.length > 0 && (
          <View style={styles.placeActions}>
            {actions.map((a) => (
              <TouchableOpacity key={a.label} style={styles.placeActionBtn} activeOpacity={0.85} onPress={a.onPress}>
                <Icon name={a.icon} size={17} color={COLORS.black} />
                <Text style={styles.placeActionBtnText}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderCreatorsSection = () => {
    if (displayCreators.length === 0) return null;
    return (
      <View style={styles.section} key="creators">
        <Text style={styles.sectionTitle}>Creators</Text>
        <FlatList
          data={displayCreators}
          keyExtractor={(item) => String(item.id || item.username)}
          renderItem={renderCreator}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.creatorRow}
        />
      </View>
    );
  };

  // Posts/videos as a left-to-right swipeable carousel + a "See all" that opens
  // a dedicated vertical results feed.
  const renderPostsSection = () => {
    if (displayPosts.length === 0) return null;
    const title = filter === 'videos' ? 'Videos' : filter === 'audio' ? 'Audio' : 'Posts & videos';
    return (
      <View style={styles.section} key="posts">
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {displayPosts.length > 2 && (
            <TouchableOpacity
              style={styles.seeAllBtn}
              activeOpacity={0.8}
              onPress={() => seeAllPosts(title)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.seeAllText}>See all</Text>
              <Icon name="chevron-forward" size={15} color={COLORS.primary} />
            </TouchableOpacity>
          )}
        </View>
        <FlatList
          data={displayPosts}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => renderPost(item, true)}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.postCarouselRow}
        />
      </View>
    );
  };

  // Intent-aware ordering, tuned per scenario:
  //  - place/retail  ("B&Q", "Nando's near me"): contact card → web → posts → creators
  //  - content       ("funny videos", "cooking creators"): posts → creators → web
  //  - info/news     ("Arsenal latest news", "how tall is Everest"): the AI answer
  //    is the headline; web sources come next, then any relevant in-app posts.
  const renderResultSections = () => {
    if (isPlace) {
      // The place card itself is rendered as the hero in renderAnswer (top of
      // the turn). Here we just show any supporting in-app content beneath it.
      return (
        <>
          {renderPostsSection()}
          {renderCreatorsSection()}
        </>
      );
    }
    // Conversational: the AI answer is the hero (rendered above); in-app posts
    // and creators follow. No web-search results.
    return (
      <>
        {renderPostsSection()}
        {renderCreatorsSection()}
      </>
    );
  };

  // The answer card + sources block, rendered once per conversation turn.
  const renderAnswer = (turn) => (
    <View key={`ans_${turn.id}`}>
      <View style={styles.questionBubble}>
        <Text style={styles.questionText}>{turn.query}</Text>
      </View>

      {/* Reminder confirmation — tap to change when it notifies you. */}
      {turn.reminder && (
        <TouchableOpacity
          style={[styles.reminderCard, !turn.reminderOk && styles.reminderCardError]}
          activeOpacity={0.85}
          disabled={!turn.reminderOk}
          onPress={() => setEditReminder(turn.reminder)}
        >
          <View style={[styles.reminderIcon, !turn.reminderOk && styles.reminderIconError]}>
            <Icon name={turn.reminderOk ? 'alarm' : 'alert-circle'} size={18} color={COLORS.black} />
          </View>
          <View style={styles.reminderTextWrap}>
            {turn.reminderOk ? (
              <>
                <Text style={styles.reminderTitle}>Reminder set</Text>
                <Text style={styles.reminderSub}>{turn.reminder.task} · {turn.reminder.eventLabel}</Text>
                <Text style={styles.reminderEditHint}>{formatLead(turn.reminder.leadMinutes)} · tap to change</Text>
              </>
            ) : (
              <>
                <Text style={styles.reminderTitle}>Couldn’t set that reminder</Text>
                <Text style={styles.reminderSub}>
                  {turn.reminderReason === 'permission_denied'
                    ? 'Notifications are turned off — enable them in Settings, then try again.'
                    : turn.reminderReason === 'unavailable'
                    ? 'Reminders need the latest app build.'
                    : 'Something went wrong scheduling it. Please try again.'}
                </Text>
              </>
            )}
          </View>
          {turn.reminderOk && <Icon name="chevron-forward" size={18} color={COLORS.primary} />}
        </TouchableOpacity>
      )}

      {/* Multi-event plan — a reminder per event, each tappable to adjust. */}
      {Array.isArray(turn.reminders) && turn.reminders.length > 0 && (
        <View style={styles.plannerCard}>
          <View style={styles.plannerHeader}>
            <View style={styles.reminderIcon}>
              <Icon name="alarm" size={18} color={COLORS.black} />
            </View>
            <View style={styles.reminderTextWrap}>
              <Text style={styles.reminderTitle}>{turn.reminders.length} reminders set</Text>
              {!!turn.planNote && <Text style={styles.reminderSub}>{turn.planNote}</Text>}
            </View>
          </View>
          {turn.reminders.map((r) => (
            <TouchableOpacity key={r.id} style={styles.plannerRow} activeOpacity={0.85} onPress={() => setEditReminder(r)}>
              <View style={styles.reminderTextWrap}>
                <Text style={styles.plannerTask} numberOfLines={1}>{r.task}</Text>
                <Text style={styles.plannerWhen}>{r.eventLabel} · {formatLead(r.leadMinutes)}</Text>
              </View>
              <Icon name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Watch confirmation — "notify me when <person> is next live / on the app". */}
      {turn.watch && (
        <View style={[styles.reminderCard, !turn.watch.found && styles.reminderCardError]}>
          <View style={[styles.reminderIcon, !turn.watch.found && styles.reminderIconError]}>
            <Icon
              name={turn.watch.found ? (turn.watch.type === 'live' ? 'radio' : 'notifications') : 'alert-circle'}
              size={18}
              color={COLORS.black}
            />
          </View>
          <View style={styles.reminderTextWrap}>
            {turn.watch.found ? (
              <>
                <Text style={styles.reminderTitle}>Alert set</Text>
                <Text style={styles.reminderSub}>
                  I’ll notify you when {turn.watch.name} {turn.watch.type === 'live' ? 'goes live' : 'is next on the app'}.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.reminderTitle}>Couldn’t find that person</Text>
                <Text style={styles.reminderSub}>I couldn’t find anyone called “{turn.watch.name}” on Blyp.</Text>
              </>
            )}
          </View>
        </View>
      )}

      {/* Event watch — "notify me when there's a battle". */}
      {turn.eventWatch && (
        <View style={[styles.reminderCard, !turn.eventWatch.ok && styles.reminderCardError]}>
          <View style={[styles.reminderIcon, !turn.eventWatch.ok && styles.reminderIconError]}>
            <Icon name={turn.eventWatch.ok ? 'flash' : 'alert-circle'} size={18} color={COLORS.black} />
          </View>
          <View style={styles.reminderTextWrap}>
            {turn.eventWatch.ok ? (
              <>
                <Text style={styles.reminderTitle}>Battle alerts on</Text>
                <Text style={styles.reminderSub}>
                  I’ll notify you when {eventWatchLabel(turn.eventWatch.type)}.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.reminderTitle}>Couldn’t set that alert</Text>
                <Text style={styles.reminderSub}>Please try again in a moment.</Text>
              </>
            )}
          </View>
        </View>
      )}

      {/* Battle confirmation — "arrange a battle between me and <person>". */}
      {turn.battle && (
        <View style={styles.reminderCard}>
          <View style={styles.reminderIcon}>
            <Icon name="flash" size={18} color={COLORS.black} />
          </View>
          <View style={styles.reminderTextWrap}>
            {turn.battle.status === 'opened' ? (
              <>
                <Text style={styles.reminderTitle}>Battle ready</Text>
                <Text style={styles.reminderSub}>
                  Setting up a battle with {turn.battle.name}
                  {turn.battle.startAt ? ` for ${formatBattleWhen(turn.battle.startAt)}` : ''}. Confirm the details to send the challenge.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.reminderTitle}>Who do you want to battle?</Text>
                <Text style={styles.reminderSub}>
                  {turn.battle.name
                    ? `I couldn’t find “${turn.battle.name}” on Blyp. Pick your opponent on the next screen`
                    : 'Pick your opponent on the next screen'}
                  {turn.battle.startAt ? ` — I’ve set the time to ${formatBattleWhen(turn.battle.startAt)}.` : '.'}
                </Text>
              </>
            )}
          </View>
        </View>
      )}

      {/* "Did you mean…?" — confirm which person an action refers to. */}
      {turn.pick && Array.isArray(turn.pick.candidates) && (
        <View style={styles.pickCard}>
          <Text style={styles.pickTitle}>
            {turn.pick.action === 'battle'
              ? `Who do you want to battle${turn.pick.startAt ? ` ${formatBattleWhen(turn.pick.startAt)}` : ''}?`
              : `Who should I watch for you (${watchTypeLabel(turn.pick.watchType)})?`}
          </Text>
          {turn.pick.candidates.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.pickRow}
              activeOpacity={0.85}
              onPress={() => onPickPerson(turn.id, turn.pick, c)}
            >
              {c.photoURL ? (
                <Image source={{ uri: c.photoURL }} style={styles.pickAvatar} />
              ) : (
                <View style={[styles.pickAvatar, styles.pickAvatarFallback]}>
                  <Text style={styles.pickAvatarInitial}>{String(c.displayName || '?').charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.pickName} numberOfLines={1}>{c.displayName}</Text>
                {!!c.username && <Text style={styles.pickUsername} numberOfLines={1}>@{c.username}</Text>}
              </View>
              <Icon name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Hero: for a place/business, the actionable contact card comes first. */}
      {turn.intent === 'place' && turn.place && renderPlaceCard(turn.place)}

      {/* AI answer is streaming in after the (already shown) results. */}
      {aiEntitled && turn.answering && !turn.answer && (
        <View style={styles.answerThinking}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.answerThinkingText}>Blyp is thinking…</Text>
        </View>
      )}

      {!aiEntitled && !!turn.answer && (
        <TouchableOpacity style={styles.answerUpsell} activeOpacity={0.85} onPress={() => navigation.navigate('Plans')}>
          <Icon name="sparkles" size={13} color={COLORS.primary} />
          <Text style={styles.answerUpsellText}>Blyp AI answers are a Plus feature. Your results below are real and complete.</Text>
          <Text style={styles.answerUpsellCta}>See plans</Text>
        </TouchableOpacity>
      )}

      {aiEntitled && !!turn.answer && (
        <View style={styles.answerBlock}>
          <View style={styles.answerHeader}>
            <Icon name="sparkles" size={11} color={COLORS.textMuted} />
            <Text style={styles.answerHeaderText}>Blyp answer</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={styles.answerShareBtn}
              onPress={() => toggleSpeakAnswer(turn.id, turn.answer)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={speakingTurnId === turn.id ? 'Stop reading aloud' : 'Read aloud'}
            >
              <Icon
                name={speakingTurnId === turn.id ? 'stop-circle' : 'volume-high-outline'}
                size={15}
                color={speakingTurnId === turn.id ? COLORS.primary : COLORS.textMuted}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.answerShareBtn}
              onPress={() => shareBlyp(turn.query, turn.answer)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="share-social-outline" size={14} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={styles.answerText}>{turn.answer}</Text>
          {turn.related?.length > 0 && (
            <View style={styles.relatedWrap}>
              {turn.related.map((r) => (
                <TouchableOpacity key={r} style={styles.relatedChip} activeOpacity={0.8} onPress={() => runSearch(r)}>
                  <Text style={styles.relatedText} numberOfLines={1}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}
      {turn.sources?.length > 0 && (
        <View style={styles.sourcesWrap}>
          <Text style={styles.sourcesLabel}>Sources on Blyp</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sourcesRow}>
            {turn.sources.map((s, idx) => {
              const isCreator = s.type === 'creator';
              const label = isCreator
                ? `@${s.item.username || s.item.displayName || 'user'}`
                : s.item.title || s.item.caption || s.item.description || 'Post';
              return (
                <TouchableOpacity
                  key={`${s.type}_${s.item.id || idx}`}
                  style={styles.sourceChip}
                  activeOpacity={0.85}
                  onPress={() => (isCreator ? openCreator(s.item) : openPost(s.item))}
                >
                  <Icon name={isCreator ? 'person-circle-outline' : 'play-circle-outline'} size={14} color={COLORS.primary} />
                  <Text style={styles.sourceChipText} numberOfLines={1}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );

  return (
    <ScreenContainer>
      <View style={styles.container}>
        {/* Top bar */}
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>blyp it</Text>
          {turns.length > 0 ? (
            <TouchableOpacity style={styles.newChatBtn} onPress={clearChat} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="create-outline" size={15} color={COLORS.primary} />
              <Text style={styles.newChatText}>New</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.backBtn} />
          )}
        </View>

        {/* The Blyp bar */}
        <View style={styles.blypBar}>
          <Text style={styles.blypMark}>blyp</Text>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={turns.length > 0 ? 'ask a follow-up…' : 'ask anything…'}
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="search"
            onSubmitEditing={handleSubmit}
            autoFocus={!route?.params?.initialQuery}
            allowFontScaling={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close-circle" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.micBtn, listening && styles.micBtnActive]}
            onPress={toggleVoice}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {transcribing ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Icon name={listening ? 'stop' : 'mic'} size={18} color={listening ? COLORS.black : COLORS.primary} />
            )}
          </TouchableOpacity>
        </View>

        {listening && <Text style={styles.listeningHint}>Listening… tap stop when you're done</Text>}

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Empty / suggestions */}
          {turns.length === 0 && !loading && (
            <View style={styles.suggestWrap}>
              <TouchableOpacity
                style={styles.blypItCard}
                activeOpacity={0.85}
                onPress={() => setBlypItVisible(true)}
              >
                <View style={styles.blypItIcon}>
                  <Icon name="sparkles" size={20} color={COLORS.black} />
                </View>
                <View style={styles.blypItTextWrap}>
                  <Text style={styles.blypItTitle}>Blyp it — compose &amp; send</Text>
                  <Text style={styles.blypItSub}>
                    {aiEntitled
                      ? 'Let Blyp draft a message + image, then share it'
                      : 'Let Blyp draft a message + image · Plus feature'}
                  </Text>
                </View>
                <Icon name="arrow-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
              {recent.length > 0 && (
                <View style={styles.recentWrap}>
                  <View style={styles.recentHeader}>
                    <Text style={styles.suggestEyebrow}>RECENT</Text>
                    <TouchableOpacity onPress={onClearRecent} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.clearText}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.recentChips}>
                    {recent.map((r) => (
                      <TouchableOpacity key={r} style={styles.recentChip} activeOpacity={0.8} onPress={() => handleSuggestion(r)}>
                        <Icon name="time-outline" size={13} color={COLORS.textMuted} />
                        <Text style={styles.recentChipText} numberOfLines={1}>{r}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
              <Text style={styles.suggestEyebrow}>TRY ASKING</Text>
              {SUGGESTIONS.map((s) => (
                <TouchableOpacity key={s} style={styles.suggestRow} activeOpacity={0.8} onPress={() => handleSuggestion(s)}>
                  <Icon name="sparkles-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.suggestText}>{s}</Text>
                  <Icon name="arrow-forward" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              ))}
              {!isBlypAiAvailable() && (
                <Text style={styles.aiOffNote}>
                  AI answers are off in this build — search still returns real results.
                </Text>
              )}
              {isBlypAiAvailable() && !aiEntitled && (
                <TouchableOpacity onPress={() => navigation.navigate('Plans')} activeOpacity={0.8}>
                  <Text style={styles.aiOffNote}>
                    Blyp AI answers + voice are a Plus feature — search still returns real results. See plans.
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Conversation turns (answers + sources) */}
          {turns.map(renderAnswer)}

          {/* Loading */}
          {loading && (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Blyping it…</Text>
            </View>
          )}

          {/* Results for the latest turn */}
          {!loading && lastTurn && (
            <>
              {/* Result filters */}
              {(allPosts.length > 0 || allCreators.length > 0) && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                  {FILTERS.map((f) => {
                    const count = filterCount(f.key);
                    const on = filter === f.key;
                    return (
                      <TouchableOpacity
                        key={f.key}
                        style={[styles.filterChip, on && styles.filterChipOn]}
                        activeOpacity={0.85}
                        onPress={() => setFilter(f.key)}
                      >
                        <Text style={[styles.filterChipText, on && styles.filterChipTextOn]}>
                          {f.label}{count ? ` ${count}` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {renderResultSections()}

              {!lastHasResults && (
                <View style={styles.emptyWrap}>
                  <Icon name="search-outline" size={40} color={COLORS.textMuted} />
                  <Text style={styles.emptyText}>No matches yet for “{lastTurn.query}”.</Text>
                  <Text style={styles.emptySub}>Try different words or ask a question.</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
        <BlypItModal
          visible={blypItVisible}
          onClose={() => setBlypItVisible(false)}
          navigation={navigation}
        />
        <ReminderEditSheet
          visible={!!editReminder}
          reminder={editReminder}
          onClose={() => setEditReminder(null)}
          onChangeLead={onChangeLead}
          onDelete={onDeleteEditing}
        />
        <LocationPermissionOverlay
          visible={!!locationPrompt}
          query={locationPrompt?.query}
          onClose={() => setLocationPrompt(null)}
          onGranted={onLocationGranted}
        />
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: responsiveSize(8) },
  blypItCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    marginBottom: 18,
    backgroundColor: 'rgba(0,210,190,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
  },
  blypItIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  blypItTextWrap: { flex: 1 },
  blypItTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700' },
  blypItSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.4)',
    backgroundColor: 'rgba(0,210,190,0.08)',
  },
  newChatText: { color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700' },
  questionBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 12,
    marginTop: 14,
    marginBottom: 8,
  },
  questionText: { color: COLORS.black, fontSize: responsiveFont(14), fontWeight: '700' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800', letterSpacing: -0.3 },
  blypBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    paddingHorizontal: 14,
    height: 52,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  blypMark: { color: COLORS.primary, fontWeight: '800', fontSize: responsiveFont(15) },
  input: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(15), paddingVertical: 0 },
  micBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,210,190,0.12)',
  },
  micBtnActive: { backgroundColor: COLORS.primary },
  listeningHint: { color: COLORS.textSecondary, fontSize: responsiveFont(12), textAlign: 'center', marginTop: 8 },
  scrollContent: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 120 },

  suggestWrap: { marginTop: 8 },
  suggestEyebrow: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(11),
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 10,
    marginLeft: 4,
  },
  recentWrap: { marginBottom: 18 },
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginRight: 4 },
  clearText: { color: COLORS.primary, fontSize: responsiveFont(12), fontWeight: '700', marginBottom: 10 },
  recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  recentChipText: { color: COLORS.textSecondary, fontSize: responsiveFont(13), fontWeight: '600', flexShrink: 1 },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
  },
  suggestText: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '600' },
  aiOffNote: { color: COLORS.textMuted, fontSize: responsiveFont(12), textAlign: 'center', marginTop: 8, lineHeight: 18 },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { color: COLORS.textSecondary, fontSize: responsiveFont(14) },

  // The AI answer is secondary "story" text — compact, muted, low-emphasis.
  answerUpsell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,210,190,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.30)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  answerUpsellText: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(12), lineHeight: responsiveFont(17) },
  answerUpsellCta: { color: COLORS.primary, fontSize: responsiveFont(12), fontWeight: '800' },
  answerThinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, marginBottom: 14 },
  answerThinkingText: { color: COLORS.textMuted, fontSize: responsiveFont(12), fontWeight: '600' },
  answerBlock: {
    paddingHorizontal: 4,
    marginBottom: 16,
  },
  answerHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  answerHeaderText: { color: COLORS.textMuted, fontSize: responsiveFont(10), fontWeight: '800', letterSpacing: 0.8, flexShrink: 1 },
  answerShareBtn: { marginLeft: 4, padding: 2 },
  answerText: { color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(19) },
  // Related/refine searches: small print suggestions, not headline actions.
  relatedWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  relatedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  relatedText: { color: COLORS.textSecondary, fontSize: responsiveFont(11), fontWeight: '600', flexShrink: 1 },

  sourcesWrap: { marginBottom: 18, marginHorizontal: -12 },
  sourcesLabel: { color: COLORS.textMuted, fontSize: responsiveFont(11), fontWeight: '800', letterSpacing: 1.2, marginLeft: 14, marginBottom: 8 },
  sourcesRow: { gap: 8, paddingHorizontal: 12 },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 200,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sourceChipText: { color: COLORS.textPrimary, fontSize: responsiveFont(12), fontWeight: '600', flexShrink: 1 },

  filterRow: { gap: 8, paddingBottom: 16, paddingLeft: 2 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { color: COLORS.textSecondary, fontSize: responsiveFont(13), fontWeight: '700' },
  filterChipTextOn: { color: COLORS.black },

  section: { marginBottom: 22 },
  sectionTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '800', marginBottom: 12, marginLeft: 2 },
  sectionTitleInline: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '800' },
  webHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, marginLeft: 2 },
  webCount: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(11),
    fontWeight: '700',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  webRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  webFavicon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 2,
  },
  webFaviconImg: { width: 18, height: 18, borderRadius: 4 },
  webText: { flex: 1 },
  webSource: { color: COLORS.textMuted, fontSize: responsiveFont(11), marginBottom: 1 },
  webTitle: { color: COLORS.linkBlue || '#5b9dff', fontSize: responsiveFont(15), fontWeight: '700', lineHeight: responsiveFont(20) },
  webSnippet: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: 3, lineHeight: responsiveFont(17) },
  webMoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  webMoreText: { color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700' },
  webSearchAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.4)',
    backgroundColor: 'rgba(0,210,190,0.08)',
  },
  webSearchAllText: { flex: 1, color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700' },

  creatorRow: { gap: 14, paddingRight: 12 },
  creatorCard: { alignItems: 'center', width: 72 },
  creatorAvatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.surface },
  creatorAvatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  creatorInitial: { color: COLORS.textPrimary, fontSize: responsiveFont(22), fontWeight: '800' },
  creatorName: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: 6, textAlign: 'center' },

  postGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  postCard: { width: '48%', marginBottom: 16 },
  postCardCarousel: { width: responsiveSize(150), marginBottom: 0, marginRight: 12 },
  postCarouselRow: { paddingRight: 12, paddingLeft: 2 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginLeft: 2, paddingRight: 2 },
  seeAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700' },

  placeCard: {
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(0,210,190,0.45)',
    marginTop: 4,
    marginBottom: 16,
  },
  placeHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  placePin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeName: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  placeInfoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  placeAddr: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(18) },
  placeInfoText: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(18) },
  // Big, obvious primary actions — the reason the user searched.
  placeActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  placeActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  placeActionBtnText: { color: COLORS.black, fontSize: responsiveFont(13), fontWeight: '800' },
  postThumbWrap: { position: 'relative', width: '100%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
  postThumb: { width: '100%', height: '100%', backgroundColor: COLORS.surface },
  postThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareBtn: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postTitle: { color: COLORS.textSecondary, fontSize: responsiveFont(13), marginTop: 6, lineHeight: responsiveFont(18) },

  reminderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(0,210,190,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,210,190,0.45)',
  },
  reminderCardError: {
    backgroundColor: 'rgba(255,59,48,0.08)',
    borderColor: 'rgba(255,59,48,0.45)',
  },
  reminderIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  reminderIconError: { backgroundColor: '#FF3B30' },
  reminderTextWrap: { flex: 1 },
  reminderTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '800' },
  reminderSub: { color: COLORS.textSecondary, fontSize: responsiveFont(13), marginTop: 3, lineHeight: responsiveFont(18) },
  reminderEditHint: { color: COLORS.primary, fontSize: responsiveFont(12), fontWeight: '700', marginTop: 4 },

  pickCard: {
    marginTop: 4,
    marginBottom: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(0,210,190,0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,210,190,0.35)',
  },
  pickTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '800', marginBottom: 6 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  pickAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#222' },
  pickAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  pickAvatarInitial: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(16) },
  pickName: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '700' },
  pickUsername: { color: COLORS.textSecondary, fontSize: responsiveFont(12) },

  plannerCard: {
    marginTop: 4,
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(0,210,190,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,210,190,0.45)',
    padding: 14,
  },
  plannerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  plannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,210,190,0.30)',
  },
  plannerTask: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '700' },
  plannerWhen: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 2 },

  emptyWrap: { alignItems: 'center', paddingVertical: 50, gap: 8 },
  emptyText: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '600', textAlign: 'center' },
  emptySub: { color: COLORS.textMuted, fontSize: responsiveFont(13), textAlign: 'center' },
});

export default BlypScreen;
