// DatingScreen.js
//
// Blyp Dating is a distinct product surface built on the existing dating
// prefs, discovery, likes and matches collections. No parallel write path.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import ReportModal from '../components/ReportModal';
import AvatarRing from '../components/motion/AvatarRing';
import { COLORS, SHADOWS } from '../styles/theme';
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
  fetchIncomingLikes,
  fetchMatches,
  getDatingPrefs,
  recordLike,
  recordPass,
  setDatingOptIn,
  setDatingPrefs,
} from '../services/datingService';
import { getCurrentGeo } from '../services/locationService';
import { blockUser, loadBlockedUsers } from '../services/BlockService';

const DATING = {
  accent: '#FF7868',
  accentBright: '#FF9A84',
  accentSoft: 'rgba(255,120,104,0.14)',
  accentBorder: 'rgba(255,120,104,0.34)',
  gold: '#F3C677',
  teal: COLORS.primary,
  tealSoft: 'rgba(0,210,190,0.12)',
  ink: '#090A0B',
  panel: '#111315',
  panelRaised: '#171A1C',
  line: 'rgba(255,255,255,0.10)',
};

const DISPLAY_FONT = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});

const TABS = [
  { id: 'discover', label: 'Discover', icon: 'compass' },
  { id: 'likes', label: 'Likes', icon: 'heart' },
  { id: 'matches', label: 'Matches', icon: 'chatbubble-outline' },
  { id: 'profile', label: 'Profile', icon: 'options-outline' },
];

const distanceLabel = (km) => (km == null ? 'Anywhere' : `${km} km`);

const firstLetter = (value) =>
  (typeof value === 'string' && value.trim() ? value.trim().charAt(0) : '?').toUpperCase();

const formatWhen = (value) => {
  const timestamp = Number(value || 0);
  if (!timestamp) return 'Recently';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
};

const datingActionError = (code) => {
  switch (code) {
    case 'subscription_required':
      return 'Dating likes need an active Plus plan or trial.';
    case 'dating_not_enabled':
      return 'Make your profile discoverable before choosing people.';
    case 'birth_year_required':
      return 'Add your birth year in Profile before choosing people.';
    case 'unauthenticated':
      return 'Sign in again, then retry.';
    case 'blocked':
      return "You can't interact with this person.";
    case 'rate_limited':
      return 'Take a breather and try again in a minute.';
    case 'target_unavailable':
      return 'This person is no longer available.';
    default:
      return 'Something interrupted that. Please try again.';
  }
};

const haptic = (kind = 'selection') => {
  try {
    if (kind === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else if (kind === 'soft') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else {
      Haptics.selectionAsync().catch(() => {});
    }
  } catch {
    // Haptics are optional.
  }
};

const ProfileImage = ({
  uri,
  name,
  style,
  fallbackStyle,
  letterStyle,
  gradient = false,
}) => {
  if (uri) {
    return <Image source={{ uri }} style={style} resizeMode="cover" />;
  }

  const content = (
    <View style={[style, styles.photoFallback, fallbackStyle]}>
      <Text style={[styles.photoFallbackLetter, letterStyle]}>{firstLetter(name)}</Text>
      <View style={styles.fallbackPulse} />
    </View>
  );

  if (!gradient) return content;
  return (
    <LinearGradient
      colors={['#16302D', '#172326', '#2B1919']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={style}
    >
      {content}
    </LinearGradient>
  );
};

const BrandLockup = () => (
  <View style={styles.brandLockup}>
    <View style={styles.brandNameRow}>
      <Text style={styles.brandName} allowFontScaling={false}>
        blyp
      </Text>
      <View style={styles.brandDot} />
    </View>
    <View style={styles.brandDivider} />
    <Text style={styles.brandDating}>DATING</Text>
  </View>
);

const GradientButton = ({
  label,
  onPress,
  icon,
  disabled = false,
  compact = false,
  teal = false,
  style,
}) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.86}
    style={[styles.gradientButtonOuter, compact && styles.gradientButtonCompact, style]}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <LinearGradient
      colors={
        teal
          ? [COLORS.primaryLight, COLORS.primary]
          : [DATING.accentBright, DATING.accent]
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.gradientButton,
        compact && styles.gradientButtonInnerCompact,
        disabled && styles.disabled,
      ]}
    >
      {disabled ? (
        <ActivityIndicator size="small" color={DATING.ink} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={DATING.ink} strokeWidth={2.5} /> : null}
          <Text style={styles.gradientButtonText}>{label}</Text>
        </>
      )}
    </LinearGradient>
  </TouchableOpacity>
);

const OrbitArtwork = ({ icon = 'heart', accent = DATING.accent }) => {
  const orbit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: 9000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [orbit]);

  const rotate = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.orbitArtwork}>
      <View style={styles.orbitCore}>
        <Icon name={icon} size={28} color={accent} />
      </View>
      <Animated.View style={[styles.orbitRing, { transform: [{ rotate }] }]}>
        <View style={[styles.orbitSatellite, { backgroundColor: accent }]} />
      </Animated.View>
      <View style={styles.orbitRingOuter} />
    </View>
  );
};

