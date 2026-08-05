// HomeBasePanel.js
//
// The "Blyp home base" — the personalized landing surface. It leads with the
// Blyp AI bar, then surfaces smart suggestions, recent searches, live-now,
// trending and suggested-creator rails (real Firestore data), the user's
// interests (each a one-tap blyp search), quick actions into the rest of the
// app, and a shortcut into their pages.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Icon from '../Icon';
import {
  resolveReminder,
  createReminder,
  rescheduleReminder,
  isMultiReminderRequest,
  planReminders,
  formatLead,
  listReminders,
  repairUnscheduledReminders,
  removeReminder,
} from '../../services/reminderService';
import ReminderEditSheet from '../ReminderEditSheet';
import {
  resolveWatch,
  findUsersByName,
  addWatch,
  listWatches,
  removeWatch,
  watchTypeLabel,
} from '../../services/userWatchService';
import {
  resolveEventWatch,
  addEventWatch,
  eventWatchLabel,
} from '../../services/eventWatchService';
import { needsLocationForQuery } from '../../services/locationService';
import LocationPermissionOverlay from '../LocationPermissionOverlay';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import speechToTextService from '../../services/speechToTextService';
import geminiSpeechService from '../../services/geminiSpeechService';
import { useHasAI } from '../../hooks/useEntitlement';
import { INTEREST_CATALOG, getPreferences } from '../../services/userPreferencesService';
import {
  getLiveNow,
  getTrendingPosts,
  getForYouPosts,
  getSuggestedCreators,
  creatorAvatar,
  streamThumbnail,
} from '../../services/discoveryService';
import { postThumbnail } from '../../services/blypAiService';
import { followUser, unfollowUser, subscribeToFollowingList } from '../../utils/followUtils';
import { getActivity, countUnread } from '../../services/activityService';
import { subscribeWatchHistory } from '../../services/watchHistoryService';
import { fixStorageUrl } from '../../utils/urlUtils';
import { mediaViewerParams } from '../../utils/mediaViewerPlaylist';
import EnhancedVideo from '../EnhancedVideo';

const GENERIC_SUGGESTIONS = [
  "What's worth watching right now?",
  'Find creators like me',
  'What can I do on Blyp?',
];

const INTEREST_PROMPTS = {
  football: 'Football clips and creators',
  f1: 'F1 highlights and news',
  sport: 'Top sport moments today',
  gaming: 'Best gaming streams',
  music: 'New music to discover',
  comedy: 'Funniest clips right now',
  cooking: 'Quick recipes to try',
  fitness: 'Workouts I can do today',
  tech: "What's new in tech",
  news: "Today's top stories",
  travel: 'Travel inspiration',
  fashion: 'Outfit ideas',
  beauty: 'Beauty tips and looks',
  cars: 'Coolest cars right now',
  art: 'Art and design ideas',
  science: 'Mind-blowing science',
  finance: 'Money and crypto explained',
  pets: 'Cute animal clips',
  dance: 'Dance trends',
  diy: 'DIY projects to try',
  movies: 'What should I watch?',
  photography: 'Photography inspiration',
};