const EmptyState = ({
  icon,
  title,
  body,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  accent,
}) => (
  <View style={styles.emptyState}>
    <OrbitArtwork icon={icon} accent={accent} />
    <Text style={styles.emptyEyebrow}>YOUR ORBIT</Text>
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyBody}>{body}</Text>
    {primaryLabel ? (
      <GradientButton label={primaryLabel} onPress={onPrimary} icon="arrow-forward" />
    ) : null}
    {secondaryLabel ? (
      <TouchableOpacity
        style={styles.textButton}
        onPress={onSecondary}
        accessibilityRole="button"
      >
        <Text style={styles.textButtonLabel}>{secondaryLabel}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

const SectionHeading = ({ eyebrow, title, actionLabel, onAction }) => (
  <View style={styles.sectionHeading}>
    <View style={styles.sectionHeadingCopy}>
      {eyebrow ? <Text style={styles.sectionEyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.sectionHeadingTitle}>{title}</Text>
    </View>
    {actionLabel ? (
      <TouchableOpacity style={styles.sectionAction} onPress={onAction}>
        <Text style={styles.sectionActionText}>{actionLabel}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

const MatchMoment = ({
  visible,
  person,
  ownPhoto,
  ownName,
  onClose,
  onMessage,
  messaging,
}) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.matchModalBackdrop}>
      <LinearGradient
        colors={['rgba(0,210,190,0.20)', 'rgba(9,10,11,0.97)', 'rgba(255,120,104,0.18)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.matchModalCard}
      >
        <View style={styles.matchBurstOne} />
        <View style={styles.matchBurstTwo} />
        <Text style={styles.matchEyebrow}>MUTUAL INTEREST</Text>
        <Text style={styles.matchTitle}>You found each other.</Text>
        <Text style={styles.matchBody}>
          You and {person?.displayName || 'this person'} both chose yes. Start with something
          from their profile, not just “hey”.
        </Text>

        <View style={styles.matchFaces}>
          <View style={[styles.matchFace, styles.matchFaceLeft]}>
            <ProfileImage
              uri={ownPhoto}
              name={ownName}
              style={styles.matchFaceImage}
              fallbackStyle={styles.matchFaceFallback}
              letterStyle={styles.matchFaceLetter}
            />
          </View>
          <View style={styles.matchHeart}>
            <Icon name="heart" size={24} color={DATING.ink} fill={DATING.ink} />
          </View>
          <View style={[styles.matchFace, styles.matchFaceRight]}>
            <ProfileImage
              uri={person?.photoURL}
              name={person?.displayName}
              style={styles.matchFaceImage}
              fallbackStyle={styles.matchFaceFallback}
              letterStyle={styles.matchFaceLetter}
            />
          </View>
        </View>

        <GradientButton
          label="Send the first message"
          icon="send-outline"
          onPress={onMessage}
          disabled={messaging}
          style={styles.matchPrimary}
        />
        <TouchableOpacity style={styles.matchKeepLooking} onPress={onClose}>
          <Text style={styles.matchKeepLookingText}>Keep discovering</Text>
        </TouchableOpacity>
      </LinearGradient>
    </View>
  </Modal>
);

const DatingScreen = ({ navigation, embedded = false }) => {
  const { uid, user: authUser, getDisplayName } = useAuth();
  const entitled = useHasAI();
  const { width: viewportWidth } = useWindowDimensions();
  const Shell = embedded ? View : ScreenContainer;
  const shellProps = embedded ? { style: styles.embeddedRoot } : {};

  const [tab, setTab] = useState('discover');
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [matches, setMatches] = useState([]);
  const [incomingLikes, setIncomingLikes] = useState([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [likesLoading, setLikesLoading] = useState(false);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [reportTarget, setReportTarget] = useState(null);
  const [matchMoment, setMatchMoment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [connectionBusyId, setConnectionBusyId] = useState(null);
  const [chatBusyId, setChatBusyId] = useState(null);
  const [photoIndex, setPhotoIndex] = useState(0);

  const [bioDraft, setBioDraft] = useState('');
  const [birthYearDraft, setBirthYearDraft] = useState('');
  const [selectedPromptIds, setSelectedPromptIds] = useState([]);
  const [promptAnswers, setPromptAnswers] = useState({});

  const tabOpacity = useRef(new Animated.Value(1)).current;
  const tabLift = useRef(new Animated.Value(0)).current;
  const cardPan = useRef(new Animated.ValueXY()).current;

  const current = cards[cardIndex] || null;
  const cardWidth = Math.min(560, Math.max(288, viewportWidth - (embedded ? 24 : 32)));
  const cardHeight = Math.min(620, Math.max(430, cardWidth * 1.18));
  const currentPhotos = useMemo(() => {
    if (!current) return [];
    const photos = Array.isArray(current.photos) ? current.photos.filter(Boolean) : [];
    if (!photos.length && current.photoURL) photos.push(current.photoURL);
    return photos;
  }, [current]);

  const ownPhoto =
    authUser?.photoURL || authUser?.avatar || authUser?.profilePicture || null;
  const ownName =
    (typeof getDisplayName === 'function' ? getDisplayName() : null) ||
    authUser?.displayName ||
    authUser?.username ||
    'You';

  useEffect(() => {
    if (!prefs) return;
    setBioDraft(prefs.bio || '');
    setBirthYearDraft(prefs.birthYear != null ? String(prefs.birthYear) : '');
    const ids = (prefs.prompts || []).map((prompt) => prompt.id);
    setSelectedPromptIds(ids);
    const answers = {};
    (prefs.prompts || []).forEach((prompt) => {
      if (prompt?.id) answers[prompt.id] = prompt.answer || '';
    });
    setPromptAnswers(answers);
  }, [prefs]);

  useEffect(() => {
    setPhotoIndex(0);
    cardPan.stopAnimation();
    cardPan.setValue({ x: 0, y: 0 });
  }, [current?.id, cardPan]);

  useEffect(() => {
    tabOpacity.setValue(0);
    tabLift.setValue(8);
    Animated.parallel([
      Animated.timing(tabOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(tabLift, {
        toValue: 0,
        friction: 9,
        tension: 90,
        useNativeDriver: true,
      }),
    ]).start();
  }, [tab, tabLift, tabOpacity]);

  const refreshDiscovery = useCallback(async () => {
    if (!uid) {
      setCards([]);
      setCardIndex(0);
      return;
    }
    setDiscoveryLoading(true);
    setDiscoveryError('');
    try {
      await loadBlockedUsers().catch(() => {});
      const nextCards = await fetchDiscoveryCards(uid);
      setCards(nextCards);
      setCardIndex(0);
    } catch (error) {
      setCards([]);
      setCardIndex(0);
      setDiscoveryError(error?.message || 'Discovery could not refresh.');
    } finally {
      setDiscoveryLoading(false);
    }
  }, [uid]);

  const refreshMatches = useCallback(async () => {
    if (!uid) {
      setMatches([]);
      return;
    }
    setMatchesLoading(true);
    try {
      setMatches(await fetchMatches(uid));
    } finally {
      setMatchesLoading(false);
    }
  }, [uid]);

  const refreshLikes = useCallback(async () => {
    if (!uid) {
      setIncomingLikes([]);
      return;
    }
    setLikesLoading(true);
    try {
      setIncomingLikes(await fetchIncomingLikes(uid));
    } finally {
      setLikesLoading(false);
    }
  }, [uid]);

  const refresh = useCallback(async () => {
    if (!uid) {
      setPrefs(null);
      setCards([]);
      setMatches([]);
      setIncomingLikes([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      await loadBlockedUsers().catch(() => {});
      const nextPrefs = await getDatingPrefs(uid);
      setPrefs(nextPrefs);

      const [nextCards, nextMatches, nextLikes] = await Promise.all([
        canParticipateInDiscover(nextPrefs)
          ? fetchDiscoveryCards(uid).catch(() => [])
          : Promise.resolve([]),
        fetchMatches(uid).catch(() => []),
        fetchIncomingLikes(uid).catch(() => []),
      ]);
      setCards(nextCards);
      setCardIndex(0);
      setMatches(nextMatches);
      setIncomingLikes(nextLikes);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab === 'matches' && uid && prefs?.adultConfirmed) refreshMatches();
    if (tab === 'likes' && uid && prefs?.adultConfirmed) refreshLikes();
  }, [tab, uid, prefs?.adultConfirmed, refreshLikes, refreshMatches]);

  const selectTab = useCallback((nextTab) => {
    haptic();
    setTab(nextTab);
  }, []);

  const savePrefsPatch = useCallback(
    async (patch, { refreshCards = false } = {}) => {
      if (!uid || busy) return null;
      setBusy(true);
      try {
        const next = await setDatingPrefs(uid, patch);
        setPrefs(next);
        haptic('success');
        if (refreshCards && canParticipateInDiscover(next)) await refreshDiscovery();
        return next;
      } catch (error) {
        Alert.alert("Couldn't save", error?.message || 'Please try again.');
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
      haptic('success');
    } catch (error) {
      Alert.alert("Couldn't save", error?.message || 'Please try again.');
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
        Alert.alert(
          'Finish one detail',
          'Add your birth year below before making your profile discoverable.',
        );
        setTab('profile');
        return;
      }

      setBusy(true);
      try {
        const next = await setDatingOptIn(uid, value);
        setPrefs(next);
        haptic(value ? 'success' : 'selection');
        if (canParticipateInDiscover(next)) {
          await refreshDiscovery();
        } else {
          setCards([]);
          setCardIndex(0);
        }
      } catch (error) {
        Alert.alert("Couldn't update", error?.message || 'Please try again.');
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
        Alert.alert(
          'Birth year required',
          'Turn off discovery before clearing your birth year.',
        );
        return;
      }
      await savePrefsPatch({ birthYear: null });
      return;
    }

    const year = Number(trimmed);
    const latestAdultYear = new Date().getFullYear() - AGE_MIN_FLOOR;
    if (
      !Number.isInteger(year) ||
      trimmed.length !== 4 ||
      year < 1920 ||
      year > latestAdultYear
    ) {
      Alert.alert(
        'Check your birth year',
        `Enter a year from 1920 to ${latestAdultYear}. This is self-reported; Blyp does not ask for ID here.`,
      );
      return;
    }
    await savePrefsPatch({ birthYear: year }, { refreshCards: true });
  }, [savePrefsPatch, birthYearDraft, prefs?.optedIn]);

  const togglePromptSelection = useCallback((id) => {
    setSelectedPromptIds((previous) => {
      if (previous.includes(id)) return previous.filter((item) => item !== id);
      if (previous.length >= PROMPT_MAX) {
        Alert.alert('Prompt limit', `Choose up to ${PROMPT_MAX} conversation starters.`);
        return previous;
      }
      return [...previous, id];
    });
  }, []);

  const onSavePrompts = useCallback(async () => {
    const prompts = selectedPromptIds
      .map((id) => {
        const option = DATING_PROMPT_OPTIONS.find((item) => item.id === id);
        const answer = (promptAnswers[id] || '').trim();
        if (!option || !answer) return null;
        return { id, question: option.question, answer };
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
      const currentMin = prefs?.ageMin ?? AGE_MIN_FLOOR;
      const currentMax = prefs?.ageMax ?? AGE_MAX_CEIL;
      let ageMin = currentMin;
      let ageMax = currentMax;
      if (field === 'min') {
        ageMin = Math.max(
          AGE_MIN_FLOOR,
          Math.min(AGE_MAX_CEIL, currentMin + delta),
        );
      } else {
        ageMax = Math.max(
          AGE_MIN_FLOOR,
          Math.min(AGE_MAX_CEIL, currentMax + delta),
        );
      }
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
      const currentLookingFor = Array.isArray(prefs?.lookingFor)
        ? prefs.lookingFor
        : [];
      const next = currentLookingFor.includes(id)
        ? currentLookingFor.filter((item) => item !== id)
        : [...currentLookingFor, id];
      await savePrefsPatch({ lookingFor: next }, { refreshCards: true });
    },
    [prefs?.lookingFor, savePrefsPatch],
  );

  const captureGeo = useCallback(async () => {
    const response = await getCurrentGeo();
    if (!response.ok) {
      Alert.alert(
        'Location needed',
        response.reason === 'denied'
          ? 'Allow location access to filter by distance.'
          : 'Location is unavailable right now.',
      );
      return null;
    }
    return response.geo;
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

  const settleCard = useCallback(() => {
    Animated.spring(cardPan, {
      toValue: { x: 0, y: 0 },
      friction: 7,
      tension: 70,
      useNativeDriver: true,
    }).start();
  }, [cardPan]);

  const animateCardOut = useCallback(
    (direction) =>
      new Promise((resolve) => {
        Animated.timing(cardPan, {
          toValue: {
            x: direction * Math.max(viewportWidth * 1.3, 520),
            y: 18,
          },
          duration: 280,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          setCardIndex((index) => Math.min(index + 1, cards.length));
          cardPan.setValue({ x: 0, y: 0 });
          resolve();
        });
      }),
    [cardPan, cards.length, viewportWidth],
  );

  const runDiscoveryAction = useCallback(
    async (kind) => {
      if (!uid || !current || actionBusy) return;
      const target = current;
      const direction = kind === 'like' ? 1 : -1;
      setActionBusy(true);
      haptic('soft');
      try {
        const result =
          kind === 'like'
            ? await recordLike(uid, target.id)
            : await recordPass(uid, target.id);
        if (!result.ok) {
          settleCard();
          Alert.alert(
            kind === 'like' ? "Couldn't send that like" : "Couldn't pass",
            datingActionError(result.code),
          );
          return;
        }

        await animateCardOut(direction);
        if (kind === 'like' && result.matched) {
          haptic('success');
          setMatchMoment({
            ...target,
            otherUserId: target.id,
            matchId: result.matchId || undefined,
          });
          refreshMatches();
        }
        refreshLikes();
      } catch (error) {
        settleCard();
        Alert.alert(
          "That didn't go through",
          error?.message || 'Check your connection and try again.',
        );
      } finally {
        setActionBusy(false);
      }
    },
    [
      uid,
      current,
      actionBusy,
      animateCardOut,
      refreshLikes,
      refreshMatches,
      settleCard,
    ],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !!current &&
          !actionBusy &&
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: () => {
          cardPan.stopAnimation();
          cardPan.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: (_, gesture) => {
          cardPan.setValue({ x: gesture.dx, y: gesture.dy * 0.16 });
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 92) runDiscoveryAction('like');
          else if (gesture.dx < -92) runDiscoveryAction('pass');
          else settleCard();
        },
        onPanResponderTerminate: settleCard,
      }),
    [actionBusy, cardPan, current, runDiscoveryAction, settleCard],
  );

  const onBlockCurrent = useCallback(() => {
    if (!current || actionBusy) return;
    const target = current;
    Alert.alert(
      'Block this person?',
      `You and ${target.displayName} will no longer see each other across Blyp.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            setActionBusy(true);
            try {
              await blockUser(target.id);
              await recordPass(uid, target.id).catch(() => {});
              await animateCardOut(-1);
              refreshMatches();
              refreshLikes();
            } catch (error) {
              Alert.alert("Couldn't block", error?.message || 'Please try again.');
            } finally {
              setActionBusy(false);
            }
          },
        },
      ],
    );
  }, [
    current,
    actionBusy,
    uid,
    animateCardOut,
    refreshLikes,
    refreshMatches,
  ]);

  const handleIncomingAction = useCallback(
    async (item, kind) => {
      if (!item || connectionBusyId) return;
      if (!canParticipateInDiscover(prefs)) {
        Alert.alert(
          'Turn discovery on first',
          'Your Dating profile needs to be active before you can respond.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open profile', onPress: () => setTab('profile') },
          ],
        );
        return;
      }

      setConnectionBusyId(item.likeId || item.id);
      try {
        const result =
          kind === 'like'
            ? await recordLike(uid, item.id)
            : await recordPass(uid, item.id);
        if (!result.ok) {
          Alert.alert(
            kind === 'like' ? "Couldn't connect" : "Couldn't pass",
            datingActionError(result.code),
          );
          return;
        }

        setIncomingLikes((previous) =>
          previous.filter((like) => like.id !== item.id),
        );
        if (kind === 'like') {
          haptic('success');
          if (result.matched) {
            setMatchMoment({
              ...item,
              otherUserId: item.id,
              matchId: result.matchId || undefined,
            });
          }
          refreshMatches();
        } else {
          haptic('soft');
        }
      } catch (error) {
        Alert.alert(
          "That didn't go through",
          error?.message || 'Check your connection and try again.',
        );
      } finally {
        setConnectionBusyId(null);
      }
    },
    [connectionBusyId, prefs, uid, refreshMatches],
  );

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
          } catch (error) {
            Alert.alert(
              'Chat is reconnecting',
              error?.message || 'Please wait a moment and try again.',
            );
            return;
          }
        }

        const otherName = item.displayName || item.username || 'Blyp member';
        const conversationId =
          await conversationsMessagingService.createOrGetDirectThread(
            db,
            uid,
            otherUserId,
            ownName,
            otherName,
          );

        navigation.navigate('ChatConversation', {
          conversationId,
          chatId: conversationId,
          otherUser: {
            id: otherUserId,
            username: item.username || null,
            displayName: otherName,
            photoURL: item.photoURL || null,
            avatar: item.photoURL || null,
          },
        });
      } catch {
        Alert.alert('Chat could not open', 'Please try again.');
      } finally {
        setChatBusyId(null);
      }
    },
    [uid, chatBusyId, navigation, ownName],
  );

  const lookingFor = Array.isArray(prefs?.lookingFor) ? prefs.lookingFor : [];
  const needsBirthYear =
    !!prefs?.optedIn && !(prefs?.birthYear != null && Number(prefs.birthYear) > 0);
  const isDiscoverable = canParticipateInDiscover(prefs);
  const remainingCards = Math.max(0, cards.length - cardIndex);

  const readinessItems = useMemo(
    () => [
      {
        id: 'photo',
        label: 'A clear photo',
        done: prefs?.useProfilePhoto !== false && !!ownPhoto,
      },
      { id: 'bio', label: 'A short intro', done: !!prefs?.bio?.trim() },
      {
        id: 'prompt',
        label: 'A conversation starter',
        done: (prefs?.prompts || []).length > 0,
      },
      { id: 'birth', label: 'Your age', done: prefs?.birthYear != null },
      { id: 'intent', label: 'Who you want to meet', done: lookingFor.length > 0 },
    ],
    [
      lookingFor.length,
      ownPhoto,
      prefs?.bio,
      prefs?.birthYear,
      prefs?.prompts,
      prefs?.useProfilePhoto,
    ],
  );
  const readinessDone = readinessItems.filter((item) => item.done).length;
  const readinessPercent = Math.round(
    (readinessDone / readinessItems.length) * 100,
  );

  const cardRotate = cardPan.x.interpolate({
    inputRange: [-Math.max(viewportWidth, 320), 0, Math.max(viewportWidth, 320)],
    outputRange: ['-7deg', '0deg', '7deg'],
    extrapolate: 'clamp',
  });
  const likeStampOpacity = cardPan.x.interpolate({
    inputRange: [20, 100],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const passStampOpacity = cardPan.x.interpolate({
    inputRange: [-100, -20],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const renderHeader = () => (
    <View style={[styles.header, embedded && styles.headerEmbedded]}>
      {!embedded ? (
        <TouchableOpacity
          style={styles.headerIcon}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Back"
        >
          <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.headerIcon} />
      )}
      <BrandLockup />
      <TouchableOpacity
        style={styles.headerStatus}
        onPress={() => selectTab('profile')}
        accessibilityLabel={
          isDiscoverable ? 'Dating profile is visible' : 'Dating profile is hidden'
        }
      >
        <View
          style={[
            styles.statusDot,
            isDiscoverable ? styles.statusDotLive : styles.statusDotHidden,
          ]}
        />
        <Text style={styles.statusText}>
          {isDiscoverable ? 'VISIBLE' : 'HIDDEN'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderTabs = () => (
    <View style={styles.tabsOuter}>
      <View style={styles.tabs}>
        {TABS.map((item) => {
          const active = tab === item.id;
          const count =
            item.id === 'likes'
              ? incomingLikes.length
              : item.id === 'matches'
                ? matches.length
                : 0;
          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => selectTab(item.id)}
              activeOpacity={0.82}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <View style={styles.tabIconWrap}>
                <Icon
                  name={item.icon}
                  size={18}
                  color={active ? DATING.accentBright : COLORS.textMuted}
                  fill={active && item.id === 'likes' ? DATING.accentBright : false}
                  strokeWidth={active ? 2.4 : 2}
                />
                {count > 0 ? (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>
                      {count > 9 ? '9+' : count}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const frame = (content, { withTabs = false } = {}) => (
    <Shell {...shellProps}>
      <LinearGradient
        colors={['#0B1110', DATING.ink, '#110D0D']}
        locations={[0, 0.52, 1]}
        style={styles.atmosphere}
      >
        <View pointerEvents="none" style={styles.glowTeal} />
        <View pointerEvents="none" style={styles.glowWarm} />
        <View style={styles.frame}>
          {renderHeader()}
          {withTabs ? renderTabs() : null}
          {content}
        </View>
      </LinearGradient>
    </Shell>
  );

  if (!entitled) {
    return frame(
      <ScrollView
        contentContainerStyle={styles.gateScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.gateVisual}>
          <View style={styles.gateHaloOne} />
          <View style={styles.gateHaloTwo} />
          <View style={styles.gateHeart}>
            <Icon name="heart" size={34} color={DATING.accent} fill={DATING.accent} />
          </View>
        </View>
        <Text style={styles.gateEyebrow}>BLYP PLUS</Text>
        <Text style={styles.gateTitle}>Meet beyond the feed.</Text>
        <Text style={styles.gateBody}>
          Dating is included with the same Blyp Plus plan or trial as Blyp AI.
          Discover real profiles, see who chose you, and message mutual matches.
        </Text>
        <View style={styles.gateFeatures}>
          {[
            ['compass', 'Preference-led discovery'],
            ['heart', 'See who likes you'],
            ['message', 'Chat after a mutual match'],
          ].map(([icon, label]) => (
            <View key={label} style={styles.gateFeature}>
              <View style={styles.gateFeatureIcon}>
                <Icon name={icon} size={18} color={DATING.accentBright} />
              </View>
              <Text style={styles.gateFeatureText}>{label}</Text>
            </View>
          ))}
        </View>
        <GradientButton
          label="Explore Blyp Plus"
          icon="arrow-forward"
          onPress={() => navigation.navigate('Plans')}
          style={styles.gateCta}
        />
        {!embedded ? (
          <TouchableOpacity style={styles.textButton} onPress={() => navigation.goBack()}>
            <Text style={styles.textButtonLabel}>Maybe later</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>,
    );
  }

  if (loading) {
    return frame(
      <View style={styles.loadingScene}>
        <OrbitArtwork icon="heart" />
        <Text style={styles.loadingTitle}>Finding your orbit</Text>
        <Text style={styles.loadingBody}>Loading profiles and connections…</Text>
      </View>,
    );
  }

  if (!uid || !prefs) {
    return frame(
      <EmptyState
        icon="lock"
        title="Sign in to meet people."
        body="Dating profiles and matches are tied to your Blyp account."
      />,
    );
  }

  if (!prefs.adultConfirmed) {
    return frame(
      <ScrollView
        contentContainerStyle={styles.gateScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.ageSeal}>
          <Text style={styles.ageSealNumber}>18+</Text>
          <Text style={styles.ageSealLabel}>ADULTS ONLY</Text>
        </View>
        <Text style={styles.gateEyebrow}>BEFORE THE FIRST HELLO</Text>
        <Text style={styles.gateTitle}>A space for adults.</Text>
        <Text style={styles.gateBody}>
          Confirm you are at least 18 years old. Your profile stays hidden until
          you finish setup and explicitly turn discovery on.
        </Text>
        <View style={styles.assuranceCard}>
          <Icon name="shield-checkmark-outline" size={22} color={DATING.teal} />
          <Text style={styles.assuranceText}>
            Report and block are always available. You control your visibility
            from Profile at any time.
          </Text>
        </View>
        <GradientButton
          label="I am 18 or older"
          icon="checkmark"
          onPress={onConfirmAdult}
          disabled={busy}
          style={styles.gateCta}
        />
        {!embedded ? (
          <TouchableOpacity style={styles.textButton} onPress={() => navigation.goBack()}>
            <Text style={styles.textButtonLabel}>Not now</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>,
    );
  }

  const renderDiscoveryCard = () => {
    if (!current) return null;
    const visiblePhoto = currentPhotos[photoIndex] || current.photoURL;
    const distance =
      current.distanceKm != null ? `${current.distanceKm} km away` : 'On Blyp';
    const firstPrompt = (current.prompts || [])[0];

    return (
      <>
        <Animated.View
          key={current.id}
          {...panResponder.panHandlers}
          style={[
            styles.discoveryCard,
            {
              width: cardWidth,
              height: cardHeight,
              transform: [
                ...cardPan.getTranslateTransform(),
                { rotate: cardRotate },
              ],
            },
          ]}
        >
          {visiblePhoto ? (
            <Image
              source={{ uri: visiblePhoto }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : (
            <LinearGradient
              colors={['#16302D', '#172326', '#321B1A']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            >
              <View style={styles.discoveryFallback}>
                <Text style={styles.discoveryFallbackLetter}>
                  {firstLetter(current.displayName)}
                </Text>
                <Text style={styles.discoveryFallbackCaption}>PROFILE IN PROGRESS</Text>
              </View>
            </LinearGradient>
          )}

          <LinearGradient
            colors={[
              'rgba(0,0,0,0.12)',
              'rgba(0,0,0,0.02)',
              'rgba(7,8,9,0.92)',
            ]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />

          {currentPhotos.length > 1 ? (
            <>
              <TouchableOpacity
                style={[styles.photoTapZone, styles.photoTapLeft]}
                onPress={() =>
                  setPhotoIndex((index) =>
                    index === 0 ? currentPhotos.length - 1 : index - 1,
                  )
                }
                accessibilityLabel="Previous photo"
              />
              <TouchableOpacity
                style={[styles.photoTapZone, styles.photoTapRight]}
                onPress={() =>
                  setPhotoIndex((index) => (index + 1) % currentPhotos.length)
                }
                accessibilityLabel="Next photo"
              />
              <View pointerEvents="none" style={styles.photoProgress}>
                {currentPhotos.map((photo, index) => (
                  <View
                    key={`${photo}-${index}`}
                    style={[
                      styles.photoProgressTrack,
                      index === photoIndex && styles.photoProgressTrackActive,
                    ]}
                  />
                ))}
              </View>
            </>
          ) : null}

          <View pointerEvents="none" style={styles.cardTopMeta}>
            <View style={styles.curatedPill}>
              <View style={styles.curatedDot} />
              <Text style={styles.curatedPillText}>IN YOUR ORBIT</Text>
            </View>
            <View style={styles.distancePill}>
              <Icon name="location-outline" size={14} color={COLORS.textPrimary} />
              <Text style={styles.distancePillText}>{distance}</Text>
            </View>
          </View>

          <Animated.View
            pointerEvents="none"
            style={[
              styles.swipeStamp,
              styles.swipeStampLike,
              { opacity: likeStampOpacity },
            ]}
          >
            <Text style={styles.swipeStampLikeText}>YES</Text>
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.swipeStamp,
              styles.swipeStampPass,
              { opacity: passStampOpacity },
            ]}
          >
            <Text style={styles.swipeStampPassText}>PASS</Text>
          </Animated.View>

          <View pointerEvents="none" style={styles.discoveryCopy}>
            <View style={styles.nameRow}>
              <Text style={styles.personName} numberOfLines={1}>
                {current.displayName}
              </Text>
              {current.age != null ? (
                <Text style={styles.personAge}>{current.age}</Text>
              ) : null}
            </View>
            {current.bio ? (
              <Text style={styles.personBio} numberOfLines={3}>
                {current.bio}
              </Text>
            ) : (
              <Text style={styles.personBio} numberOfLines={2}>
                {current.tagline || 'A new person on Blyp Dating.'}
              </Text>
            )}
            {firstPrompt ? (
              <View style={styles.featuredPrompt}>
                <Text style={styles.featuredPromptQuestion}>
                  {firstPrompt.question}
                </Text>
                <Text style={styles.featuredPromptAnswer} numberOfLines={2}>
                  {firstPrompt.answer}
                </Text>
              </View>
            ) : null}
          </View>
        </Animated.View>

        <View style={[styles.discoveryActions, { width: cardWidth }]}>
          <TouchableOpacity
            style={[styles.actionButton, styles.passButton]}
            onPress={() => runDiscoveryAction('pass')}
            disabled={actionBusy}
            activeOpacity={0.78}
            accessibilityLabel={`Pass on ${current.displayName}`}
          >
            <Icon name="close" size={28} color={COLORS.textPrimary} strokeWidth={2.4} />
          </TouchableOpacity>
          <View style={styles.actionHint}>
            <Text style={styles.actionHintText}>SWIPE OR CHOOSE</Text>
          </View>
          <TouchableOpacity
            style={[styles.actionButton, styles.likeButton]}
            onPress={() => runDiscoveryAction('like')}
            disabled={actionBusy}
            activeOpacity={0.82}
            accessibilityLabel={`Like ${current.displayName}`}
          >
            <LinearGradient
              colors={[DATING.accentBright, DATING.accent]}
              style={styles.likeButtonGradient}
            >
              {actionBusy ? (
                <ActivityIndicator color={DATING.ink} />
              ) : (
                <Icon
                  name="heart"
                  size={29}
                  color={DATING.ink}
                  fill={DATING.ink}
                  strokeWidth={2.2}
                />
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <View style={[styles.safetyActions, { width: cardWidth }]}>
          <TouchableOpacity
            style={styles.safetyAction}
            onPress={() =>
              setReportTarget({ id: current.id, label: current.displayName })
            }
          >
            <Icon name="flag" size={15} color={COLORS.textMuted} />
            <Text style={styles.safetyActionText}>Report</Text>
          </TouchableOpacity>
          <View style={styles.safetyDivider} />
          <TouchableOpacity style={styles.safetyAction} onPress={onBlockCurrent}>
            <Icon name="hand-left-outline" size={15} color={COLORS.textMuted} />
            <Text style={styles.safetyActionText}>Block</Text>
          </TouchableOpacity>
        </View>

        {(current.prompts || []).length > 1 ? (
          <View style={[styles.promptDeck, { width: cardWidth }]}>
            <SectionHeading
              eyebrow="CONVERSATION STARTERS"
              title={`More from ${current.displayName}`}
            />
            {current.prompts.slice(1).map((prompt, index) => (
              <LinearGradient
                key={prompt.id}
                colors={
                  index % 2 === 0
                    ? ['rgba(255,120,104,0.12)', 'rgba(255,255,255,0.03)']
                    : ['rgba(0,210,190,0.10)', 'rgba(255,255,255,0.03)']
                }
                style={styles.promptCard}
              >
                <Text style={styles.promptQuestion}>{prompt.question}</Text>
                <Text style={styles.promptAnswer}>{prompt.answer}</Text>
              </LinearGradient>
            ))}
          </View>
        ) : null}
      </>
    );
  };

  const renderDiscover = () => (
    <ScrollView
      style={styles.panel}
      contentContainerStyle={styles.discoverContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.discoverIntro, { width: cardWidth }]}>
        <View style={styles.discoverIntroCopy}>
          <Text style={styles.discoverEyebrow}>
            {isDiscoverable ? 'DISCOVERY IS LIVE' : 'YOUR PROFILE IS PRIVATE'}
          </Text>
          <Text style={styles.discoverTitle}>Meet beyond the feed.</Text>
          <Text style={styles.discoverSubtitle}>
            Mutual interest, real profiles, and no cold messages.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.filterButton}
          onPress={() => selectTab('profile')}
          accessibilityLabel="Open discovery filters"
        >
          <Icon name="options-outline" size={21} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      {!prefs.optedIn ? (
        <EmptyState
          icon="eye-off"
          title="You are browsing privately."
          body="Finish your profile, then turn discovery on when you are ready. Nobody sees you before that."
          primaryLabel="Set up my profile"
          onPrimary={() => selectTab('profile')}
        />
      ) : needsBirthYear ? (
        <EmptyState
          icon="calendar-outline"
          title="One detail before discovery."
          body="Add your self-reported birth year so adult-only age preferences work."
          primaryLabel="Add birth year"
          onPrimary={() => selectTab('profile')}
        />
      ) : discoveryLoading ? (
        <View style={styles.inlineLoading}>
          <OrbitArtwork icon="compass" accent={DATING.teal} />
          <Text style={styles.inlineLoadingTitle}>Refreshing your orbit</Text>
        </View>
      ) : discoveryError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Discovery is taking a pause."
          body={discoveryError}
          primaryLabel="Try again"
          onPrimary={refreshDiscovery}
          secondaryLabel="Check my filters"
          onSecondary={() => selectTab('profile')}
        />
      ) : current ? (
        <>
          <View style={[styles.queueRow, { width: cardWidth }]}>
            <Text style={styles.queueText}>
              {remainingCards} {remainingCards === 1 ? 'profile' : 'profiles'} in your orbit
            </Text>
            <Text style={styles.queuePrivacy}>Only opted-in adults</Text>
          </View>
          {renderDiscoveryCard()}
        </>
      ) : (
        <EmptyState
          icon="checkmark-circle"
          accent={DATING.teal}
          title="You have met everyone here."
          body="New people will appear as they join your orbit. Your past choices and block list remain respected."
          primaryLabel="Check again"
          onPrimary={refreshDiscovery}
          secondaryLabel="Widen my preferences"
          onSecondary={() => selectTab('profile')}
        />
      )}
    </ScrollView>
  );

  const renderLikeCard = (item) => {
    const itemBusy = connectionBusyId === (item.likeId || item.id);
    return (
      <View key={item.likeId || item.id} style={styles.likeCard}>
        <View style={styles.likePhotoWrap}>
          <ProfileImage
            uri={item.photoURL}
            name={item.displayName}
            style={styles.likePhoto}
            fallbackStyle={styles.likePhotoFallback}
            letterStyle={styles.likePhotoLetter}
          />
          <LinearGradient
            colors={['transparent', 'rgba(8,9,10,0.92)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.likedYouPill}>
            <Icon name="heart" size={11} color={DATING.accentBright} fill={DATING.accentBright} />
            <Text style={styles.likedYouPillText}>LIKED YOU</Text>
          </View>
          <TouchableOpacity
            style={styles.likeDismiss}
            onPress={() => handleIncomingAction(item, 'pass')}
            disabled={itemBusy}
            accessibilityLabel={`Pass on ${item.displayName}`}
          >
            <Icon name="close" size={16} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={styles.likeIdentity}>
            <Text style={styles.likeName} numberOfLines={1}>
              {item.displayName}
              {item.age != null ? `, ${item.age}` : ''}
            </Text>
            <Text style={styles.likeMeta} numberOfLines={1}>
              {item.distanceKm != null ? `${item.distanceKm} km away` : formatWhen(item.likedAt)}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.connectButton}
          onPress={() => handleIncomingAction(item, 'like')}
          disabled={itemBusy}
          activeOpacity={0.82}
          accessibilityLabel={`Connect with ${item.displayName}`}
        >
          {itemBusy ? (
            <ActivityIndicator size="small" color={DATING.ink} />
          ) : (
            <>
              <Icon name="heart" size={16} color={DATING.ink} fill={DATING.ink} />
              <Text style={styles.connectButtonText}>Connect</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderLikes = () => (
    <ScrollView
      style={styles.panel}
      contentContainerStyle={styles.connectionContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.connectionHero}>
        <View style={styles.connectionHeroIcon}>
          <Icon name="heart" size={25} color={DATING.accent} fill={DATING.accent} />
        </View>
        <View style={styles.connectionHeroCopy}>
          <Text style={styles.connectionEyebrow}>LIKES YOU</Text>
          <Text style={styles.connectionTitle}>They noticed you.</Text>
          <Text style={styles.connectionBody}>
            Choose them back to make it a match. No message arrives before it is mutual.
          </Text>
        </View>
      </View>

      {!isDiscoverable && incomingLikes.length > 0 ? (
        <TouchableOpacity
          style={styles.visibilityNotice}
          onPress={() => selectTab('profile')}
        >
          <Icon name="eye-off" size={19} color={DATING.gold} />
          <Text style={styles.visibilityNoticeText}>
            Your profile is hidden. Turn discovery on before responding.
          </Text>
          <Icon name="chevron-forward" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      ) : null}

      {likesLoading ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={DATING.accent} />
          <Text style={styles.inlineLoadingTitle}>Checking new likes</Text>
        </View>
      ) : incomingLikes.length === 0 ? (
        <EmptyState
          icon="heart-outline"
          title="No likes waiting — yet."
          body="A complete profile gives people something specific to connect with. Add a prompt, then keep discovering."
          primaryLabel="Discover people"
          onPrimary={() => selectTab('discover')}
          secondaryLabel="Improve my profile"
          onSecondary={() => selectTab('profile')}
        />
      ) : (
        <>
          <SectionHeading
            eyebrow={`${incomingLikes.length} WAITING`}
            title="Choose at your pace"
            actionLabel="Refresh"
            onAction={refreshLikes}
          />
          <View style={styles.likesGrid}>{incomingLikes.map(renderLikeCard)}</View>
        </>
      )}
    </ScrollView>
  );

  const renderMatchRow = (item, index) => {
    const rowKey = item.matchId || item.id;
    const opening = chatBusyId === rowKey;
    const unavailable = !!item.unavailable || !(item.otherUserId || item.id);
    return (
      <TouchableOpacity
        key={rowKey}
        style={[styles.matchRow, unavailable && styles.matchRowUnavailable]}
        onPress={() => openMatchChat(item)}
        activeOpacity={0.82}
        disabled={!!chatBusyId}
        accessibilityLabel={
          unavailable ? 'Match unavailable' : `Message ${item.displayName || 'match'}`
        }
      >
        <AvatarRing
          size={64}
          variant={index === 0 && !unavailable ? 'brand' : 'none'}
          animated={false}
        >
          <ProfileImage
            uri={!unavailable ? item.photoURL : null}
            name={item.displayName}
            style={styles.matchAvatar}
            fallbackStyle={styles.matchAvatarFallback}
            letterStyle={styles.matchAvatarLetter}
          />
        </AvatarRing>
        <View style={styles.matchCopy}>
          <View style={styles.matchNameRow}>
            <Text style={styles.matchName} numberOfLines={1}>
              {unavailable ? 'Unavailable' : item.displayName}
            </Text>
            {index === 0 && !unavailable ? (
              <View style={styles.newMatchPill}>
                <Text style={styles.newMatchPillText}>NEWEST</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.matchMeta} numberOfLines={2}>
            {unavailable
              ? 'This account is no longer available.'
              : item.prompts?.[0]?.answer ||
                item.bio ||
                'You chose each other. Start the conversation.'}
          </Text>
          {!unavailable ? (
            <Text style={styles.matchWhen}>
              Matched {formatWhen(item.createdAt)}
            </Text>
          ) : null}
        </View>
        <View style={styles.messageMatchButton}>
          {opening ? (
            <ActivityIndicator size="small" color={DATING.ink} />
          ) : (
            <Icon name="send-outline" size={18} color={DATING.ink} strokeWidth={2.4} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderMatches = () => (
    <ScrollView
      style={styles.panel}
      contentContainerStyle={styles.connectionContent}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient
        colors={['rgba(0,210,190,0.18)', 'rgba(255,255,255,0.035)']}
        style={styles.matchesHero}
      >
        <View style={styles.matchesFaces}>
          <View style={[styles.miniFace, styles.miniFaceBack]}>
            <Icon name="user" size={22} color={COLORS.textSecondary} />
          </View>
          <View style={[styles.miniFace, styles.miniFaceFront]}>
            <Icon name="heart" size={20} color={DATING.accent} fill={DATING.accent} />
          </View>
        </View>
        <View style={styles.matchesHeroCopy}>
          <Text style={styles.connectionEyebrow}>MUTUAL CONNECTIONS</Text>
          <Text style={styles.connectionTitle}>Start with what stood out.</Text>
          <Text style={styles.connectionBody}>
            Their bio and prompts are a better first message than a blank hello.
          </Text>
        </View>
      </LinearGradient>

      {matchesLoading ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={DATING.teal} />
          <Text style={styles.inlineLoadingTitle}>Loading your matches</Text>
        </View>
      ) : matches.length === 0 ? (
        <EmptyState
          icon="message"
          accent={DATING.teal}
          title="No mutual matches yet."
          body="When someone you choose also chooses you, the conversation opens here."
          primaryLabel="Go to discovery"
          onPrimary={() => selectTab('discover')}
          secondaryLabel="See who likes me"
          onSecondary={() => selectTab('likes')}
        />
      ) : (
        <>
          <SectionHeading
            eyebrow={`${matches.length} ${matches.length === 1 ? 'CONNECTION' : 'CONNECTIONS'}`}
            title="Your matches"
            actionLabel="Refresh"
            onAction={refreshMatches}
          />
          <View style={styles.matchesList}>
            {matches.map((item, index) => renderMatchRow(item, index))}
          </View>
        </>
      )}
    </ScrollView>
  );

  const renderOptionChip = (label, active, onPress, key, disabled = busy) => (
    <TouchableOpacity
      key={key}
      style={[styles.optionChip, active && styles.optionChipActive]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.82}
    >
      {active ? <View style={styles.optionChipDot} /> : null}
      <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderProfile = () => (
    <ScrollView
      style={styles.panel}
      contentContainerStyle={styles.profileContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient
        colors={['rgba(255,120,104,0.17)', 'rgba(0,210,190,0.08)', '#151718']}
        style={styles.readinessCard}
      >
        <View style={styles.readinessTop}>
          <View>
            <Text style={styles.profileEyebrow}>PROFILE STRENGTH</Text>
            <Text style={styles.readinessTitle}>
              {readinessPercent === 100 ? 'Ready to be remembered.' : 'Give them a reason to stop.'}
            </Text>
          </View>
          <View style={styles.readinessScore}>
            <Text style={styles.readinessScoreValue}>{readinessPercent}</Text>
            <Text style={styles.readinessScoreUnit}>%</Text>
          </View>
        </View>
        <View style={styles.readinessTrack}>
          <LinearGradient
            colors={[DATING.accent, DATING.teal]}
            style={[styles.readinessFill, { width: `${readinessPercent}%` }]}
          />
        </View>
        <View style={styles.readinessChecks}>
          {readinessItems.map((item) => (
            <View key={item.id} style={styles.readinessCheck}>
              <Icon
                name={item.done ? 'check-circle' : 'ellipse-outline'}
                size={15}
                color={item.done ? DATING.teal : COLORS.textMuted}
              />
              <Text
                style={[
                  styles.readinessCheckText,
                  item.done && styles.readinessCheckTextDone,
                ]}
              >
                {item.label}
              </Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      <View style={styles.visibilityCard}>
        <View style={styles.visibilityIconWrap}>
          <Icon
            name={prefs.optedIn ? 'eye' : 'eye-off'}
            size={22}
            color={prefs.optedIn ? DATING.teal : COLORS.textMuted}
          />
        </View>
        <View style={styles.visibilityCopy}>
          <Text style={styles.preferenceTitle}>
            {prefs.optedIn ? 'Visible in discovery' : 'Profile hidden'}
          </Text>
          <Text style={styles.preferenceBody}>
            {prefs.optedIn
              ? 'Other opted-in adults can find your card.'
              : 'Nobody can discover your Dating profile.'}
          </Text>
        </View>
        <Switch
          value={!!prefs.optedIn}
          onValueChange={onToggleOptIn}
          disabled={busy}
          trackColor={{ false: '#323438', true: 'rgba(0,210,190,0.48)' }}
          thumbColor={prefs.optedIn ? DATING.teal : COLORS.textMuted}
        />
      </View>

      <View style={styles.profilePreview}>
        <ProfileImage
          uri={prefs.useProfilePhoto !== false ? ownPhoto : null}
          name={ownName}
          style={styles.profilePreviewImage}
          fallbackStyle={styles.profilePreviewFallback}
          letterStyle={styles.profilePreviewLetter}
        />
        <View style={styles.profilePreviewCopy}>
          <Text style={styles.profilePreviewEyebrow}>YOUR CARD</Text>
          <Text style={styles.profilePreviewName} numberOfLines={1}>
            {ownName}
            {prefs.birthYear
              ? `, ${new Date().getFullYear() - Number(prefs.birthYear)}`
              : ''}
          </Text>
          <Text style={styles.profilePreviewBio} numberOfLines={2}>
            {prefs.bio || 'Your short intro will appear here.'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.editPhotoButton}
          onPress={() => navigation.navigate('EditProfile')}
          accessibilityLabel="Edit main profile photo"
        >
          <Icon name="camera-outline" size={18} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.preferenceSection}>
        <SectionHeading eyebrow="FIRST IMPRESSION" title="Your intro" />
        <Text style={styles.fieldLabel}>Short bio</Text>
        <TextInput
          style={styles.textArea}
          value={bioDraft}
          onChangeText={setBioDraft}
          placeholder="What would make the right person curious?"
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={BIO_MAX}
          textAlignVertical="top"
        />
        <View style={styles.fieldFooter}>
          <Text style={styles.charCount}>
            {bioDraft.length}/{BIO_MAX}
          </Text>
          <GradientButton
            label="Save intro"
            onPress={onSaveBio}
            disabled={busy}
            compact
          />
        </View>

        <View style={styles.inlinePreference}>
          <View style={styles.inlinePreferenceCopy}>
            <Text style={styles.preferenceTitle}>Use my Blyp profile photo</Text>
            <Text style={styles.preferenceBody}>
              Update the photo from your main Blyp profile.
            </Text>
          </View>
          <Switch
            value={prefs.useProfilePhoto !== false}
            onValueChange={onToggleUseProfilePhoto}
            disabled={busy}
            trackColor={{ false: '#323438', true: 'rgba(255,120,104,0.48)' }}
            thumbColor={
              prefs.useProfilePhoto !== false ? DATING.accent : COLORS.textMuted
            }
          />
        </View>
      </View>

      <View style={styles.preferenceSection}>
        <SectionHeading
          eyebrow="CONVERSATION STARTERS"
          title={`Choose up to ${PROMPT_MAX}`}
        />
        <Text style={styles.sectionDescription}>
          Specific answers make it easier for someone to send a thoughtful first message.
        </Text>
        <View style={styles.chipRow}>
          {DATING_PROMPT_OPTIONS.map((prompt) =>
            renderOptionChip(
              prompt.question,
              selectedPromptIds.includes(prompt.id),
              () => togglePromptSelection(prompt.id),
              prompt.id,
              false,
            ),
          )}
        </View>
        {selectedPromptIds.map((id) => {
          const option = DATING_PROMPT_OPTIONS.find((prompt) => prompt.id === id);
          if (!option) return null;
          return (
            <View key={`answer-${id}`} style={styles.promptEditor}>
              <Text style={styles.promptEditorLabel}>{option.question}</Text>
              <TextInput
                style={styles.textInput}
                value={promptAnswers[id] || ''}
                onChangeText={(text) =>
                  setPromptAnswers((previous) => ({ ...previous, [id]: text }))
                }
                placeholder="Make it yours…"
                placeholderTextColor={COLORS.textMuted}
                maxLength={120}
              />
            </View>
          );
        })}
        <View style={styles.sectionButtonRow}>
          <GradientButton
            label="Save prompts"
            onPress={onSavePrompts}
            disabled={busy}
            compact
          />
        </View>
      </View>

      <View style={styles.preferenceSection}>
        <SectionHeading eyebrow="THE BASICS" title="About you" />
        <Text style={styles.fieldLabel}>Birth year</Text>
        <Text style={styles.fieldHelper}>
          Self-reported and used for age preferences. Blyp does not request government ID here.
        </Text>
        <View style={styles.birthYearRow}>
          <TextInput
            style={[styles.textInput, styles.birthYearInput]}
            value={birthYearDraft}
            onChangeText={setBirthYearDraft}
            placeholder="1995"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="number-pad"
            maxLength={4}
          />
          <GradientButton
            label="Save"
            onPress={onSaveBirthYear}
            disabled={busy}
            compact
          />
        </View>

        <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>I am</Text>
        <View style={styles.chipRow}>
          {DATING_GENDER_OPTIONS.map((gender) =>
            renderOptionChip(
              gender.label,
              prefs.gender === gender.id,
              () => onSelectGender(gender.id),
              gender.id,
            ),
          )}
        </View>
      </View>

      <View style={styles.preferenceSection}>
        <SectionHeading eyebrow="YOUR ORBIT" title="Discovery preferences" />
        <Text style={styles.fieldLabel}>Age range</Text>
        <View style={styles.ageRangeSummary}>
          <Text style={styles.ageRangeValue}>
            {prefs.ageMin ?? AGE_MIN_FLOOR}
          </Text>
          <View style={styles.ageRangeLine} />
          <Text style={styles.ageRangeValue}>
            {prefs.ageMax ?? AGE_MAX_CEIL}
          </Text>
        </View>
        <View style={styles.steppers}>
          {[
            ['min', 'Minimum', prefs.ageMin ?? AGE_MIN_FLOOR],
            ['max', 'Maximum', prefs.ageMax ?? AGE_MAX_CEIL],
          ].map(([field, label, value]) => (
            <View key={field} style={styles.stepper}>
              <Text style={styles.stepperLabel}>{label}</Text>
              <View style={styles.stepperControls}>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => onAdjustAge(field, -1)}
                  disabled={busy}
                  accessibilityLabel={`Decrease ${label.toLowerCase()} age`}
                >
                  <Icon name="remove" size={18} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{value}</Text>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => onAdjustAge(field, 1)}
                  disabled={busy}
                  accessibilityLabel={`Increase ${label.toLowerCase()} age`}
                >
                  <Icon name="add" size={18} color={COLORS.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Looking for</Text>
        <View style={styles.chipRow}>
          {DATING_GENDER_OPTIONS.map((gender) =>
            renderOptionChip(
              gender.label,
              lookingFor.includes(gender.id),
              () => onToggleLookingFor(gender.id),
              `looking-${gender.id}`,
            ),
          )}
        </View>

        <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Maximum distance</Text>
        <View style={styles.chipRow}>
          {DISTANCE_OPTIONS_KM.map((km) =>
            renderOptionChip(
              distanceLabel(km),
              (prefs.maxDistanceKm == null && km == null) ||
                prefs.maxDistanceKm === km,
              () => onSelectDistance(km),
              `distance-${String(km)}`,
            ),
          )}
        </View>
        {prefs.maxDistanceKm != null && prefs.maxDistanceKm > 0 ? (
          <TouchableOpacity
            style={styles.locationUpdate}
            onPress={onUpdateLocation}
            disabled={busy}
          >
            <Icon name="location-outline" size={18} color={DATING.teal} />
            <Text style={styles.locationUpdateText}>Update my current location</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.safetyCard}>
        <View style={styles.safetyCardIcon}>
          <Icon name="shield-checkmark" size={23} color={DATING.teal} />
        </View>
        <View style={styles.safetyCardCopy}>
          <Text style={styles.safetyCardTitle}>Your pace. Your boundaries.</Text>
          <Text style={styles.safetyCardBody}>
            Likes stay private until mutual. Reporting and blocking apply across Blyp,
            and you can hide this profile at any time.
          </Text>
        </View>
      </View>
    </ScrollView>
  );

  const tabContent =
    tab === 'discover'
      ? renderDiscover()
      : tab === 'likes'
        ? renderLikes()
        : tab === 'matches'
          ? renderMatches()
          : renderProfile();

  return (
    <>
      {frame(
        <Animated.View
          style={[
            styles.animatedPanel,
            {
              opacity: tabOpacity,
              transform: [{ translateY: tabLift }],
            },
          ]}
        >
          {tabContent}
        </Animated.View>,
        { withTabs: true },
      )}

      <ReportModal
        visible={!!reportTarget}
        onClose={() => setReportTarget(null)}
        targetType="user"
        targetId={reportTarget?.id}
        targetLabel={reportTarget?.label}
        reportedUserId={reportTarget?.id}
        surface="dating"
      />

      <MatchMoment
        visible={!!matchMoment}
        person={matchMoment}
        ownPhoto={ownPhoto}
        ownName={ownName}
        messaging={!!chatBusyId}
        onClose={() => setMatchMoment(null)}
        onMessage={() => {
          const person = matchMoment;
          setMatchMoment(null);
          openMatchChat(person);
        }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  embeddedRoot: {
    flex: 1,
    backgroundColor: DATING.ink,
  },
  atmosphere: {
    flex: 1,
    overflow: 'hidden',
  },
  glowTeal: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: 'rgba(0,210,190,0.065)',
    top: -220,
    right: -150,
  },
  glowWarm: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(255,120,104,0.055)',
    bottom: -210,
    left: -170,
  },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  animatedPanel: {
    flex: 1,
  },
  panel: {
    flex: 1,
  },
  header: {
    height: 58,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerEmbedded: {
    height: 52,
  },
  headerIcon: {
    width: 70,
    height: 42,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandNameRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  brandName: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(22),
    fontWeight: '900',
    letterSpacing: -0.9,
    lineHeight: 24,
  },
  brandDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: DATING.teal,
    marginLeft: 3,
    marginBottom: 4,
  },
  brandDivider: {
    width: 1,
    height: 18,
    marginHorizontal: 9,
    backgroundColor: DATING.line,
  },
  brandDating: {
    color: DATING.accentBright,
    fontSize: responsiveFont(9),
    fontWeight: '900',
    letterSpacing: 2.1,
  },
  headerStatus: {
    width: 70,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotLive: {
    backgroundColor: DATING.teal,
  },
  statusDotHidden: {
    backgroundColor: COLORS.textMuted,
  },
  statusText: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(8),
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  tabsOuter: {
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  tabs: {
    height: 57,
    padding: 4,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.065)',
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabActive: {
    backgroundColor: 'rgba(255,120,104,0.11)',
    borderWidth: 1,
    borderColor: 'rgba(255,120,104,0.22)',
  },
  tabIconWrap: {
    position: 'relative',
  },
  tabBadge: {
    position: 'absolute',
    right: -11,
    top: -7,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DATING.teal,
    borderWidth: 2,
    borderColor: '#151515',
  },
  tabBadgeText: {
    color: DATING.ink,
    fontSize: 8,
    fontWeight: '900',
  },
  tabLabel: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(9),
    fontWeight: '700',
  },
  tabLabelActive: {
    color: COLORS.textPrimary,
  },
  gateScroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: responsiveSize(34),
    paddingBottom: 40,
    alignItems: 'center',
  },
  gateVisual: {
    width: 146,
    height: 146,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  gateHaloOne: {
    position: 'absolute',
    width: 142,
    height: 142,
    borderRadius: 71,
    borderWidth: 1,
    borderColor: 'rgba(255,120,104,0.22)',
  },
  gateHaloTwo: {
    position: 'absolute',
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: DATING.accentSoft,
    borderWidth: 1,
    borderColor: DATING.accentBorder,
    transform: [{ rotate: '-10deg' }],
  },
  gateHeart: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#171314',
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.medium,
    shadowColor: DATING.accent,
  },
  gateEyebrow: {
    color: DATING.accentBright,
    fontSize: responsiveFont(10),
    fontWeight: '900',
    letterSpacing: 2.1,
    textAlign: 'center',
    marginBottom: 10,
  },
  gateTitle: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(34),
    lineHeight: responsiveFont(39),
    fontWeight: '700',
    letterSpacing: -0.8,
    textAlign: 'center',
    maxWidth: 420,
  },
  gateBody: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(14),
    lineHeight: responsiveFont(21),
    textAlign: 'center',
    maxWidth: 470,
    marginTop: 14,
  },
  gateFeatures: {
    width: '100%',
    maxWidth: 430,
    marginTop: 24,
    gap: 10,
  },
  gateFeature: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: DATING.line,
  },
  gateFeatureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: DATING.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateFeatureText: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    fontWeight: '700',
  },
  gateCta: {
    width: '100%',
    maxWidth: 430,
    marginTop: 24,
  },
  ageSeal: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DATING.tealSoft,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.34)',
    marginBottom: 24,
  },
  ageSealNumber: {
    color: DATING.teal,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(34),
    fontWeight: '700',
  },
  ageSealLabel: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(8),
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: 2,
  },
  assuranceCard: {
    width: '100%',
    maxWidth: 430,
    marginTop: 22,
    padding: 15,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: DATING.tealSoft,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.18)',
  },
  assuranceText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: responsiveFont(12),
    lineHeight: responsiveFont(18),
  },
  gradientButtonOuter: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  gradientButtonCompact: {
    borderRadius: 13,
  },
  gradientButton: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  gradientButtonInnerCompact: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 13,
  },
  gradientButtonText: {
    color: DATING.ink,
    fontSize: responsiveFont(14),
    fontWeight: '900',
    letterSpacing: 0.1,
  },
  disabled: {
    opacity: 0.5,
  },
  textButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  textButtonLabel: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(13),
    fontWeight: '700',
  },
  loadingScene: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingTitle: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(25),
    fontWeight: '700',
    marginTop: 22,
  },
  loadingBody: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(13),
    marginTop: 7,
  },
  orbitArtwork: {
    width: 122,
    height: 122,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitCore: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#17191B',
    borderWidth: 1,
    borderColor: DATING.line,
    zIndex: 2,
  },
  orbitRing: {
    position: 'absolute',
    width: 94,
    height: 94,
    borderRadius: 47,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  orbitRingOuter: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.045)',
  },
  orbitSatellite: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    top: 9,
    right: 10,
  },
  emptyState: {
    flexGrow: 1,
    minHeight: 410,
    paddingHorizontal: 22,
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyEyebrow: {
    color: DATING.accentBright,
    fontSize: responsiveFont(9),
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 18,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(27),
    lineHeight: responsiveFont(32),
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  emptyBody: {
    maxWidth: 440,
    color: COLORS.textSecondary,
    fontSize: responsiveFont(13),
    lineHeight: responsiveFont(20),
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  discoverContent: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 48,
  },
  discoverIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 8,
    paddingBottom: 16,
  },
  discoverIntroCopy: {
    flex: 1,
  },
  discoverEyebrow: {
    color: DATING.teal,
    fontSize: responsiveFont(9),
    fontWeight: '900',
    letterSpacing: 1.7,
    marginBottom: 5,
  },
  discoverTitle: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(27),
    lineHeight: responsiveFont(31),
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  discoverSubtitle: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(11),
    lineHeight: responsiveFont(16),
    marginTop: 4,
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: DATING.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 8,
  },
  queueText: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(11),
    fontWeight: '700',
  },
  queuePrivacy: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(9),
  },
  discoveryCard: {
    borderRadius: 29,
    overflow: 'hidden',
    backgroundColor: DATING.panel,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    ...SHADOWS.large,
  },
  discoveryFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discoveryFallbackLetter: {
    color: 'rgba(255,255,255,0.74)',
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(100),
    fontWeight: '700',
  },
  discoveryFallbackCaption: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: responsiveFont(8),
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 6,
  },
  photoTapZone: {
    position: 'absolute',
    top: 42,
    bottom: 190,
    width: '38%',
    zIndex: 2,
  },
  photoTapLeft: {
    left: 0,
  },
  photoTapRight: {
    right: 0,
  },
  photoProgress: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    gap: 5,
    zIndex: 4,
  },
  photoProgressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  photoProgressTrackActive: {
    backgroundColor: COLORS.white,
  },
  cardTopMeta: {
    position: 'absolute',
    top: 28,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 3,
  },
  curatedPill: {
    height: 29,
    paddingHorizontal: 10,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(8,10,10,0.63)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  curatedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: DATING.teal,
  },
  curatedPillText: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(8),
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  distancePill: {
    height: 29,
    paddingHorizontal: 9,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(8,10,10,0.63)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  distancePillText: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(9),
    fontWeight: '700',
  },
  discoveryCopy: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
    zIndex: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  personName: {
    flexShrink: 1,
    color: COLORS.white,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(34),
    lineHeight: responsiveFont(38),
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  personAge: {
    color: 'rgba(255,255,255,0.80)',
    fontSize: responsiveFont(21),
    fontWeight: '500',
  },
  personBio: {
    color: 'rgba(255,255,255,0.79)',
    fontSize: responsiveFont(13),
    lineHeight: responsiveFont(19),
    marginTop: 7,
  },
  featuredPrompt: {
    marginTop: 12,
    padding: 13,
    borderRadius: 16,
    backgroundColor: 'rgba(12,13,14,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  featuredPromptQuestion: {
    color: DATING.accentBright,
    fontSize: responsiveFont(9),
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  featuredPromptAnswer: {
    color: COLORS.white,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(16),
    lineHeight: responsiveFont(21),
    fontWeight: '600',
    marginTop: 4,
  },
  swipeStamp: {
    position: 'absolute',
    top: 95,
    zIndex: 6,
    borderWidth: 3,
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  swipeStampLike: {
    left: 22,
    borderColor: DATING.teal,
    transform: [{ rotate: '-9deg' }],
  },
  swipeStampPass: {
    right: 22,
    borderColor: DATING.accent,
    transform: [{ rotate: '9deg' }],
  },
  swipeStampLikeText: {
    color: DATING.teal,
    fontSize: responsiveFont(19),
    fontWeight: '900',
    letterSpacing: 2,
  },
  swipeStampPassText: {
    color: DATING.accent,
    fontSize: responsiveFont(19),
    fontWeight: '900',
    letterSpacing: 2,
  },
  discoveryActions: {
    height: 88,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passButton: {
    backgroundColor: '#181A1C',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    ...SHADOWS.small,
  },
  likeButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    overflow: 'hidden',
    ...SHADOWS.glow,
    shadowColor: DATING.accent,
  },
  likeButtonGradient: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionHint: {
    flex: 1,
    alignItems: 'center',
  },
  actionHintText: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(8),
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  safetyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  safetyAction: {
    minHeight: 34,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  safetyActionText: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    fontWeight: '600',
  },
  safetyDivider: {
    width: 1,
    height: 14,
    backgroundColor: DATING.line,
  },
  promptDeck: {
    gap: 10,
    marginTop: 4,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  sectionHeadingCopy: {
    flex: 1,
  },
  sectionEyebrow: {
    color: DATING.accentBright,
    fontSize: responsiveFont(8),
    fontWeight: '900',
    letterSpacing: 1.7,
    marginBottom: 4,
  },
  sectionHeadingTitle: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(20),
    lineHeight: responsiveFont(24),
    fontWeight: '700',
  },
  sectionAction: {
    minHeight: 34,
    paddingHorizontal: 11,
    justifyContent: 'center',
  },
  sectionActionText: {
    color: DATING.teal,
    fontSize: responsiveFont(11),
    fontWeight: '800',
  },
  promptCard: {
    padding: 17,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: DATING.line,
  },
  promptQuestion: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(10),
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  promptAnswer: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(18),
    lineHeight: responsiveFont(24),
    fontWeight: '600',
    marginTop: 6,
  },
  inlineLoading: {
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  inlineLoadingTitle: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(13),
    fontWeight: '700',
  },
  connectionContent: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 48,
  },
  connectionHero: {
    padding: 18,
    borderRadius: 22,
    backgroundColor: DATING.panel,
    borderWidth: 1,
    borderColor: DATING.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  connectionHeroIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DATING.accentSoft,
    borderWidth: 1,
    borderColor: DATING.accentBorder,
  },
  connectionHeroCopy: {
    flex: 1,
  },
  connectionEyebrow: {
    color: DATING.accentBright,
    fontSize: responsiveFont(8),
    fontWeight: '900',
    letterSpacing: 1.7,
    marginBottom: 4,
  },
  connectionTitle: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(23),
    fontWeight: '700',
    lineHeight: responsiveFont(27),
  },
  connectionBody: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(11),
    lineHeight: responsiveFont(16),
    marginTop: 5,
  },
  visibilityNotice: {
    minHeight: 58,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(243,198,119,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(243,198,119,0.20)',
    marginBottom: 18,
  },
  visibilityNoticeText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: responsiveFont(11),
    lineHeight: responsiveFont(16),
  },
  likesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  likeCard: {
    width: '48.4%',
    minWidth: 138,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: DATING.panelRaised,
    borderWidth: 1,
    borderColor: DATING.line,
  },
  likePhotoWrap: {
    height: 220,
    overflow: 'hidden',
    backgroundColor: DATING.panel,
  },
  likePhoto: {
    width: '100%',
    height: '100%',
  },
  likePhotoFallback: {
    backgroundColor: '#1A2928',
  },
  likePhotoLetter: {
    fontSize: responsiveFont(48),
  },
  likedYouPill: {
    position: 'absolute',
    left: 9,
    top: 9,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(9,10,11,0.72)',
  },
  likedYouPillText: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(7),
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  likeDismiss: {
    position: 'absolute',
    right: 9,
    top: 9,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9,10,11,0.70)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  likeIdentity: {
    position: 'absolute',
    left: 11,
    right: 11,
    bottom: 10,
  },
  likeName: {
    color: COLORS.white,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(18),
    fontWeight: '700',
  },
  likeMeta: {
    color: 'rgba(255,255,255,0.64)',
    fontSize: responsiveFont(9),
    marginTop: 2,
  },
  connectButton: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: DATING.accent,
  },
  connectButtonText: {
    color: DATING.ink,
    fontSize: responsiveFont(11),
    fontWeight: '900',
  },
  matchesHero: {
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  matchesFaces: {
    width: 76,
    height: 66,
  },
  miniFace: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: DATING.panel,
  },
  miniFaceBack: {
    left: 0,
    top: 0,
    backgroundColor: '#24272A',
  },
  miniFaceFront: {
    right: 0,
    bottom: 0,
    backgroundColor: '#17302E',
  },
  matchesHeroCopy: {
    flex: 1,
  },
  matchesList: {
    gap: 10,
  },
  matchRow: {
    minHeight: 96,
    padding: 13,
    borderRadius: 19,
    backgroundColor: DATING.panel,
    borderWidth: 1,
    borderColor: DATING.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  matchRowUnavailable: {
    opacity: 0.58,
  },
  matchAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  matchAvatarFallback: {
    backgroundColor: '#1C2D2B',
  },
  matchAvatarLetter: {
    fontSize: responsiveFont(23),
  },
  matchCopy: {
    flex: 1,
  },
  matchNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matchName: {
    flexShrink: 1,
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(17),
    fontWeight: '700',
  },
  newMatchPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: DATING.tealSoft,
  },
  newMatchPillText: {
    color: DATING.teal,
    fontSize: responsiveFont(7),
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  matchMeta: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(10),
    lineHeight: responsiveFont(14),
    marginTop: 4,
  },
  matchWhen: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(8),
    marginTop: 4,
  },
  messageMatchButton: {
    width: 39,
    height: 39,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DATING.teal,
  },
  profileContent: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 56,
    gap: 12,
  },
  readinessCard: {
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  readinessTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
  },
  profileEyebrow: {
    color: DATING.accentBright,
    fontSize: responsiveFont(8),
    fontWeight: '900',
    letterSpacing: 1.7,
    marginBottom: 5,
  },
  readinessTitle: {
    maxWidth: 290,
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(21),
    lineHeight: responsiveFont(25),
    fontWeight: '700',
  },
  readinessScore: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  readinessScoreValue: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(31),
    fontWeight: '700',
  },
  readinessScoreUnit: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(11),
    fontWeight: '700',
  },
  readinessTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.09)',
    overflow: 'hidden',
    marginTop: 16,
  },
  readinessFill: {
    height: '100%',
    borderRadius: 3,
  },
  readinessChecks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 15,
  },
  readinessCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  readinessCheckText: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(9),
    fontWeight: '600',
  },
  readinessCheckTextDone: {
    color: COLORS.textSecondary,
  },
  visibilityCard: {
    minHeight: 82,
    padding: 15,
    borderRadius: 19,
    backgroundColor: DATING.panel,
    borderWidth: 1,
    borderColor: DATING.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  visibilityIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityCopy: {
    flex: 1,
  },
  preferenceTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    fontWeight: '800',
  },
  preferenceBody: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    lineHeight: responsiveFont(15),
    marginTop: 3,
  },
  profilePreview: {
    minHeight: 104,
    padding: 13,
    borderRadius: 20,
    backgroundColor: DATING.panel,
    borderWidth: 1,
    borderColor: DATING.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  profilePreviewImage: {
    width: 76,
    height: 76,
    borderRadius: 23,
  },
  profilePreviewFallback: {
    backgroundColor: '#20302E',
  },
  profilePreviewLetter: {
    fontSize: responsiveFont(27),
  },
  profilePreviewCopy: {
    flex: 1,
  },
  profilePreviewEyebrow: {
    color: DATING.teal,
    fontSize: responsiveFont(8),
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  profilePreviewName: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(19),
    fontWeight: '700',
    marginTop: 3,
  },
  profilePreviewBio: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(10),
    lineHeight: responsiveFont(14),
    marginTop: 3,
  },
  editPhotoButton: {
    width: 39,
    height: 39,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: DATING.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preferenceSection: {
    padding: 17,
    borderRadius: 20,
    backgroundColor: DATING.panel,
    borderWidth: 1,
    borderColor: DATING.line,
  },
  sectionDescription: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(11),
    lineHeight: responsiveFont(16),
    marginTop: -4,
    marginBottom: 13,
  },
  fieldLabel: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(10),
    fontWeight: '800',
    letterSpacing: 0.3,
    marginBottom: 7,
  },
  fieldLabelSpaced: {
    marginTop: 18,
  },
  fieldHelper: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(9),
    lineHeight: responsiveFont(14),
    marginTop: -2,
    marginBottom: 9,
  },
  textArea: {
    minHeight: 105,
    padding: 14,
    borderRadius: 15,
    backgroundColor: '#0C0E0F',
    borderWidth: 1,
    borderColor: DATING.line,
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    lineHeight: responsiveFont(19),
  },
  textInput: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderRadius: 14,
    backgroundColor: '#0C0E0F',
    borderWidth: 1,
    borderColor: DATING.line,
    color: COLORS.textPrimary,
    fontSize: responsiveFont(12),
  },
  fieldFooter: {
    marginTop: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  charCount: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(9),
  },
  inlinePreference: {
    marginTop: 16,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: DATING.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inlinePreferenceCopy: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    backgroundColor: '#0D0F10',
    borderWidth: 1,
    borderColor: DATING.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  optionChipActive: {
    backgroundColor: DATING.accentSoft,
    borderColor: DATING.accentBorder,
  },
  optionChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: DATING.accent,
  },
  optionChipText: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(10),
    fontWeight: '700',
  },
  optionChipTextActive: {
    color: COLORS.textPrimary,
  },
  promptEditor: {
    marginTop: 12,
    gap: 7,
  },
  promptEditorLabel: {
    color: DATING.accentBright,
    fontSize: responsiveFont(10),
    fontWeight: '700',
  },
  sectionButtonRow: {
    alignItems: 'flex-start',
    marginTop: 14,
  },
  birthYearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  birthYearInput: {
    flex: 1,
  },
  ageRangeSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  ageRangeValue: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(23),
    fontWeight: '700',
  },
  ageRangeLine: {
    flex: 1,
    height: 1,
    backgroundColor: DATING.accentBorder,
  },
  steppers: {
    flexDirection: 'row',
    gap: 10,
  },
  stepper: {
    flex: 1,
  },
  stepperLabel: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(9),
    fontWeight: '700',
    marginBottom: 6,
  },
  stepperControls: {
    height: 46,
    borderRadius: 15,
    paddingHorizontal: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0C0E0F',
    borderWidth: 1,
    borderColor: DATING.line,
  },
  stepperButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    fontWeight: '900',
  },
  locationUpdate: {
    minHeight: 44,
    marginTop: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: DATING.tealSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  locationUpdateText: {
    color: DATING.teal,
    fontSize: responsiveFont(11),
    fontWeight: '800',
  },
  safetyCard: {
    padding: 16,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: DATING.tealSoft,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.17)',
  },
  safetyCardIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,210,190,0.11)',
  },
  safetyCardCopy: {
    flex: 1,
  },
  safetyCardTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    fontWeight: '800',
  },
  safetyCardBody: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(10),
    lineHeight: responsiveFont(15),
    marginTop: 4,
  },
  photoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoFallbackLetter: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(30),
    fontWeight: '700',
    zIndex: 2,
  },
  fallbackPulse: {
    position: 'absolute',
    width: '72%',
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(255,120,104,0.10)',
  },
  matchModalBackdrop: {
    flex: 1,
    padding: 18,
    backgroundColor: 'rgba(0,0,0,0.84)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchModalCard: {
    width: '100%',
    maxWidth: 470,
    borderRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 22,
    overflow: 'hidden',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  matchBurstOne: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    top: -150,
    right: -100,
    backgroundColor: 'rgba(0,210,190,0.10)',
  },
  matchBurstTwo: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    bottom: -150,
    left: -110,
    backgroundColor: 'rgba(255,120,104,0.10)',
  },
  matchEyebrow: {
    color: DATING.teal,
    fontSize: responsiveFont(9),
    fontWeight: '900',
    letterSpacing: 2,
  },
  matchTitle: {
    color: COLORS.textPrimary,
    fontFamily: DISPLAY_FONT,
    fontSize: responsiveFont(32),
    lineHeight: responsiveFont(37),
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  matchBody: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(12),
    lineHeight: responsiveFont(18),
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 360,
  },
  matchFaces: {
    width: 230,
    height: 132,
    marginTop: 24,
    marginBottom: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchFace: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    padding: 4,
    backgroundColor: DATING.panel,
    borderWidth: 2,
  },
  matchFaceLeft: {
    left: 16,
    borderColor: DATING.teal,
    transform: [{ rotate: '-5deg' }],
  },
  matchFaceRight: {
    right: 16,
    borderColor: DATING.accent,
    transform: [{ rotate: '5deg' }],
  },
  matchFaceImage: {
    width: '100%',
    height: '100%',
    borderRadius: 52,
  },
  matchFaceFallback: {
    backgroundColor: '#1B2B29',
  },
  matchFaceLetter: {
    fontSize: responsiveFont(38),
  },
  matchHeart: {
    width: 46,
    height: 46,
    borderRadius: 23,
    zIndex: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DATING.accent,
    borderWidth: 4,
    borderColor: DATING.panel,
  },
  matchPrimary: {
    width: '100%',
  },
  matchKeepLooking: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 7,
  },
  matchKeepLookingText: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(12),
    fontWeight: '700',
  },
});

export default DatingScreen;