const QUICK_ACTIONS = [
  { id: 'blyp', label: 'blyp it', icon: 'sparkles', route: 'Blyp' },
  { id: 'live', label: 'Go live', icon: 'radio', route: 'LiveStreamScreen', params: { mode: 'host', source: 'home_base' } },
  { id: 'rankings', label: 'Rankings', icon: 'trophy', route: 'Rankings' },
  { id: 'dating', label: 'Dating', icon: 'heart', route: 'Dating' },
  { id: 'games', label: 'Games', icon: 'game-controller', route: 'Games' },
  { id: 'saved', label: 'Saved', icon: 'bookmark', route: 'Saved' },
  { id: 'people', label: 'Find people', icon: 'person-add', route: 'FindPeople' },
  { id: 'recap', label: 'Your Blyp', icon: 'stats-chart', route: 'YourBlyp' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet', route: 'CoinStore' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const HomeBasePanel = ({ navigation, uid, interests = [], pages = [], onOpenPage, onEditPages }) => {
  // Gate the For-You rail's autoplaying (unmuted) preview on navigation focus.
  // Without this, the active tile keeps playing audio after the user navigates
  // away (e.g. taps "Go live"), bleeding sound behind the live broadcast.
  const isScreenFocused = useIsFocused();
  const [recent, setRecent] = useState([]);
  const [live, setLive] = useState([]);
  const [trending, setTrending] = useState([]);
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followingSet, setFollowingSet] = useState(new Set());
  const [unread, setUnread] = useState(0);
  const [watch, setWatch] = useState([]);
  const [forYou, setForYou] = useState([]);
  // Which "For you" rail tile is snapped into view — that one autoplays a muted,
  // looping preview. Defaults to 0 so the first tile plays as soon as the home
  // screen loads.
  const [activeForYou, setActiveForYou] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Snap step = forYouCard width (150) + railRow gap (12). Keep in sync with styles.
  const FORYOU_SNAP = 162;
  const onForYouScrollEnd = useCallback((e) => {
    const x = e?.nativeEvent?.contentOffset?.x || 0;
    const idx = Math.max(0, Math.round(x / FORYOU_SNAP));
    setActiveForYou(idx);
  }, []);

  // The home Blyp bar accepts typed input: reminders are created in place and
  // listed right below; anything else opens the full Blyp assistant.
  const [queryText, setQueryText] = useState('');
  const [reminders, setReminders] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [editReminder, setEditReminder] = useState(null);
  const [watches, setWatches] = useState([]);
  const [watchNotice, setWatchNotice] = useState('');
  const [locationPrompt, setLocationPrompt] = useState(null);

  // Voice: the home Blyp bar listens in place (same engine as the Blyp screen),
  // then routes the transcript into the one unified assistant flow.
  const aiEntitled = useHasAI();
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

  const interestTerms = useMemo(() => {
    const byId = new Map(INTEREST_CATALOG.map((i) => [i.id, i.label]));
    return (interests || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .flatMap((label) => String(label).toLowerCase().split(/\s+/));
  }, [interests]);

  const interestKey = (interests || []).join(',');

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const [liveRes, trendRes, creatorRes, prefs] = await Promise.all([
        getLiveNow(10),
        getTrendingPosts(10, interestTerms),
        getSuggestedCreators(12, interestTerms, uid),
        getPreferences(uid),
      ]);
      if (!active) return;
      setLive(liveRes);
      setTrending(trendRes);
      setCreators(creatorRes);
      setRecent(prefs.recentSearches || []);
      setLoading(false);

      // Activity badge (separate await so it never blocks the rails).
      try {
        const activity = await getActivity(uid);
        if (active) setUnread(countUnread(activity, prefs.lastSeenActivityAt || 0));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, interestKey]);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeToFollowingList(uid, setFollowingSet);
    return unsub;
  }, [uid]);

  useEffect(() => {
    const unsub = subscribeWatchHistory(uid, setWatch);
    return unsub;
  }, [uid]);

  // Personalized "For You" rail — ranked mix of follows + interests.
  useEffect(() => {
    let active = true;
    getForYouPosts(interestTerms, Array.from(followingSet), 12).then((r) => {
      if (active) {
        setForYou(r);
        setActiveForYou(0); // first tile autoplays whenever the rail refreshes
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, interestKey, followingSet]);

  const blyp = (initialQuery) => navigation.navigate('Blyp', initialQuery ? { initialQuery } : undefined);

  // Load saved reminders, and refresh whenever the home screen regains focus
  // (so reminders created from the full Blyp screen also appear here).
  const refreshReminders = useCallback(async () => {
    try {
      // Repair any reminders that were saved without a local notification
      // (permission denied / old trigger formats), then refresh the list.
      const rows = await repairUnscheduledReminders(uid);
      setReminders(rows);
    } catch {
      try {
        const rows = await listReminders(uid);
        setReminders(rows);
      } catch {
        /* ignore */
      }
    }
  }, [uid]);

  const refreshWatches = useCallback(async () => {
    try {
      const rows = await listWatches(uid);
      setWatches(rows);
    } catch {
      /* ignore */
    }
  }, [uid]);

  // Pull-to-refresh: re-fetch every rail on the home base in one pass.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [liveRes, trendRes, creatorRes, prefs, forYouRes] = await Promise.all([
        getLiveNow(10),
        getTrendingPosts(10, interestTerms),
        getSuggestedCreators(12, interestTerms, uid),
        getPreferences(uid),
        getForYouPosts(interestTerms, Array.from(followingSet), 12),
      ]);
      setLive(liveRes);
      setTrending(trendRes);
      setCreators(creatorRes);
      setRecent(prefs.recentSearches || []);
      setForYou(forYouRes);
      setActiveForYou(0);
      try {
        const activity = await getActivity(uid);
        setUnread(countUnread(activity, prefs.lastSeenActivityAt || 0));
      } catch {
        /* ignore */
      }
      await Promise.all([refreshReminders(), refreshWatches()]);
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, interestKey, followingSet, refreshReminders, refreshWatches]);

  useEffect(() => {
    refreshReminders();
    refreshWatches();
  }, [refreshReminders, refreshWatches]);

  useEffect(() => {
    const onFocus = () => {
      refreshReminders();
      refreshWatches();
    };
    const unsub = navigation?.addListener?.('focus', onFocus);
    return unsub;
  }, [navigation, refreshReminders, refreshWatches]);

  useEffect(() => {
    if (!watchNotice) return undefined;
    const t = setTimeout(() => setWatchNotice(''), 6000);
    return () => clearTimeout(t);
  }, [watchNotice]);

  // Handle any request (typed or spoken): a reminder ("remind me of a hospital
  // appointment next Wednesday") is created + listed below; everything else
  // opens the full Blyp assistant.
  const handleQuery = useCallback(
    async (input, geo) => {
      const text = String(input || '').trim();
      if (!text) return;
      // Keep the spoken/typed text visible in the bar while we process.
      setQueryText(text);
      setSubmitting(true);
      try {
        const eventWatch = await resolveEventWatch(text);
        if (eventWatch.isEventWatch) {
          const rec = await addEventWatch(uid, eventWatch.type);
          setQueryText('');
          setWatchNotice(
            rec
              ? `You'll be notified when ${eventWatchLabel(eventWatch.type)}.`
              : "Couldn't set that alert — try again."
          );
          return;
        }

        // Watch: "notify me when <person> is next live / next on the app".
        const watch = await resolveWatch(text);
        if (watch.isWatch) {
          const candidates = await findUsersByName(watch.targetName, uid, 6);
          setQueryText('');
          if (candidates.length === 1) {
            await addWatch(uid, candidates[0], watch.type);
            await refreshWatches();
            setWatchNotice(`You'll be notified when ${candidates[0].displayName} ${watchTypeLabel(watch.type)}.`);
          } else if (candidates.length > 1) {
            navigation.navigate('Blyp', { initialQuery: text });
          } else {
            setWatchNotice(`I couldn't find anyone called "${watch.targetName}" on Blyp.`);
          }
          return;
        }
        // Multi-event plan: "remind me of every Arsenal match, an hour before".
        if (isMultiReminderRequest(text)) {
          const plan = await planReminders(text);
          if (plan?.isPlan && plan.events.length) {
            let okCount = 0;
            let failReason = null;
            for (const ev of plan.events) {
              // eslint-disable-next-line no-await-in-loop
              const { sched } = await createReminder(uid, {
                task: ev.task,
                event: ev.when,
                leadMinutes: plan.leadMinutes,
              });
              if (sched?.ok) okCount += 1;
              else if (!failReason) failReason = sched?.reason;
            }
            await refreshReminders();
            setQueryText('');
            if (okCount === 0) {
              setWatchNotice(
                failReason === 'permission_denied'
                  ? 'Notifications are off — enable them in Settings so reminders can alert you.'
                  : "Couldn't schedule those reminders. Check notification permission and try again."
              );
            } else if (failReason) {
              setWatchNotice(`Set ${okCount} reminder${okCount === 1 ? '' : 's'}; some need notification permission.`);
            } else {
              setWatchNotice(`Set ${okCount} reminder${okCount === 1 ? '' : 's'} — you'll get a notification for each.`);
            }
            return;
          }
        }
        // Single reminder ("remind me of a hospital appointment next Wednesday").
        const parsed = await resolveReminder(text);
        if (parsed?.isReminder) {
          const { rec, sched } = await createReminder(uid, {
            task: parsed.task,
            event: parsed.when,
            leadMinutes: 0,
          });
          await refreshReminders();
          setQueryText('');
          if (sched?.ok) {
            setWatchNotice(`Reminder set for ${rec?.eventLabel || 'soon'} — you'll get a notification.`);
          } else if (sched?.reason === 'permission_denied') {
            setWatchNotice('Notifications are off — enable them in Settings so reminders can alert you.');
          } else {
            setWatchNotice("Couldn't schedule the notification. Check permission and try again.");
          }
          return;
        }
        if (needsLocationForQuery(text) && !geo) {
          setLocationPrompt({ query: text });
          // Keep spoken/typed text visible in the bar.
          return;
        }
        // Keep the query in the bar so the user can see what was spoken/typed
        // while Search opens. Prefer real people/posts search over the old
        // assistant answers (those were often outdated / unhelpful).
        navigation.navigate('Search', { initialQuery: text });
      } catch {
        navigation.navigate('Search', { initialQuery: text });
      } finally {
        setSubmitting(false);
      }
    },
    [uid, navigation, refreshReminders, refreshWatches]
  );

  const onLocationGranted = useCallback(
    (geo) => {
      const pending = locationPrompt?.query;
      setLocationPrompt(null);
      if (pending) {
        // Places still open Blyp with geo so local results can use location.
        navigation.navigate('Blyp', { initialQuery: pending, geo });
      }
    },
    [locationPrompt, navigation]
  );

  const onCancelWatch = useCallback(
    async (w) => {
      setWatches((prev) => prev.filter((x) => x.id !== w.id));
      try {
        await removeWatch(uid, w.id);
      } catch {
        /* ignore */
      }
    },
    [uid]
  );

  const onSubmitQuery = useCallback(() => {
    if (submitting) return;
    handleQuery(queryText);
  }, [submitting, handleQuery, queryText]);

  const onChangeLead = useCallback(
    async (minutes) => {
      if (!editReminder) return;
      try {
        await rescheduleReminder(uid, editReminder.id, minutes);
      } catch {
        /* ignore */
      }
      setEditReminder(null);
      await refreshReminders();
    },
    [editReminder, uid, refreshReminders]
  );

  const onDeleteEditing = useCallback(async () => {
    if (!editReminder) return;
    const rem = editReminder;
    setEditReminder(null);
    setReminders((prev) => prev.filter((r) => r.id !== rem.id));
    try {
      await removeReminder(uid, rem.id, rem.notificationId);
    } catch {
      /* ignore */
    }
  }, [editReminder, uid]);

  // Pulse the overlay mic while actively listening.
  useEffect(() => {
    let loop;
    if (listening) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.22, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      loop.start();
    } else {
      pulse.setValue(1);
    }
    return () => {
      try { loop?.stop?.(); } catch { /* ignore */ }
    };
  }, [listening, pulse]);

  const startListening = useCallback(async () => {
    try {
      const ok = await speechToTextService.startRecording(() => {});
      if (ok) setListening(true);
    } catch {
      setListening(false);
    }
  }, []);

  const stopListening = useCallback(async () => {
    setListening(false);
    setTranscribing(true);
    try {
      const uri = await speechToTextService.stopRecording();
      if (!uri) {
        setWatchNotice("Couldn't catch that — hold the mic a moment longer and try again.");
        return;
      }
      const text = await geminiSpeechService.transcribeAudio(uri);
      const clean = String(text || '').trim();
      // The service returns bracketed tokens (e.g. [NO_KEY]) on failure.
      if (!clean || clean.startsWith('[')) {
        if (clean.includes('402') || clean.includes('subscription')) {
          setWatchNotice('Voice search needs an active trial or Blyp Plus.');
        } else if (clean.includes('NO_KEY') || clean.includes('503')) {
          setWatchNotice('Voice is temporarily offline — type your search instead.');
        } else if (clean.includes('READ_FAIL') || !uri) {
          setWatchNotice("Couldn't catch that — hold the mic a moment longer and try again.");
        } else {
          setWatchNotice("Couldn't hear that clearly — try speaking again, or type it.");
        }
        return;
      }
      // Always put the spoken text into the search bar first.
      setQueryText(clean);
      // Then run the same path as typing + submit (reminders stay here; else open Search).
      await handleQuery(clean);
    } catch (e) {
      console.warn('[home] voice failed', e?.message || String(e));
      setWatchNotice("Voice didn't work just then — try again.");
    } finally {
      setTranscribing(false);
    }
  }, [handleQuery]);

  // The mic LISTENS in place — it must never just navigate away.
  const onMicPress = () => {
    if (transcribing) return;
    if (!aiEntitled) {
      navigation.navigate('Plans');
      return;
    }
    if (listening) stopListening();
    else startListening();
  };

  const openAction = (action) => {
    try {
      navigation.navigate(action.route, action.params);
    } catch {
      /* route may be gated; ignore */
    }
  };

  const openPost = (post, list) =>
    navigation.navigate('MediaViewer', mediaViewerParams(post, list));

  const openLive = (stream) => {
    const streamId = stream.streamId || stream.id || stream.liveId;
    navigation.navigate('LiveStreamScreen', {
      mode: 'viewer',
      streamId,
      hostUid: stream.hostUid || stream.userId || stream.uid || stream.creatorId,
      hostDisplayName: stream.hostDisplayName || stream.hostUsername || stream.title || 'Live',
      source: 'home_base',
      liveViewerIntent: true,
    });
  };

  const openCreator = (user) =>
    navigation.navigate('UserProfile', {
      userId: user.id || user.uid || user.userId,
      username: user.username || user.displayName || '@user',
    });

  const toggleFollow = async (user) => {
    const targetId = user.id || user.uid || user.userId;
    if (!uid || !targetId) return;
    const isF = followingSet.has(targetId);
    // optimistic
    setFollowingSet((prev) => {
      const next = new Set(prev);
      if (isF) next.delete(targetId);
      else next.add(targetId);
      return next;
    });
    try {
      const res = isF
        ? await unfollowUser(uid, targetId)
        : await followUser(uid, targetId);
      if (!res?.success) {
        setFollowingSet((prev) => {
          const next = new Set(prev);
          if (isF) next.add(targetId);
          else next.delete(targetId);
          return next;
        });
      }
    } catch {
      setFollowingSet((prev) => {
        const next = new Set(prev);
        if (isF) next.add(targetId);
        else next.delete(targetId);
        return next;
      });
    }
  };

  const interestChips = useMemo(() => {
    const byId = new Map(INTEREST_CATALOG.map((i) => [i.id, i]));
    return (interests || []).map((id) => byId.get(id)).filter(Boolean);
  }, [interests]);

  const smartSuggestions = useMemo(() => {
    const fromInterests = (interests || [])
      .map((id) => INTEREST_PROMPTS[id])
      .filter(Boolean)
      .slice(0, 3);
    return Array.from(new Set([...fromInterests, ...GENERIC_SUGGESTIONS])).slice(0, 4);
  }, [interests]);

  const otherPages = (pages || []).filter((p) => p.key !== 'home');

  return (
    <>
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={COLORS.primary}
          colors={[COLORS.primary]}
        />
      }
    >
      {/* Greeting + quick shortcuts */}
      <View style={styles.greetRow}>
        <Text style={styles.greetText}>{greeting()}</Text>
        <View style={styles.greetActions}>
          <TouchableOpacity
            style={styles.savedBtn}
            onPress={() => {
              setUnread(0);
              navigation.navigate('Activity');
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="notifications-outline" size={20} color={COLORS.textPrimary} />
            {unread > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.savedBtn} onPress={() => navigation.navigate('Saved')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="bookmark-outline" size={20} color={COLORS.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* The one Blyp bar (hero): type to ask or set a reminder, or tap the mic. */}
      <View style={styles.blypBar}>
        <Text style={styles.blypMark}>blyp</Text>
        <TextInput
          style={styles.blypInput}
          value={queryText}
          onChangeText={setQueryText}
          onSubmitEditing={onSubmitQuery}
          placeholder="Search people & posts, or “remind me…”"
          placeholderTextColor={COLORS.textMuted}
          returnKeyType="search"
          blurOnSubmit
          editable={!submitting}
        />
        {submitting ? (
          <View style={styles.micCircle}>
            <ActivityIndicator size="small" color={COLORS.primary} />
          </View>
        ) : queryText.trim().length > 0 ? (
          <TouchableOpacity
            style={[styles.micCircle, styles.sendCircle]}
            activeOpacity={0.85}
            onPress={onSubmitQuery}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name="arrow-forward" size={16} color={COLORS.black} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.micCircle, listening && styles.micCircleActive]}
            activeOpacity={0.85}
            onPress={onMicPress}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            {transcribing ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Icon name={listening ? 'stop' : 'mic'} size={16} color={listening ? COLORS.black : COLORS.primary} />
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Transient confirmation for "notify me when <person>…" requests. */}
      {!!watchNotice && (
        <View style={styles.watchNotice}>
          <Icon name="notifications" size={15} color={COLORS.primary} />
          <Text style={styles.watchNoticeText}>{watchNotice}</Text>
        </View>
      )}

      {/* Watching — alerts for when a person goes live / comes on the app. */}
      {watches.length > 0 && (
        <View style={styles.remindersWrap}>
          {watches.map((w) => (
            <View key={w.id} style={styles.reminderRow}>
              <View style={styles.reminderIcon}>
                <Icon name={w.type === 'live' ? 'radio-outline' : 'person-outline'} size={18} color={COLORS.primary} />
              </View>
              <View style={styles.reminderBody}>
                <Text style={styles.reminderTask} numberOfLines={1}>{w.targetName}</Text>
                <Text style={styles.reminderWhen}>
                  {w.type === 'live' ? 'When they go live' : 'When they’re next on the app'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onCancelWatch(w)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Reminders — tap one to change when it notifies you, or to delete it. */}
      {reminders.length > 0 && (
        <View style={styles.remindersWrap}>
          {reminders.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={styles.reminderRow}
              activeOpacity={0.85}
              onPress={() => setEditReminder(r)}
            >
              <View style={styles.reminderIcon}>
                <Icon name="alarm-outline" size={18} color={COLORS.primary} />
              </View>
              <View style={styles.reminderBody}>
                <Text style={styles.reminderTask} numberOfLines={2}>{r.task}</Text>
                <Text style={styles.reminderWhen}>{r.eventLabel || r.whenLabel}</Text>
                {!r.scheduled ? (
                  <Text style={styles.reminderWarn}>Notification not scheduled — tap to fix</Text>
                ) : (
                  <View style={styles.reminderLeadChip}>
                    <Icon name="notifications-outline" size={11} color={COLORS.primary} />
                    <Text style={styles.reminderLeadText}>{formatLead(r.leadMinutes)}</Text>
                  </View>
                )}
              </View>
              <Icon name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ReminderEditSheet
        visible={!!editReminder}
        reminder={editReminder}
        onClose={() => setEditReminder(null)}
        onChangeLead={onChangeLead}
        onDelete={onDeleteEditing}
      />

      {/* Listening overlay — "How can I help?" while the mic is open. */}
      <Modal
        visible={listening || transcribing}
        transparent
        animationType="fade"
        onRequestClose={() => { if (listening) stopListening(); }}
      >
        <TouchableOpacity
          style={styles.voiceBackdrop}
          activeOpacity={1}
          onPress={() => { if (listening) stopListening(); }}
        >
          <View style={styles.voiceSheet}>
            <Text style={styles.voiceTitle}>{transcribing ? 'Got it — one sec…' : 'How can I help?'}</Text>
            <Text style={styles.voiceSub}>
              {transcribing ? 'Turning what you said into a blyp' : 'Listening… ask me anything'}
            </Text>
            <Animated.View style={[styles.voiceMic, { transform: [{ scale: transcribing ? 1 : pulse }] }]}>
              {transcribing ? (
                <ActivityIndicator color={COLORS.black} />
              ) : (
                <Icon name="mic" size={34} color={COLORS.black} />
              )}
            </Animated.View>
            {!transcribing && (
              <TouchableOpacity style={styles.voiceStopBtn} activeOpacity={0.85} onPress={stopListening}>
                <Icon name="stop" size={16} color={COLORS.primary} />
                <Text style={styles.voiceStopText}>Tap to finish</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Smart suggestions */}
      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {smartSuggestions.map((s) => (
            <TouchableOpacity key={s} style={styles.suggestChip} activeOpacity={0.85} onPress={() => blyp(s)}>
              <Icon name="sparkles-outline" size={13} color={COLORS.primary} />
              <Text style={styles.suggestChipText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Recent searches */}
      {recent.length > 0 && (
        <View style={styles.chipRowWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {recent.slice(0, 8).map((r) => (
              <TouchableOpacity key={r} style={styles.recentChip} activeOpacity={0.85} onPress={() => blyp(r)}>
                <Icon name="time-outline" size={13} color={COLORS.textMuted} />
                <Text style={styles.recentChipText} numberOfLines={1}>{r}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={COLORS.primary} />
        </View>
      )}

      {/* For You — personalized rail */}
      {forYou.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>For you</Text>
            <TouchableOpacity onPress={() => onOpenPage?.('A')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.editLink}>Open feed</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.railRow}
            snapToInterval={FORYOU_SNAP}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            onMomentumScrollEnd={onForYouScrollEnd}
          >
            {forYou.map((p, index) => {
              const uri = postThumbnail(p);
              const isVideo = p.type === 'video' || !!p.videoUrl;
              const videoUri = isVideo
                ? fixStorageUrl(p.videoUrl || p.mediaUrl || p?.media?.[0]?.url)
                : '';
              const isActive = index === activeForYou;
              // Mount the active tile's video AND pre-warm the next one (paused,
              // hidden) so snapping to it plays instantly instead of cold-starting
              // a fresh player. A thumbnail backdrop always renders underneath so
              // there's never a black "refresh" flash during the swap.
              const mountVideo = (isActive || index === activeForYou + 1) && isVideo && !!videoUri;
              return (
                <TouchableOpacity key={p.id} style={styles.forYouCard} activeOpacity={0.85} onPress={() => openPost(p, forYou)}>
                  <View>
                    {uri ? (
                      <Image source={{ uri }} style={styles.forYouThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.forYouThumb, styles.thumbFallback]}>
                        <Icon name="sparkles-outline" size={24} color={COLORS.textMuted} />
                      </View>
                    )}
                    {mountVideo && (
                      <EnhancedVideo
                        uri={videoUri}
                        poster={uri}
                        style={[styles.forYouThumb, StyleSheet.absoluteFill, !isActive && styles.forYouPreloadHidden]}
                        resizeMode="cover"
                        shouldLoad
                        shouldPlay={isActive && isScreenFocused && !listening && !transcribing}
                        isLooping
                        isMuted={!isActive || !isScreenFocused || listening || transcribing}
                      />
                    )}
                    {isVideo && !isActive && (
                      <View style={styles.resumeBadge}>
                        <Icon name="play" size={12} color={COLORS.white} />
                      </View>
                    )}
                  </View>
                  <Text style={styles.trendTitle} numberOfLines={2}>
                    {p.title || p.caption || p.description || 'Post'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* Continue watching */}
      {watch.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Continue watching</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
            {watch.map((w) => {
              const uri = fixStorageUrl(w.thumbnail);
              return (
                <TouchableOpacity key={w.id} style={styles.trendCard} activeOpacity={0.85} onPress={() => openPost(w, watch)}>
                  <View>
                    {uri ? (
                      <Image source={{ uri }} style={styles.trendThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.trendThumb, styles.thumbFallback]}>
                        <Icon name="play-circle-outline" size={26} color={COLORS.textMuted} />
                      </View>
                    )}
                    {w.type === 'video' && (
                      <View style={styles.resumeBadge}>
                        <Icon name="play" size={12} color={COLORS.white} />
                      </View>
                    )}
                  </View>
                  <Text style={styles.trendTitle} numberOfLines={2}>{w.title}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* Live now */}
      {live.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.liveTitleWrap}>
              <View style={styles.liveDot} />
              <Text style={styles.sectionTitle}>Live now</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
            {live.map((s) => {
              const uri = streamThumbnail(s);
              return (
                <TouchableOpacity key={s.id || s.streamId} style={styles.liveCard} activeOpacity={0.85} onPress={() => openLive(s)}>
                  {uri ? (
                    <Image source={{ uri }} style={styles.liveThumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.liveThumb, styles.thumbFallback]}>
                      <Icon name="radio" size={22} color={COLORS.textMuted} />
                    </View>
                  )}
                  <View style={styles.liveBadge}>
                    <Text style={styles.liveBadgeText}>LIVE</Text>
                  </View>
                  <Text style={styles.liveCardTitle} numberOfLines={1}>
                    {s.title || s.hostDisplayName || s.hostUsername || 'Live stream'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* Trending now */}
      {trending.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Trending now</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
            {trending.map((p) => {
              const uri = postThumbnail(p);
              return (
                <TouchableOpacity key={p.id} style={styles.trendCard} activeOpacity={0.85} onPress={() => openPost(p, trending)}>
                  {uri ? (
                    <Image source={{ uri }} style={styles.trendThumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.trendThumb, styles.thumbFallback]}>
                      <Icon name="image-outline" size={22} color={COLORS.textMuted} />
                    </View>
                  )}
                  <Text style={styles.trendTitle} numberOfLines={2}>
                    {p.title || p.caption || p.description || 'Post'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* Suggested creators */}
      {creators.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Creators to follow</Text>
            <TouchableOpacity onPress={() => navigation.navigate('FindPeople')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.editLink}>See all</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
            {creators.map((c) => {
              const avatar = creatorAvatar(c);
              const targetId = c.id || c.uid || c.userId;
              const isF = followingSet.has(targetId);
              const initial = (c.displayName || c.username || '?').slice(0, 1).toUpperCase();
              return (
                <View key={targetId} style={styles.creatorCard}>
                  <TouchableOpacity activeOpacity={0.85} onPress={() => openCreator(c)}>
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={styles.creatorAvatar} />
                    ) : (
                      <View style={[styles.creatorAvatar, styles.creatorAvatarFallback]}>
                        <Text style={styles.creatorInitial}>{initial}</Text>
                      </View>
                    )}
                    <Text style={styles.creatorName} numberOfLines={1}>
                      @{c.username || c.displayName || 'user'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.followBtn, isF && styles.followingBtn]}
                    activeOpacity={0.85}
                    onPress={() => toggleFollow(c)}
                  >
                    <Text style={[styles.followText, isF && styles.followingText]}>{isF ? 'Following' : 'Follow'}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* Quick actions */}
      <Text style={styles.sectionTitle}>Jump in</Text>
      <View style={styles.actionsGrid}>
        {QUICK_ACTIONS.map((a) => (
          <TouchableOpacity key={a.id} style={styles.actionTile} activeOpacity={0.85} onPress={() => openAction(a)}>
            <View style={styles.actionIcon}>
              <Icon name={a.icon} size={22} color={COLORS.primary} />
            </View>
            <Text style={styles.actionLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Your interests */}
      {interestChips.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Your interests</Text>
            <TouchableOpacity onPress={onEditPages} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.editLink}>Customize</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.interestWrap}>
            {interestChips.map((i) => (
              <TouchableOpacity
                key={i.id}
                style={styles.interestChip}
                activeOpacity={0.85}
                onPress={() => blyp(INTEREST_PROMPTS[i.id] || i.label)}
              >
                <Icon name={i.icon} size={15} color={COLORS.textPrimary} />
                <Text style={styles.interestText}>{i.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* Your pages */}
      {otherPages.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Your pages</Text>
            <TouchableOpacity onPress={onEditPages} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.pageList}>
            {otherPages.map((p) => (
              <TouchableOpacity
                key={p.key}
                style={styles.pageRow}
                activeOpacity={0.85}
                onPress={() => onOpenPage?.(p.key)}
              >
                <Text style={styles.pageRowText}>{p.label}</Text>
                <Icon name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <View style={{ height: responsiveSize(100) }} />
    </ScrollView>
    <LocationPermissionOverlay
      visible={!!locationPrompt}
      query={locationPrompt?.query}
      onClose={() => setLocationPrompt(null)}
      onGranted={onLocationGranted}
    />
    </>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.pageBackground },
  content: { paddingHorizontal: 16, paddingTop: 8 },

  greetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  greetText: { color: COLORS.textSecondary, fontSize: responsiveFont(15), fontWeight: '600', letterSpacing: -0.2 },
  greetActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  savedBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.pageBackground,
  },
  bellBadgeText: { color: '#fff', fontSize: responsiveFont(9), fontWeight: '800' },

  blypBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    height: 54,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  blypMark: { color: COLORS.primary, fontWeight: '800', fontSize: responsiveFont(16) },
  blypInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: responsiveFont(15),
    paddingVertical: 0,
  },
  micCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,210,190,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micCircleActive: { backgroundColor: COLORS.primary },
  sendCircle: { backgroundColor: COLORS.primary },

  remindersWrap: { marginTop: 14, gap: 8 },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  reminderIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,210,190,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderBody: { flex: 1 },
  reminderTask: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '700' },
  reminderWhen: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 2 },
  reminderWarn: { color: '#FF8A80', fontSize: responsiveFont(11), fontWeight: '700', marginTop: 6 },
  reminderLeadChip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(0,210,190,0.10)' },
  reminderLeadText: { color: COLORS.primary, fontSize: responsiveFont(11), fontWeight: '700' },
  watchNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(0,210,190,0.10)', borderWidth: 1, borderColor: 'rgba(0,210,190,0.35)' },
  watchNoticeText: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(12), lineHeight: responsiveFont(17) },

  voiceBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  voiceSheet: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  voiceTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(20), fontWeight: '800' },
  voiceSub: { color: COLORS.textMuted, fontSize: responsiveFont(13), marginTop: 6, marginBottom: 24, textAlign: 'center' },
  voiceMic: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceStopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 28,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(0,210,190,0.10)',
  },
  voiceStopText: { color: COLORS.primary, fontSize: responsiveFont(14), fontWeight: '700' },

  chipRowWrap: { marginTop: 12, marginHorizontal: -16 },
  chipRow: { gap: 8, paddingHorizontal: 16 },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  suggestChipText: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '600' },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 200,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  recentChipText: { color: COLORS.textSecondary, fontSize: responsiveFont(13), fontWeight: '600', flexShrink: 1 },

  loadingRow: { paddingVertical: 24, alignItems: 'center' },

  sectionTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(17), fontWeight: '800', marginTop: 24, marginBottom: 12 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editLink: { color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700', marginTop: 24, marginBottom: 12 },
  liveTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30', marginTop: 12 },

  railRow: { gap: 12, paddingRight: 8 },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },

  liveCard: { width: 150 },
  liveThumb: { width: 150, height: 90, borderRadius: 12, backgroundColor: COLORS.surface },
  liveBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#FF3B30',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  liveBadgeText: { color: '#fff', fontSize: responsiveFont(10), fontWeight: '800', letterSpacing: 0.5 },
  liveCardTitle: { color: COLORS.textSecondary, fontSize: responsiveFont(13), marginTop: 6 },

  forYouCard: { width: 150 },
  forYouThumb: { width: 150, height: 200, borderRadius: 12, backgroundColor: COLORS.surface },
  // Pre-warmed (next) video is kept invisible over its thumbnail so it's already
  // buffered and plays the instant it becomes the active tile.
  forYouPreloadHidden: { opacity: 0 },
  trendCard: { width: 130 },
  trendThumb: { width: 130, height: 130, borderRadius: 12, backgroundColor: COLORS.surface },
  trendTitle: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: 6, lineHeight: responsiveFont(16) },
  resumeBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  creatorCard: { width: 96, alignItems: 'center' },
  creatorAvatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: COLORS.surface, alignSelf: 'center' },
  creatorAvatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  creatorInitial: { color: COLORS.textPrimary, fontSize: responsiveFont(24), fontWeight: '800' },
  creatorName: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: 6, textAlign: 'center' },
  followBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  followingBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.border },
  followText: { color: COLORS.black, fontSize: responsiveFont(12), fontWeight: '800' },
  followingText: { color: COLORS.textSecondary },

  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  actionTile: {
    width: '31.5%',
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
  },
  actionIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0,210,190,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionLabel: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '600' },

  interestWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  interestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  interestText: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '600' },

  pageList: { gap: 8 },
  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pageRowText: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '600' },
});

export default HomeBasePanel;
