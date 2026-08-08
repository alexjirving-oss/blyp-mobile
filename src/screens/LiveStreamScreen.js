import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import BlueScreen from '../ui/BlueScreen';
import Icon from '../components/Icon';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Pressable,
  Modal,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  BackHandler,
  Alert,
  FlatList,
  ScrollView,
  Dimensions,
  Animated,
  Easing,
  AppState,
  Share,
  PanResponder,
  InteractionManager,
  StatusBar as RNStatusBar,
  LayoutAnimation,
  UIManager,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import { subscribeToGiftEvents } from '../realtime/liveGiftSocket';
import { subscribeToRoomEvents } from '../realtime/roomEventsSocket';
import MaskedView from '@react-native-masked-view/masked-view';
import { auth, firebaseNative, db } from '../config/firebase';
import { snapData } from '../utils/firestoreSnap';
import { getCognitoJwtForApi } from '../api/getCognitoJwtForApi';
import { useRenderTimer, useTrackAsync } from '../performance/hooks';
import { useAuth, useFirestoreDoc, clearCognitoSessions, refreshAuthNow, userPool } from '../hooks/useCommon';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { isLiveStreamingEnabled } from '../config/StreamingFeatureFlag';
import {
  isArtilleryEnabled,
  isMarbleRaceEnabled,
  isFrenemiesEnabled,
  isReactionDuelEnabled,
} from '../config/LiveGamesFlags';
import { useLockPortraitWhileFocused } from '../utils/lockPortraitWhileFocused';
import LiveStreamViewer from '../components/LiveStreamViewer';
import CommentsModal from '../components/CommentsModal';
import GiftSystem from '../components/GiftSystem';
import LiveGiftOverlay from '../components/live/LiveGiftOverlay';
import BattleOverlay from '../components/Battles/BattleOverlay';
import NetworkedArtillery from '../games/artillery/NetworkedArtillery';
import MarbleRaceOverlay from '../components/live/MarbleRaceOverlay';
import FrenemiesOverlay from '../components/live/FrenemiesOverlay';
import ReactionDuelOverlay from '../components/live/ReactionDuelOverlay';
import LiveGamesPicker from '../components/live/LiveGamesPicker';
import GuestControlSheet from '../components/live/GuestControlSheet';
import useIsAdmin from '../hooks/useIsAdmin';
import LiveInviteGuestsModal from '../components/live/LiveInviteGuestsModal';
import ReservedGuestTile from '../components/live/ReservedGuestTile';
import LiveDashboardSheet from '../components/live/dashboard/LiveDashboardSheet';
import StageDeskChrome from '../components/live/dashboard/StageDeskChrome';
import {
  STAGE_DESK_NAME,
  getLiveDashboard,
  subscribeLiveDashboard,
  resolveStageDeskPro,
} from '../services/liveDashboardService';
import { useHasAI } from '../hooks/useEntitlement';
import {
  markJoined as markBattleJoined,
  getBattle as getBattleDoc,
  recordBattleGifterContribution,
  challengeGuestInLive,
} from '../services/battleService';
import { getStreamingBackend } from '../streaming/StreamingBackendFactory';
import { logStreamingEvent } from '../streaming/StreamingLog';
import HLSLiveStreamServiceInstance from '../services/HLSLiveStreamService';
import { listGuestRequests, inviteGuest, rejectGuest, kickGuest, muteGuest, setGuestCamera, hostInviteGuest, MAX_GUEST_SLOTS, bumpLiveEngagement, getLiveEngagementSession, frenemiesChat } from '../api/ivsLiveApi';
// IVS Architecture imports (feature-flagged, default OFF)
import { streamingConfig } from '../config/StreamingFeatureConfig';
import { StreamingBackend } from '../config/StreamingBackend';
import { useIVSHostSession } from '../live/ivs/hooks/useIVSHostSession';
import { getNativeIVSBroadcastView, getNativeIVSRealTimeView } from '../live/ivs/native/views';
import {
  GestureHandlerRootView,
  PinchGestureHandler,
  TapGestureHandler,
  State as GestureState,
} from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { getIVSNativeClient } from '../streaming/IVSNativeClient';
import { COLORS } from '../styles/theme';
import LiveChatOverlay from '../components/live/LiveChatOverlay';
import LiveBottomBar from '../components/live/LiveBottomBar';
import LiveViewerHeader from '../components/live/LiveViewerHeader';
import LiveReactionsHearts from '../components/live/LiveReactionsHearts';
import LiveReactionTray from '../components/live/LiveReactionTray';
import ReportModal from '../components/ReportModal';
import { blockUser, loadBlockedUsers } from '../services/BlockService';
import { inspectText } from '../utils/contentFilter';
import { pickPublicLabel } from '../utils/publicLabel';
// Live Service for Firestore registration
import {
  createStream as createFirestoreStream,
  endStream as endFirestoreStream,
  heartbeatStream,
  setLiveGuests as mirrorLiveGuests,
  setGuestLayoutMode as mirrorGuestLayoutMode,
  setActiveBattleId as mirrorActiveBattleId,
  subscribeToGuestRequests,
  setGuestRequestStatus as setGuestRequestStatusMirror,
  clearGuestRequest as clearGuestRequestMirror,
} from '../services/LiveService';
import {
  LIVE_LAYOUT_MODES,
  LIVE_LAYOUT_OPTIONS,
  normalizeLiveLayoutMode,
  layoutUsesBottomTray,
  guestsPerTrayPage,
  buildVisibleGuestSlotIds,
  guestTileWidthPercent,
  guestTileHorizontalMarginPercent,
} from '../live/ivs/multiGuestLayout';

const GUEST_TRAY_LAYOUT_ANIM = {
  duration: 280,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};
import { useLiveStreamRouteParams } from './live/useLiveStreamRouteParams';

import Toast from 'react-native-toast-message';

function BLYP_nativeLog(message, level = 1) {
  try {
    const msg = typeof message === 'string' ? message : JSON.stringify(message);
    if (level >= 2) {
      // eslint-disable-next-line no-console
      console.warn(msg);
    } else {
      // eslint-disable-next-line no-console
      console.log(msg);
    }
  } catch { }
}

const tryCopyToClipboard = async (text) => {
  try {
    // Avoid hard dependency in older dev-client builds.
    // eslint-disable-next-line global-require
    const Clipboard = require('expo-clipboard');
    if (Clipboard?.setStringAsync) {
      await Clipboard.setStringAsync(text);
      return true;
    }
  } catch (e) { }
  return false;
};

const { width, height } = Dimensions.get('window');

// Top inset so the immersive live header clears the status bar / notch once the
// app's home header is removed from the live room.
const LIVE_TOP_INSET =
  (Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) : 47) + 10;

const GradientText = ({ children, style }) => {
  const text = children == null ? '' : String(children);

  return (
    <MaskedView
      maskElement={
        <Text style={[style, { backgroundColor: 'transparent' }]} numberOfLines={1}>
          {text}
        </Text>
      }
    >
      <LinearGradient
        colors={[COLORS.gradientMiddle, COLORS.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
      >
        <Text style={[style, { opacity: 0 }]} numberOfLines={1}>
          {text}
        </Text>
      </LinearGradient>
    </MaskedView>
  );
};

// Debug: Log to verify correct imports
BLYP_nativeLog('ðŸ“¸ LiveStreamScreen: CameraView imported? ' + String(typeof CameraView), 1);

const LiveStreamScreen = (props) => {
  const NativeIVSBroadcastView = getNativeIVSBroadcastView();
  const NativeIVSRealTimeView = getNativeIVSRealTimeView();
  // Keep live video feed portrait-stable; MainActivity itself is fullSensor for Fold.
  useLockPortraitWhileFocused();
  BLYP_nativeLog('[LIVE][RENDER] LiveStreamScreen render', 1);
  BLYP_nativeLog(
    '[LIVE][PROPS_AT_MOUNT] ' +
    JSON.stringify({ hasProps: !!props, keys: props ? Object.keys(props) : null }),
    1
  );

  const { navigation, route } = props || {};

  console.log('[LIVE][RAW_ROUTE_OBJECT]', route);
  console.log('[LIVE][ROUTE_PARAMS]', route?.params);
  console.log('='.repeat(60));

  // Bridge test removed to allow normal flow

  useRenderTimer('LiveStreamScreen');
  // Real mount-only log
  useEffect(() => {
    console.log('[LIVE][COMPONENT_MOUNT] LiveStreamScreen mounted');
    try {
      const { pauseSpotifyForBlypAudio } = require('../services/spotifyAudioCoordinator');
      pauseSpotifyForBlypAudio('live_join').catch(() => {});
    } catch { /* optional */ }
  }, []);
  const trackAsync = useTrackAsync();
  const { uid, isAuthenticated, authReady, loading: authLoading, getDisplayName } = useAuth();
  const { isAdmin } = useIsAdmin();

  const {
    normalizedParams,
    routeMode,
    routeHostUid,
    routeStreamId,
    routeHostDisplayName,
    routeSource,
    routeE2EAutoStart,
    routeE2ETitle,
    routeBattleId,
    routeBattleRole,
    routeBattleSessionId,
    isBattleParticipant,
  } = useLiveStreamRouteParams(route);

  // Mid-live challenge / rematch / viewer mirror — union of route + local + stream doc.
  const [localBattleId, setLocalBattleId] = useState(null);
  const [mirroredBattleId, setMirroredBattleId] = useState(null);
  // localBattleId wins so rematch/challenge beats a stale route param until setParams lands.
  const activeBattleId = localBattleId || routeBattleId || mirroredBattleId || null;
  const [challengeBusy, setChallengeBusy] = useState(false);

  // Blyp Artillery battle-stage game (server-authoritative). Client toggle is
  // gated by EXPO_PUBLIC_LIVE_ARTILLERY_ENABLED; the backend is independently
  // gated by LIVE_ARTILLERY_ENABLED so it ships dark until both are on.
  const ARTILLERY_ENABLED = isArtilleryEnabled();
  const [showArtillery, setShowArtillery] = useState(false);

  // Marble Race (Guest Grand Prix). Reads expo.extra + env (not bare process.env).
  const MARBLE_ENABLED = isMarbleRaceEnabled();
  const FRENEMIES_ENABLED = isFrenemiesEnabled();
  const REACTION_DUEL_ENABLED = isReactionDuelEnabled();
  // Games bottom-tab panel (Marble Race / Frenemies / Reaction Duel / battle game).
  const [gamesOpen, setGamesOpen] = useState(false);
  /** null = branded picker; otherwise the selected game's start chrome. */
  const [selectedLiveGame, setSelectedLiveGame] = useState(null);
  const [inviteGuestsOpen, setInviteGuestsOpen] = useState(false);
  const [invitingGuestUid, setInvitingGuestUid] = useState(null);
  const [stageDeskOpen, setStageDeskOpen] = useState(false);
  const [stageDeskLayout, setStageDeskLayout] = useState(null);
  const plusEntitled = useHasAI();
  const stageDeskPro = resolveStageDeskPro({ entitled: !!plusEntitled });

  // Floating toggle + full overlay for the artillery battle-stage game. Rendered
  // in both viewer and host battle branches. Opaque so the game reads over video.
  const renderArtilleryLayer = () => {
    if (!activeBattleId || !ARTILLERY_ENABLED) return null;
    const gameSessionId = routeStreamId || streamId;
    if (!gameSessionId) return null;
    if (showArtillery) {
      return (
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0A0A0C', zIndex: 60 }}
        >
          <NetworkedArtillery
            sessionId={gameSessionId}
            battleId={activeBattleId}
            role={routeBattleRole || 'spectator'}
            onClose={() => setShowArtillery(false)}
          />
        </View>
      );
    }
    // Entry is the Games bottom-tab control (not a floating FAB).
    return null;
  };

  const hostGamesRoute =
    routeMode === 'host' || (!routeHostUid && !routeStreamId);
  const liveGamesAvailable =
    (!!activeBattleId && ARTILLERY_ENABLED) ||
    ((hostGamesRoute || !!isAdmin) &&
      (MARBLE_ENABLED || FRENEMIES_ENABLED || REACTION_DUEL_ENABLED));

  const closeLiveGames = useCallback(() => {
    setGamesOpen(false);
    setSelectedLiveGame(null);
  }, []);

  const openLiveGames = useCallback(() => {
    if (
      (activeBattleId && ARTILLERY_ENABLED) ||
      MARBLE_ENABLED ||
      FRENEMIES_ENABLED ||
      REACTION_DUEL_ENABLED
    ) {
      setGamesOpen((v) => {
        if (v) {
          setSelectedLiveGame(null);
          return false;
        }
        setSelectedLiveGame(null);
        return true;
      });
      return;
    }
    Alert.alert('Games', 'Live games are not available in this room yet.');
  }, [
    activeBattleId,
    ARTILLERY_ENABLED,
    MARBLE_ENABLED,
    FRENEMIES_ENABLED,
    REACTION_DUEL_ENABLED,
  ]);

  // Marble Race translucent overlay on non-battle lives.
  // Host start chrome is gated by the Games bottom tab; active races always show.
  const renderMarbleLayer = () => {
    if (!MARBLE_ENABLED || activeBattleId) return null;
    const gameSessionId = routeStreamId || streamId;
    if (!gameSessionId) return null;
    // Host path: prefer live only (session exists after Go Live).
    if (isHost && !isStreaming) return null;
    const rosterCount = (liveGuests || []).filter((g) => g && g.userId && g.userId !== uid).length;
    const guestCount = isHost
      ? Math.max(rosterCount, typeof hostGuestCount === 'number' ? hostGuestCount : 0)
      : rosterCount;
    return (
      <MarbleRaceOverlay
        sessionId={gameSessionId}
        isHost={isHost}
        currentUid={uid}
        hostName={resolvedHostName || 'Host'}
        liveGuestCount={guestCount}
        controlsVisible={gamesOpen && selectedLiveGame === 'marble'}
        onClose={() => setSelectedLiveGame(null)}
        onInviteGuest={
          isHost
            ? () => setInviteGuestsOpen(true)
            : undefined
        }
      />
    );
  };

  const renderFrenemiesLayer = () => {
    if (!FRENEMIES_ENABLED || activeBattleId) return null;
    const gameSessionId = routeStreamId || streamId;
    if (!gameSessionId) return null;
    if (isHost && !isStreaming) return null;
    return (
      <FrenemiesOverlay
        sessionId={gameSessionId}
        currentUid={uid}
        displayName={typeof getDisplayName === 'function' ? getDisplayName() : 'Player'}
        isAdmin={!!isAdmin}
        isHost={isHost}
        liveGuests={liveGuests || []}
        controlsVisible={
          gamesOpen &&
          selectedLiveGame === 'frenemies' &&
          (isHost || !!isAdmin)
        }
        onClose={closeLiveGames}
        onBackToPicker={() => setSelectedLiveGame(null)}
      />
    );
  };

  const renderReactionDuelLayer = () => {
    if (!REACTION_DUEL_ENABLED || activeBattleId) return null;
    const gameSessionId = routeStreamId || streamId;
    if (!gameSessionId) return null;
    if (isHost && !isStreaming) return null;
    return (
      <ReactionDuelOverlay
        sessionId={gameSessionId}
        currentUid={uid}
        currentDisplayName={typeof getDisplayName === 'function' ? getDisplayName() : 'Player'}
        hostDisplayName={resolvedHostName || 'Host'}
        isAdmin={!!isAdmin}
        isHost={isHost}
        liveGuests={liveGuests || []}
        controlsVisible={
          gamesOpen &&
          selectedLiveGame === 'reaction-duel' &&
          (isHost || !!isAdmin)
        }
        onClose={closeLiveGames}
        onBackToPicker={() => setSelectedLiveGame(null)}
      />
    );
  };

  const renderLiveGamesPicker = () => {
    if (!gamesOpen || selectedLiveGame) return null;
    if (isHost && !isStreaming) return null;
    const showMarble = !!MARBLE_ENABLED && !!isHost;
    const showFrenemies = !!FRENEMIES_ENABLED && (isHost || !!isAdmin);
    const showReactionDuel =
      !!REACTION_DUEL_ENABLED && (isHost || !!isAdmin);
    const showBattle =
      !!activeBattleId || (!!isHost && !!isStreaming);
    if (!showMarble && !showFrenemies && !showReactionDuel && !showBattle) {
      return null;
    }
    return (
      <LiveGamesPicker
        visible
        showMarble={showMarble}
        showFrenemies={showFrenemies}
        showReactionDuel={showReactionDuel}
        showBattle={showBattle}
        battleActive={!!activeBattleId}
        battleGameEnabled={!!activeBattleId && !!ARTILLERY_ENABLED}
        standaloneGamesDisabled={!!activeBattleId}
        onPickMarble={() => setSelectedLiveGame('marble')}
        onPickFrenemies={() => setSelectedLiveGame('frenemies')}
        onPickReactionDuel={() => setSelectedLiveGame('reaction-duel')}
        onPickBattle={() => {
          if (activeBattleId && ARTILLERY_ENABLED) {
            setShowArtillery(true);
            closeLiveGames();
            return;
          }
          closeLiveGames();
          const firstGuest = (liveGuests || []).find(
            (guest) => guest?.userId && guest.userId !== uid
          );
          if (firstGuest) {
            setSelectedGuestControlId(String(firstGuest.userId));
            setGuestControlVisible(true);
          } else {
            setInviteGuestsOpen(true);
          }
        }}
        onClose={closeLiveGames}
      />
    );
  };

  // Determine mode: explicit viewer intent must never fall through to HOST/Go Live.
  // streamId alone is enough for join (hostUid is display/block metadata).
  // Missing hostUid previously forced HOST mode — Alex saw Go Live instead of joining.
  const isViewerRoute =
    (routeMode === 'viewer' && !!routeStreamId) ||
    ((routeMode === null || routeMode === undefined) && !!routeHostUid && !!routeStreamId);

  const mode = isViewerRoute ? 'viewer' : 'host';
  const isViewer = isViewerRoute;
  const isHost = !isViewer;

  // Stage Desk prefs — host-only chrome layout (AsyncStorage + Firestore prefs).
  useEffect(() => {
    if (!isHost || !uid) return undefined;
    let alive = true;
    getLiveDashboard(uid).then((d) => {
      if (alive) setStageDeskLayout(d);
    });
    const unsub = subscribeLiveDashboard(uid, (d) => {
      if (alive) setStageDeskLayout(d);
    });
    return () => {
      alive = false;
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [isHost, uid]);

  // CRITICAL DEBUG: Log decision
  console.log('[LIVE][DECISION_MADE]', {
    routeMode,
    routeHostUid,
    routeStreamId,
    routeSource,
    isViewerRoute,
    mode,
    isViewer,
    isHost,
  });

  console.log('[LIVE][RECEIVED_ROUTE_PARAMS]', {
    rawParams,
    normalizedParams,
    routeMode,
    routeHostUid,
    routeStreamId,
    routeHostDisplayName,
    routeSource,
    isViewerRoute,
    finalMode: mode,
  });

  // STEP 2: Safe public display-name resolution. Auth fallbacks can be the
  // Cognito sub; never let that identifier become a user-facing live label.
  const getDisplayNameSafe = () => {
    try {
      if (typeof getDisplayName === 'function') {
        const val = getDisplayName();
        if (val && typeof val === 'string') {
          return pickPublicLabel({ displayName: val }, { uid, fallback: 'User' });
        }
      }
    } catch (e) {
      console.warn('[LIVE][DISPLAYNAME_RESOLVE_ERROR]', e);
    }
    return 'User';
  };

  const hostUid = isViewer ? routeHostUid : uid;
  const hostDisplayName = isViewer
    ? pickPublicLabel({ displayName: routeHostDisplayName }, { uid: routeHostUid, fallback: 'Host' })
    : getDisplayNameSafe();

  const { data: hostUserDoc } = useFirestoreDoc('users', hostUid);
  const resolvedHostName = pickPublicLabel(
    {
      username: hostUserDoc?.username,
      handle: hostUserDoc?.handle,
      displayName: hostUserDoc?.displayName,
      name: hostDisplayName,
    },
    { uid: hostUid, fallback: 'Host' },
  );

  const resolvedHostPhotoUrl =
    (typeof hostUserDoc?.photoURL === 'string' && hostUserDoc.photoURL.trim())
      ? hostUserDoc.photoURL.trim()
      : (typeof hostUserDoc?.photoUrl === 'string' && hostUserDoc.photoUrl.trim())
        ? hostUserDoc.photoUrl.trim()
        : (typeof hostUserDoc?.avatarUrl === 'string' && hostUserDoc.avatarUrl.trim())
          ? hostUserDoc.avatarUrl.trim()
          : null;

  console.log('[LIVE][MODE_RESOLVED]', {
    mode,
    isViewer,
    isHost,
    hostUid,
    hostDisplayName,
    uid,
  });

  const [isStreaming, setIsStreaming] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [streamStartTime, setStreamStartTime] = useState(null);
  const [viewCount, setViewCount] = useState(0);
  const [heartCount, setHeartCount] = useState(0);
  const [comments, setComments] = useState([]);
  // Optimistic live-chat bubbles shown the instant you tap Send, reconciled away
  // when the real Firestore comment echoes back (or removed on send failure).
  const [pendingComments, setPendingComments] = useState([]);
  // Synthetic "X joined" chat lines fed by the room-event bus (viewer.joined),
  // merged with real comments for display. Capped + deduped by id.
  const [joinMessages, setJoinMessages] = useState([]);
  const mergedComments = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const c of [...comments, ...joinMessages, ...pendingComments]) {
      if (c?.id != null) {
        if (seen.has(c.id)) continue; // dedupe by id (prevents duplicate bubbles)
        seen.add(c.id);
      }
      out.push(c);
    }
    out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return out.slice(-60);
  }, [comments, joinMessages, pendingComments]);
  // Drop optimistic bubbles once the matching real comment arrives via snapshot.
  useEffect(() => {
    if (pendingComments.length === 0) return;
    setPendingComments((prev) =>
      prev.filter(
        (p) =>
          !comments.some(
            (c) => c.userId === p.userId && String(c.text || '').trim() === String(p.text || '').trim()
          )
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments]);
  const [newComment, setNewComment] = useState('');

  const exitHandledRef = useRef(false);
  const [viewerCommentsOverlayHeight, setViewerCommentsOverlayHeight] = useState(0);
  const [incomingGiftEvent, setIncomingGiftEvent] = useState(null);
  const [viewerGuestPagerHeight, setViewerGuestPagerHeight] = useState(0);
  const [viewerLiveChatHeight, setViewerLiveChatHeight] = useState(0);
  const [hostCommentsOverlayHeight, setHostCommentsOverlayHeight] = useState(0);
  const [hostGuestTrayHeight, setHostGuestTrayHeight] = useState(0);
  const [commentsModalVisible, setCommentsModalVisible] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [liveReportVisible, setLiveReportVisible] = useState(false);
  const [giftOpenSignal, setGiftOpenSignal] = useState(0);
  // Guest roster (mirrored on the stream doc) + the currently selected gift
  // recipient. Defaults to the host; viewers/host can pick a guest instead so
  // everyone on stage can be gifted.
  const [liveGuests, setLiveGuests] = useState([]);
  // INVITED guests painted into their Dynamo slot before IVS media arrives.
  const reservedGuestsRef = useRef(new Map()); // userId -> { userId, slotIndex, name, photoUrl, status }
  const [giftRecipient, setGiftRecipient] = useState(null);
  const [reactionBurst, setReactionBurst] = useState({ key: 0, emoji: null });
  // Guest boxes are part of the default live surface, but start as one compact
  // visible row. ("collapsed" is the one-row tray, not the hidden state.)
  const [hostGuestTrayMode, setHostGuestTrayMode] = useState('collapsed'); // expanded | collapsed | hidden
  /** Compositional layout (sticky slots apply inside each mode). Mirrored to viewers. */
  const [guestLayoutMode, setGuestLayoutMode] = useState(LIVE_LAYOUT_MODES.BOTTOM_GRID);
  const prevHostGuestCountRef = useRef(0);
  const [showLayoutSwitcher, setShowLayoutSwitcher] = useState(false);
  const hostGuestPagerScrollRef = useRef(null);
  const hostPrevVisibleGuestCountRef = useRef(null);
  const [streamId, setStreamId] = useState(null);

  useEffect(() => {
    if (!commentsModalVisible) return;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setCommentsModalVisible(false);
      return true;
    });

    return () => {
      try { sub.remove(); } catch { }
    };
  }, [commentsModalVisible]);

  const hostGuestTrayPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => {
        const dx = Math.abs(gesture.dx || 0);
        const dy = Math.abs(gesture.dy || 0);
        // Only capture mostly-vertical gestures so horizontal paging stays smooth.
        return dy > 12 && dy > dx;
      },
      onPanResponderRelease: (_evt, gesture) => {
        const dy = gesture.dy || 0;
        if (dy > 22) {
          // Swipe down: expanded -> collapsed -> hidden
          setHostGuestTrayMode((prev) => {
            const next = prev === 'expanded' ? 'collapsed' : prev === 'collapsed' ? 'hidden' : 'hidden';
            try {
              hostGuestPagerScrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: false });
            } catch { }
            return next;
          });
          try {
            hostGuestPagerScrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: false });
          } catch { }
        } else if (dy < -22) {
          // Swipe up: hidden -> collapsed -> expanded
          setHostGuestTrayMode((prev) => {
            const next = prev === 'hidden' ? 'collapsed' : prev === 'collapsed' ? 'expanded' : 'expanded';
            try {
              hostGuestPagerScrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: false });
            } catch { }
            return next;
          });
          try {
            hostGuestPagerScrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: false });
          } catch { }
        }
      },
    })
  ).current;
  const shownGuestRequestIdsRef = useRef(new Set());
  const guestPromptInFlightRef = useRef(false);
  const [activeGuestRequest, setActiveGuestRequest] = useState(null);
  const [activeGuestRequestProfile, setActiveGuestRequestProfile] = useState({
    userId: null,
    username: '',
    photoUrl: null,
    loading: false,
  });
  const HOST_GUEST_TRAY_HIDDEN_TAB_HEIGHT = 28;
  const [title, setTitle] = useState('');
  const e2eAutoTriggeredRef = useRef(false);
  // DEV-ONLY: render the live overlay without starting IVS, so the host UI can
  // be designed on an x86 emulator (where the broadcast engine can't run). Never
  // ships — __DEV__ is false in release builds. Set to false for real IVS dev.
  const LIVE_UI_PREVIEW = __DEV__ && true;

  // Viewer entry gate: never let someone sit in a live hosted by a user they
  // have blocked (deep links / stale directory entries bypass the list filter).
  // Missing hostUid is allowed for explicit viewer routes (join still works).
  useEffect(() => {
    if (!isViewer || !hostUid || !uid || hostUid === uid) return;
    let cancelled = false;
    (async () => {
      try {
        const blocked = await loadBlockedUsers();
        if (cancelled || !blocked?.has?.(hostUid)) return;
        Alert.alert('Unavailable', 'You’ve blocked this host, so their live isn’t available.');
        try { navigation.goBack(); } catch { /* already gone */ }
      } catch { /* best-effort gate */ }
    })();
    return () => { cancelled = true; };
  }, [isViewer, hostUid, uid]);

  // Host: poll for guest join requests while streaming (IVS only)
  useEffect(() => {
    if (!isHost) return;
    // Extra hard guard: host screen must be the authenticated user.
    // Prevents accidental host-only polling when a viewer route is active.
    if (!uid || !hostUid || uid !== hostUid) return;
    if (!isStreaming) return;
    if (backend !== StreamingBackend.IVS) return;
    if (!streamId) return;

    let cancelled = false;
    let intervalId = null;

    const tick = async () => {
      if (cancelled) return;
      if (guestPromptInFlightRef.current) return;

      try {
        console.log('[HOST][GUEST_REQUEST_POLL]', { uid, hostUid, streamId });
        const requests = await listGuestRequests(streamId);
        const pending = (requests || []).filter((r) => r?.status === 'REQUESTED' || r?.status === 'PENDING');
        const next = pending.find((r) => r?.userId && !shownGuestRequestIdsRef.current.has(r.userId));
        if (!next?.userId) return;

        shownGuestRequestIdsRef.current.add(next.userId);
        guestPromptInFlightRef.current = true;
        setActiveGuestRequest({
          userId: next.userId,
          displayName: next.displayName || next.username || null,
          photoUrl: next.photoURL || next.photoUrl || null,
        });
      } catch (err) {
        console.warn('[HOST][LIST_GUEST_REQUESTS_FAILED]', err);
      }
    };

    // immediate + polling
    tick();
    intervalId = setInterval(tick, 2500);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [isHost, isStreaming, backend, streamId, uid, hostUid]);

  // RELIABLE NOTIFICATION CHANNEL: in addition to polling the live-service
  // (above), subscribe to the Firestore-mirrored guest requests in real time.
  // The poll alone proved flaky in the field ("host never sees the request"),
  // whereas Firestore reliably delivers comments/viewer-counts/roster here.
  // Both channels share the same dedupe refs (shownGuestRequestIdsRef /
  // guestPromptInFlightRef), so whichever observes a request first wins and the
  // other is harmlessly deduped — no double prompts.
  useEffect(() => {
    if (!isHost) return;
    if (!uid || !hostUid || uid !== hostUid) return;
    if (!isStreaming) return;
    if (backend !== StreamingBackend.IVS) return;
    if (!streamId) return;

    const unsub = subscribeToGuestRequests(streamId, (requests) => {
      if (guestPromptInFlightRef.current) return;
      const next = (requests || []).find(
        (r) => r?.userId && !shownGuestRequestIdsRef.current.has(r.userId)
      );
      if (!next?.userId) return;
      console.log('[HOST][GUEST_REQUEST_FIRESTORE]', { uid, hostUid, streamId, requester: next.userId });
      shownGuestRequestIdsRef.current.add(next.userId);
      guestPromptInFlightRef.current = true;
      setActiveGuestRequest({
        userId: next.userId,
        displayName: next.displayName || next.username || null,
        photoUrl: next.photoURL || next.photoUrl || null,
      });
    });

    return () => { try { unsub && unsub(); } catch { /* ignore */ } };
  }, [isHost, isStreaming, backend, streamId, uid, hostUid]);

  useEffect(() => {
    let cancelled = false;
    const id = toTrimmedString(activeGuestRequest?.userId);
    if (!id) {
      setActiveGuestRequestProfile({ userId: null, username: '', photoUrl: null, loading: false });
      return;
    }

    // Seed from the displayName/photo already carried on the request (the
    // Firestore mirror provides these), so the prompt shows the name immediately
    // instead of flashing the raw userId while the async profile fetch resolves.
    setActiveGuestRequestProfile((prev) => ({
      ...prev,
      userId: id,
      loading: true,
      username: pickPublicLabel(
        { displayName: activeGuestRequest?.displayName },
        { uid: id, fallback: prev.userId === id ? prev.username : 'Guest' },
      ),
      photoUrl: activeGuestRequest?.photoUrl || (prev.userId === id ? prev.photoUrl : null),
    }));

    (async () => {
      const profile = await fetchUserProfileForUserId(id);
      if (cancelled) return;
      setActiveGuestRequestProfile({
        userId: id,
        username: profile.username || '',
        photoUrl: profile.photoUrl || null,
        loading: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [activeGuestRequest?.userId]);

  // Always drop the requester from the shown set when the prompt closes — whether
  // dismissed, accepted, or rejected. The pending feed only contains REQUESTED
  // records, so a resolved (INVITED/REJECTED/LIVE) guest will NOT re-prompt; but
  // if that same user later leaves and re-requests (status → REQUESTED again),
  // the host MUST see it. Previously accept/reject left the id suppressed for the
  // whole session, so a returning guest's re-request never reached the host.
  const closeGuestRequestOverlay = (resolved = false) => {
    const id = toTrimmedString(activeGuestRequest?.userId);
    if (id) {
      try { shownGuestRequestIdsRef.current.delete(id); } catch {}
    }
    setActiveGuestRequest(null);
    guestPromptInFlightRef.current = false;
  };

  const acceptActiveGuestRequest = async () => {
    const id = toTrimmedString(activeGuestRequest?.userId);
    if (!id) return closeGuestRequestOverlay(true);
    try {
      const res = await inviteGuest(streamId, id);
      const slotIndex =
        typeof res?.slotIndex === 'number' && res.slotIndex >= 1 ? res.slotIndex : null;
      if (slotIndex != null && streamId) {
        // Reserve the authoritative box immediately (before IVS media arrives).
        const reserved = {
          userId: id,
          slotIndex,
          name: pickPublicLabel(
            {
              username: activeGuestRequestProfile?.username,
              displayName: activeGuestRequest?.displayName,
            },
            { uid: id, fallback: 'Guest' },
          ),
          photoUrl:
            activeGuestRequestProfile?.photoUrl ||
            activeGuestRequest?.photoUrl ||
            null,
          status: 'INVITED',
        };
        reservedGuestsRef.current.set(id, reserved);
        setLiveGuests((prev) => {
          const next = (Array.isArray(prev) ? prev : []).filter(
            (g) =>
              g &&
              String(g.userId) !== id &&
              !(typeof g.slotIndex === 'number' && g.slotIndex === slotIndex),
          );
          next.push(reserved);
          mirrorLiveGuests(streamId, next);
          return next;
        });
      }
    } catch (e) {
      console.warn('[HOST][INVITE_GUEST_FAILED]', e);
      const isPanelFull = String(e?.message || '').includes('PANEL_FULL');
      if (isPanelFull) {
        Alert.alert('Panel full', `You can have up to ${MAX_GUEST_SLOTS} guests on stage at once.`);
      } else {
        Alert.alert('Invite failed', 'Unable to accept guest right now.');
      }
      // Let it re-surface so the host can retry accepting.
      return closeGuestRequestOverlay(false);
    }
    // Mark the Firestore mirror as INVITED so it drops out of the pending feed
    // (the guest clears it entirely once they actually go live).
    setGuestRequestStatusMirror(streamId, id, 'INVITED');
    closeGuestRequestOverlay(true);
  };

  const rejectActiveGuestRequest = async () => {
    const id = toTrimmedString(activeGuestRequest?.userId);
    if (!id) return closeGuestRequestOverlay(true);
    try {
      await rejectGuest(streamId, id);
    } catch (e) {
      console.warn('[HOST][REJECT_GUEST_FAILED]', e);
    } finally {
      // Clear the Firestore mirror so the declined request stops showing.
      clearGuestRequestMirror(streamId, id);
      closeGuestRequestOverlay(true);
    }
  };

  const [showCountdown, setShowCountdown] = useState(false);
  // True from Go Live press until the stream is actually live, so we can show a
  // "Going live…" overlay during the camera/IVS spin-up instead of a dead screen.
  const [startingLive, setStartingLive] = useState(false);
  const [countdownValue, setCountdownValue] = useState(3);
  const [activeAttemptId, setActiveAttemptId] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0); // Timer in milliseconds
  const [segmentNumber, setSegmentNumber] = useState(0); // Track segment count
  const SEGMENT_DURATION_SECONDS = 2.5;
  const MIN_SEGMENT_BYTES = 50 * 1024; // Skip obviously truncated files (increased from 20KB)
  const segmentIndexRef = useRef(0);
  const streamingActiveRef = useRef(false);
  const isRecordingSegmentRef = useRef(false); // CRITICAL: prevent re-entry
  const [isRecording, setIsRecording] = useState(false); // Track if camera is recording
  const startInFlightRef = useRef(false);
  const flipInFlightRef = useRef(false);
  const [hostPreviewEpoch, setHostPreviewEpoch] = useState(0);
  // Expo CameraView for IVS pre-live + countdown (IVS session owns camera once live).
  const [preLivePreview, setPreLivePreview] = useState(true);
  const countdownInProgressRef = useRef(false);
  const countdownIntervalRef = useRef(null);
  const goLiveAttemptIdRef = useRef(null);
  const goLiveStartedRef = useRef(false);

  // Inform shared auth logic when a live flow is active.
  useEffect(() => {
    return () => {
      try {
        global.__BLYP_LIVE_ACTIVE__ = false;
      } catch { }
    };
  }, []);

  useEffect(() => {
    try {
      if (isStreaming) {
        global.__BLYP_LIVE_ACTIVE__ = true;
      } else if (!goLiveStartedRef.current) {
        global.__BLYP_LIVE_ACTIVE__ = false;
      }
    } catch { }
  }, [isStreaming]);

  // Clear the "Going live…" overlay once the stream is actually live; a safety
  // timeout prevents it ever getting stuck if start stalls.
  useEffect(() => {
    if (isStreaming) {
      setStartingLive(false);
      return;
    }
    if (!startingLive) return;
    const t = setTimeout(() => setStartingLive(false), 20000);
    return () => clearTimeout(t);
  }, [isStreaming, startingLive]);

  const cameraRef = useRef(null);
  const recordingIntervalRef = useRef(null); // For segment loop
  // CameraView uses 'facing' prop with 'front' or 'back' strings
  const [facing, setFacing] = useState('front');
  // Host preview pinch-to-zoom (drives the native view's `zoom` prop).
  const [hostZoom, setHostZoom] = useState(1);
  const hostZoomBaseRef = useRef(1);
  const hostZoomCurrentRef = useRef(1);
  const pinchRef = useRef(null);
  const doubleTapRef = useRef(null);
  const singleTapRef = useRef(null);
  const animatedValue = useRef(new Animated.Value(0)).current;

  const isAnonymousLike = (value) => {
    if (!value) return true;
    const s = String(value).trim();
    if (!s) return true;
    const normalized = s.replace(/^@+/, '').trim().toLowerCase();
    return [
      'anonymous',
      'anonymous user',
      'anon',
      'user',
      'viewer',
      'guest',
      'someone',
      'blyp user',
    ].includes(normalized);
  };

  const toTrimmedString = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  };

  const isLikelyIdentifierString = (value) => {
    const s = toTrimmedString(value);
    if (!s) return false;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const longNumericIdPattern = /^\d{10,}$/;
    const opaqueIdPattern = /^[A-Za-z0-9_-]{20,}$/;
    const emailLike = s.includes('@') && s.includes('.');
    return uuidPattern.test(s) || longNumericIdPattern.test(s) || opaqueIdPattern.test(s) || emailLike;
  };

  // Cache userId -> resolved username/display handle for legacy comments.
  const userNameCacheRef = useRef(new Map());
  const userNameLookupsInFlightRef = useRef(new Set());
  const userPhotoCacheRef = useRef(new Map());

  const pickBestUsernameFromUserDoc = (userData, fallbackUserId) => {
    const username = toTrimmedString(userData?.username || userData?.handle || userData?.userName);
    if (username && !isAnonymousLike(username) && username !== fallbackUserId && !isLikelyIdentifierString(username)) {
      return username;
    }

    const displayName = toTrimmedString(userData?.displayName || userData?.name || userData?.fullName);
    if (displayName && !isAnonymousLike(displayName) && displayName !== fallbackUserId && !isLikelyIdentifierString(displayName)) {
      return displayName;
    }

    return '';
  };

  const pickBestPhotoUrlFromUserDoc = (userData) => {
    const candidates = [
      userData?.photoURL,
      userData?.photoUrl,
      userData?.avatarUrl,
      userData?.avatarURL,
      userData?.profilePhotoUrl,
    ];
    for (const candidate of candidates) {
      const trimmed = toTrimmedString(candidate);
      if (trimmed) return trimmed;
    }
    return '';
  };

  const fetchUserProfileForUserId = async (userId) => {
    const id = toTrimmedString(userId);
    if (!id) return { username: '', photoUrl: '' };

    const cachedUsername = userNameCacheRef.current.get(id) || '';
    const cachedPhotoUrl = userPhotoCacheRef.current.get(id) || '';
    if (cachedUsername && cachedPhotoUrl) {
      return { username: cachedUsername, photoUrl: cachedPhotoUrl };
    }

    try {
      const collectionsToCheck = ['users', 'userProfiles'];
      const candidateDocs = [];

      for (const collectionName of collectionsToCheck) {
        try {
          const byIdSnap = await db.collection(collectionName).doc(id).get();
          const byIdData = snapData(byIdSnap);
          if (byIdData) candidateDocs.push(byIdData);
        } catch {
          // Ignore and continue with alternate lookup paths.
        }

        const uidFields = ['uid', 'userId', 'sub', 'cognitoSub'];
        for (const fieldName of uidFields) {
          try {
            const querySnap = await db
              .collection(collectionName)
              .where(fieldName, '==', id)
              .limit(1)
              .get();
            if (!querySnap.empty) {
              const data = querySnap.docs?.[0]?.data?.() || null;
              if (data) {
                candidateDocs.push(data);
                break;
              }
            }
          } catch {
            // Ignore missing-index/field-query failures and keep trying.
          }
        }
      }

      let username = cachedUsername;
      let photoUrl = cachedPhotoUrl;

      for (const candidate of candidateDocs) {
        if (!username) {
          username = pickBestUsernameFromUserDoc(candidate, id);
        }
        if (!photoUrl) {
          photoUrl = pickBestPhotoUrlFromUserDoc(candidate);
        }
        if (username && photoUrl) break;
      }

      if (username) userNameCacheRef.current.set(id, username);
      if (photoUrl) userPhotoCacheRef.current.set(id, photoUrl);
      return { username, photoUrl };
    } catch (_e) {
      return { username: '', photoUrl: '' };
    }
  };

  const applyResolvedCommentIdentity = (userId, { username = '', photoUrl = '' } = {}) => {
    const id = toTrimmedString(userId);
    if (!id) return;

    if (username) userNameCacheRef.current.set(id, username);
    if (photoUrl) userPhotoCacheRef.current.set(id, photoUrl);

    setComments((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;

      let changed = false;
      const next = prev.map((c) => {
        if (!c) return c;

        const cId = toTrimmedString(c.userId || c.uid);
        if (cId !== id) return c;

        const currentUsername = toTrimmedString(c.username);
        const currentAvatar = toTrimmedString(
          c.avatar || c.userPhotoURL || c.photoURL || c.photoUrl || c.profilePicture || c.userPhoto
        );

        let updated = c;
        // Update username if: fetched value exists AND (current is empty, 'User', userId, or looks ID-like)
        if (username && (!currentUsername || currentUsername === 'User' || currentUsername === id || isIdLike(currentUsername))) {
          updated = { ...updated, username };
        }
        if (photoUrl && !currentAvatar) {
          updated = { ...updated, avatar: photoUrl };
        }

        if (updated !== c) changed = true;
        return updated;
      });

      return changed ? next : prev;
    });
  };

  const fetchCommentIdentityForUserId = async (userId) => {
    const id = toTrimmedString(userId);
    if (!id) return;

    try {
      if (userNameCacheRef.current.has(id) && userPhotoCacheRef.current.has(id)) return;
      if (userNameLookupsInFlightRef.current.has(id)) return;
      userNameLookupsInFlightRef.current.add(id);

      const resolved = await fetchUserProfileForUserId(id);
      applyResolvedCommentIdentity(id, resolved);
    } catch (_e) {
      // Ignore lookup failures (offline / permissions). We'll fall back to generic label.
    } finally {
      try {
        userNameLookupsInFlightRef.current.delete(id);
      } catch { }
    }
  };

  const normalizeHandle = (value) => {
    const s = String(value || '').trim();
    if (!s) return '@user';
    return s.startsWith('@') ? s : `@${s}`;
  };

  const isIdLike = (str) => {
    return isLikelyIdentifierString(str);
  };

  const resolveCommentUsername = (c) => {
    if (!c || typeof c !== 'object') return 'User';

    const idFallback = toTrimmedString(c.userId || c.uid || c.userUID || '');

    const explicitUsername = toTrimmedString(c.username);
    // Use explicit username if it's a real username (not ID-like and not equal to userId)
    if (explicitUsername && !isAnonymousLike(explicitUsername) && !isIdLike(explicitUsername) && (!idFallback || explicitUsername !== idFallback)) {
      return explicitUsername;
    }

    // If explicit username is ID-like, trigger async fetch and trigger re-fetch
    if (explicitUsername && isIdLike(explicitUsername) && idFallback) {
      const cached = userNameCacheRef.current.get(idFallback);
      if (cached) return cached;
      fetchCommentIdentityForUserId(idFallback);
      return 'User'; // Return placeholder while fetching
    }

    if (idFallback) {
      const cached = userNameCacheRef.current.get(idFallback);
      if (cached) return cached;
    }

    const fallbackCandidates = [c.userName, c.displayName, c.userDisplayName, c.name];
    for (const candidate of fallbackCandidates) {
      const trimmed = toTrimmedString(candidate);
      if (!trimmed) continue;
      if (isAnonymousLike(trimmed)) continue;
      // Skip if this looks like an ID (UUID, email, or equals userId)
      if (isIdLike(trimmed) || (idFallback && trimmed === idFallback)) {
        if (idFallback) {
          fetchCommentIdentityForUserId(idFallback);
        }
        continue;
      }
      return trimmed;
    }

    if (idFallback) {
      fetchCommentIdentityForUserId(idFallback);
    }

    return 'User';
  };

  const resolveCommentAvatar = (c) => {
    if (!c || typeof c !== 'object') return '';

    const explicitAvatar = toTrimmedString(
      c.avatar || c.userPhotoURL || c.photoURL || c.photoUrl || c.profilePicture || c.userPhoto
    );
    if (explicitAvatar) return explicitAvatar;

    const idFallback = toTrimmedString(c.userId || c.uid || c.userUID || '');
    if (!idFallback) return '';

    const cached = userPhotoCacheRef.current.get(idFallback);
    if (cached) return cached;

    fetchCommentIdentityForUserId(idFallback);
    return '';
  };

  // Live chat UI is handled by <LiveChatOverlay /> (fed by the comments array).

  // Using RNFirebase services via imported modules/services

  // IVS Architecture Integration (feature-flagged, default OFF)
  const backend = streamingConfig.backend;
  console.log('[LIVE][BACKEND_SELECTED]', backend);

  useEffect(() => {
    if (backend === 'ivs' && goLiveStartedRef.current) {
      console.log('[ASSERT][HOST] Go Live pressed — waiting for native IVS start');
    }
  }, [backend]);

  // IVS Host Session (active if backend === IVS and isHost)
  const ivsHostEnabled = backend === StreamingBackend.IVS && isHost === true && !LIVE_UI_PREVIEW;
  console.log('[LIVE][IVS_HOST_ENABLED_DEBUG]', {
    ivsHostEnabled,
    backendIsIVS: backend === StreamingBackend.IVS,
    backendValue: backend,
    isHostValue: isHost,
    StreamingBackendIVS: StreamingBackend.IVS,
  });

  // Cache the battle's two participant uids so we can attribute gifts to a side.
  // Scoring only applies once the match clock has started (liveStartedAt).
  const battlePartsRef = useRef(null);
  const [battleLocalSide, setBattleLocalSide] = useState(null);
  useEffect(() => {
    if (!activeBattleId) {
      battlePartsRef.current = null;
      setBattleLocalSide(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const b = await getBattleDoc(activeBattleId);
      if (!cancelled && b) {
        const sideAUid = b.sideA?.userId || b.creatorUid;
        const sideBUid = b.sideB?.userId || b.opponentUid;
        battlePartsRef.current = {
          creatorUid: sideAUid,
          opponentUid: sideBUid,
          creatorName: b.sideA?.displayName || b.creatorName || 'Side A',
          opponentName: b.sideB?.displayName || b.opponentName || 'Side B',
          liveStartedAt: b.liveStartedAt || null,
          state: b.state || b.serverState || null,
        };
        setBattleLocalSide(
          String(uid || '') === String(sideAUid || '')
            ? 'A'
            : String(uid || '') === String(sideBUid || '')
              ? 'B'
              : null,
        );
      }
    })();
    return () => { cancelled = true; };
  }, [activeBattleId, uid]);

  // Keep liveStartedAt fresh via battle overlay subscription path (poll lightly).
  useEffect(() => {
    if (!activeBattleId) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const b = await getBattleDoc(activeBattleId);
        if (!cancelled && b && battlePartsRef.current) {
          battlePartsRef.current.liveStartedAt = b.liveStartedAt || null;
          battlePartsRef.current.state = b.state || b.serverState || null;
        }
      } catch { /* ignore */ }
    };
    const t = setInterval(tick, 2500);
    tick();
    return () => { cancelled = true; clearInterval(t); };
  }, [activeBattleId]);

  const attributeBattleGift = useCallback((payload) => {
    if (!activeBattleId || !payload) return;
    const parts = battlePartsRef.current;
    if (!parts?.liveStartedAt) return;
    const receiver = payload.receiverUserId || payload.receiver?.userId || payload.creatorId;
    const coins = Number(payload.coinSpent || payload.coinCost || payload.coins || 0) || 1;
    let side = null;
    if (receiver === parts.creatorUid) side = 'creator';
    else if (receiver === parts.opponentUid) side = 'opponent';
    if (!side) return;
    const senderUid = payload?.sender?.userId || payload?.senderUserId;
    if (senderUid) {
      recordBattleGifterContribution(activeBattleId, side, {
        uid: String(senderUid),
        name: payload?.sender?.handle || payload?.sender?.displayName || 'Fan',
        photoURL: payload?.sender?.avatarUrl || payload?.sender?.photoURL || '',
      }, coins);
    }
  }, [activeBattleId]);

  const onBattleStarted = useCallback(async (info) => {
    try {
      const b = await getBattleDoc(info.battleId);
      if (b) {
        await markBattleJoined(b, uid, { liveStreamId: info.sessionId, stageArn: info.stageArn });
      }
    } catch (e) {
      console.warn('[LIVE][BATTLE_MARK_JOINED_FAILED]', e?.message || e);
    }
  }, [uid]);

  const ivsHostSession = useIVSHostSession({
    enabled: ivsHostEnabled,
    streamId: streamId || undefined,
    title: title,
    battle: isBattleParticipant
      ? { battleId: routeBattleId, role: routeBattleRole, sessionId: routeBattleSessionId || undefined }
      : undefined,
    onBattleStarted: isBattleParticipant ? onBattleStarted : undefined,
  });

  // Host: keep stream doc battle id in sync so viewers see MatchBar without a route param.
  useEffect(() => {
    if (isViewer || !isStreaming) return;
    const sid = streamId || ivsHostSession?.sessionId || ivsHostSession?.streamId;
    if (!sid || !activeBattleId) return;
    mirrorActiveBattleId(sid, activeBattleId);
  }, [isViewer, isStreaming, streamId, activeBattleId, ivsHostSession?.sessionId, ivsHostSession?.streamId]);

  // Number of real (remote) guests currently on stage for the host —
  // includes INVITED reservations so the tray opens before IVS media arrives.
  const hostGuestCount = useMemo(() => {
    try {
      const fromIvs = (ivsHostSession?.participants || []).filter(
        (p) => p && !p.isLocal && typeof p.slotIndex === 'number' && p.slotIndex >= 1
      ).length;
      const fromRoster = (liveGuests || []).filter(
        (g) => g && typeof g.slotIndex === 'number' && g.slotIndex >= 1
      ).length;
      return Math.max(fromIvs, fromRoster);
    } catch {
      return 0;
    }
  }, [ivsHostSession?.participants, liveGuests]);

  // Auto-reveal one guest row the moment the first guest joins (so a host who
  // hid the tray isn't left with guests behind the handle). A second row remains
  // an explicit swipe-up action.
  // Battles use a dedicated side-by-side stage — keep the multi-guest tray closed.
  useEffect(() => {
    if (activeBattleId) {
      prevHostGuestCountRef.current = hostGuestCount;
      return;
    }
    if (hostGuestCount > 0 && prevHostGuestCountRef.current === 0) {
      setHostGuestTrayMode((prev) => (prev === 'hidden' ? 'collapsed' : prev));
    }
    prevHostGuestCountRef.current = hostGuestCount;
  }, [hostGuestCount, activeBattleId]);

  // First remote publisher = battle opponent for the 1v1 split stage.
  const battleOpponentParticipant = useMemo(() => {
    if (!activeBattleId) return null;
    const parts = ivsHostSession?.participants || [];
    return parts.find((p) => p && !p.isLocal && typeof p.slotIndex === 'number' && p.slotIndex >= 1)
      || parts.find((p) => p && !p.isLocal)
      || null;
  }, [activeBattleId, ivsHostSession?.participants]);

  const didForceReattachSessionRef = useRef(null);

  useEffect(() => {
    try {
      if (!isHost) return;
      if (backend !== StreamingBackend.IVS) return;
      if (!cameraReady) return;

      const sessionId = ivsHostSession?.sessionId;
      if (!sessionId) return;
      if (ivsHostSession?.connectionState === 'idle') return;

      if (didForceReattachSessionRef.current === sessionId) return;
      didForceReattachSessionRef.current = sessionId;

      console.log('[IVS][FORCE_REATTACH][JS] cameraReady true, forcing native reattach', { sessionId });
      getIVSNativeClient()
        .forceReattach('permissions_granted')
        .then(() => {
          console.log('[IVS][FORCE_REATTACH][JS] done');
        })
        .catch((e) => {
          console.warn('[IVS][FORCE_REATTACH][JS] failed', e);
        });
    } catch (e) {
      console.warn('[IVS][FORCE_REATTACH][JS] exception', e);
    }
  }, [backend, isHost, cameraReady, ivsHostSession?.connectionState, ivsHostSession?.sessionId]);

  console.log('[LIVE][IVS_HOST_SESSION]', {
    enabled: ivsHostEnabled,
    backend,
    connectionState: ivsHostSession.connectionState,
    participants: ivsHostSession.participants.length,
    networkQuality: ivsHostSession.networkQuality,
    error: ivsHostSession.error,
  });

  // STEP 3 + Guard: Validate viewer route params and enforce single source of truth
  useEffect(() => {
    // Viewer mode requires streamId. hostUid is preferred for block/gift chrome
    // but must not bounce the viewer back to the Live list when missing.
    if (isViewer && !routeStreamId) {
      console.warn('[LIVE][GUARD] Viewer mode with invalid params, navigating back', {
        mode,
        isViewer,
        routeStreamId,
        routeHostUid,
      });
      if (navigation && navigation.goBack) {
        exitHandledRef.current = true;
        navigation.goBack();
      }
    }
  }, [isViewer, routeStreamId, routeHostUid, navigation]);

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        // App came to foreground, reinitialize camera
        setCameraReady(false);
        // Short delay to allow UI to update
        setTimeout(() => setCameraReady(true), 500);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    // STEP 3: VIEWER MODE NEVER REQUESTS PERMISSIONS
    if (!isHost) {
      console.log('[LIVE][PERMISSIONS] Non-host mode: skipping camera and microphone permission requests');
      setCameraReady(false); // Viewers don't need camera
      return; // Exit immediately, do not request permissions
    }

    // HOST MODE: Request camera and microphone permissions
    console.log('[LIVE][PERMISSIONS] Host mode: requesting camera and microphone permissions');
    if (!cameraPermission) {
      console.log('[CAMERA] Requesting camera permission...');
      requestCameraPermission();
    }
    if (!microphonePermission) {
      console.log('[CAMERA] Requesting microphone permission...');
      requestMicrophonePermission();
    }

    // CRITICAL: Set camera as ready ONLY after BOTH permissions granted (host mode only)
    if (mounted && cameraPermission?.granted && microphonePermission?.granted) {
      console.log('[LIVE][CAMERA_PERMISSIONS_STATE] Both granted, setting cameraReady=true');
      setCameraReady(true);
    } else {
      console.log('[LIVE][CAMERA_PERMISSIONS_STATE] Waiting for permissions:', {
        cameraGranted: cameraPermission?.granted,
        micGranted: microphonePermission?.granted,
        cameraReady,
      });
    }

    return () => {
      mounted = false;

      // Cleanup when component unmounts
      if (isStreaming) {
        stopStreaming();
      }
    };
  }, [navigation, cameraPermission, microphonePermission, isHost]);

  // Lifecycle-safe: only run focus-time camera readiness logic when this screen is focused.
  useFocusEffect(
    useCallback(() => {
      if (!isHost) return;

      console.log('[CAMERA] LiveStreamScreen focused, checking permissions');
      if (cameraPermission?.granted && microphonePermission?.granted) {
        console.log('[CAMERA] Permissions OK on focus, setting cameraReady=true');
        setCameraReady(true);
      }

      return undefined;
    }, [isHost, cameraPermission?.granted, microphonePermission?.granted])
  );

  // Timer effect: Update elapsed time every second when streaming
  useEffect(() => {
    if (!isStreaming || !streamStartTime) {
      setElapsedTime(0);
      return;
    }

    console.log('â±ï¸ Starting timer interval');
    const timerInterval = setInterval(() => {
      const elapsed = Date.now() - streamStartTime;
      setElapsedTime(elapsed);
    }, 1000);

    return () => {
      console.log('â±ï¸ Clearing timer interval');
      clearInterval(timerInterval);
    };
  }, [isStreaming, streamStartTime]);

  // Viewer mode: Subscribe to stream stats (view count, hearts)
  useEffect(() => {
    if (!isViewer || !routeStreamId) return;
    if (backend === StreamingBackend.IVS) return;

    console.log('ðŸ“Š Viewer subscribing to stream stats:', routeStreamId);
    const unsubscribe = HLSLiveStreamServiceInstance.subscribeToStream(routeStreamId, (data) => {
      if (data) {
        setViewCount(Math.max(0, data.viewCount || 0));
        setHeartCount((prev) => Math.max(prev, data.likes || 0));
      } else {
        console.log('âš ï¸ Stream not found or ended:', routeStreamId);
      }
    });

    return () => {
      console.log('ðŸ“Š Unsubscribing from stream stats');
      unsubscribe();
    };
  }, [isViewer, routeStreamId]);

  // IVS mode: subscribe to gift events via Socket.IO (authoritative live-service economy)
  useEffect(() => {
    if (backend !== StreamingBackend.IVS) return;

    // Socket auth requires a valid Cognito session.
    if (!isAuthenticated || !uid) return;

    const activeStreamId = isViewer ? routeStreamId : streamId;
    if (!activeStreamId) return;

    // Viewer always subscribes; host subscribes only while streaming.
    if (!isViewer && !isStreaming) return;

    let sub = null;
    let cancelled = false;

    (async () => {
      try {
        sub = await subscribeToGiftEvents(String(activeStreamId), async (payload) => {
          // In a battle, a gift also adds gift-weighted score to the receiving side.
          attributeBattleGift(payload);
          // Tally gifts per recipient this session (for the Guest Control sheet).
          const rid = payload?.receiver?.userId;
          if (rid) {
            setGiftTotalsByUser((prev) => {
              const cur = prev[rid] || { count: 0, coins: 0 };
              return {
                ...prev,
                [rid]: {
                  count: cur.count + (Number(payload?.quantity) || 1),
                  coins: cur.coins + (Number(payload?.coinSpent) || 0),
                },
              };
            });
            setSessionEngagementByUser((prev) => {
              const cur = prev[rid] || { likes: 0, shares: 0, comments: 0, coinsSpent: 0, coinsReceived: 0 };
              return {
                ...prev,
                [rid]: {
                  ...cur,
                  coinsReceived: (cur.coinsReceived || 0) + (Number(payload?.coinSpent) || 0),
                },
              };
            });
          }
          const sidGift = payload?.sender?.userId;
          if (sidGift) {
            setSessionEngagementByUser((prev) => {
              const cur = prev[sidGift] || { likes: 0, shares: 0, comments: 0, coinsSpent: 0, coinsReceived: 0 };
              return {
                ...prev,
                [sidGift]: {
                  ...cur,
                  coinsSpent: (cur.coinsSpent || 0) + (Number(payload?.coinSpent) || 0),
                },
              };
            });
          }
          // The backend only sends sender.userId (handle/avatar are null), so the
          // overlay was showing a generic "Someone". Resolve the real sender's
          // name + avatar from their userId before forwarding to the overlay so
          // it shows who actually sent the gift.
          let enriched = payload;
          try {
            const sid = payload?.sender?.userId;
            if (sid && !payload?.sender?.handle) {
              const prof = await fetchUserProfileForUserId(sid);
              enriched = {
                ...payload,
                sender: {
                  ...(payload.sender || {}),
                  handle: prof?.username || payload?.sender?.handle || null,
                  avatarUrl: prof?.photoUrl || payload?.sender?.avatarUrl || null,
                },
              };
            }
          } catch {
            // fall back to the raw payload
          }
          // Also resolve the RECEIVER's name/avatar so the overlay can show who
          // the gift was sent TO (the backend sends receiver.handle = null too).
          try {
            const rid2 = payload?.receiver?.userId;
            if (rid2 && !payload?.receiver?.handle) {
              const rprof = await fetchUserProfileForUserId(rid2);
              enriched = {
                ...enriched,
                receiver: {
                  ...(payload.receiver || {}),
                  handle: rprof?.username || payload?.receiver?.handle || null,
                  avatarUrl: rprof?.photoUrl || payload?.receiver?.avatarUrl || null,
                },
              };
            }
          } catch {
            // keep whatever receiver info we already have
          }
          setIncomingGiftEvent(enriched);
        });
      } catch (e) {
        if (cancelled) return;
        console.warn('[LIVE][IVS][GIFT_SOCKET_SUBSCRIBE_FAILED]', e?.message || String(e));
      }
    })();

    return () => {
      cancelled = true;
      try {
        sub?.close?.();
      } catch {
        // ignore
      }
    };
  }, [backend, isViewer, routeStreamId, streamId, isStreaming, isAuthenticated, uid]);

  // IVS mode: subscribe to Firestore viewerCount (host + viewer)
  useEffect(() => {
    if (backend !== StreamingBackend.IVS) return;

    const activeStreamId = isViewer ? routeStreamId : streamId;
    if (!activeStreamId) return;

    // Viewer always subscribes; host subscribes only while streaming.
    if (!isViewer && !isStreaming) return;

    // viewerCount is tracked on streams/{id} (incrementViewer). Likes, however,
    // are written by the addLiveStreamLike Cloud Function onto liveStreams/{id}
    // so that any authenticated user (host or viewer) can contribute to a single
    // shared total. Subscribe to both docs so host and all viewers converge on
    // the same like figure in real time.
    const streamsRef = db.collection('streams').doc(activeStreamId);
    const unsubscribeStreams = streamsRef.onSnapshot(
      (snap) => {
        const data = snapData(snap);
        const nextCount = typeof data?.viewerCount === 'number' ? data.viewerCount : 0;
        // Never display a negative viewer count (transient during decrements).
        setViewCount(Math.max(0, nextCount));
      },
      (err) => {
        console.warn('[LIVE][IVS][VIEWER_COUNT_SUBSCRIBE_ERROR]', err);
      },
    );

    const likesRef = db.collection('liveStreams').doc(activeStreamId);
    const unsubscribeLikes = likesRef.onSnapshot(
      (snap) => {
        const data = snapData(snap);
        const nextLikes = typeof data?.likes === 'number' ? data.likes : 0;
        // Likes are monotonic within a session. Take the max of the optimistic
        // local value and the shared server value so an in-flight tap is never
        // reset to a stale snapshot, while still reflecting other people's likes.
        setHeartCount((prev) => Math.max(prev, nextLikes));
      },
      (err) => {
        console.warn('[LIVE][IVS][LIKES_SUBSCRIBE_ERROR]', err);
      },
    );

    return () => {
      try {
        unsubscribeStreams();
      } catch { }
      try {
        unsubscribeLikes();
      } catch { }
    };
  }, [backend, isViewer, routeStreamId, streamId, isStreaming]);

  // IVS host heartbeat: keep the directory entry fresh while actually broadcasting.
  // The "live now" list drops streams whose heartbeat is older than 90s, so this
  // is what makes a crashed/force-quit host disappear instead of lingering as a
  // stale, un-joinable card.
  useEffect(() => {
    if (backend !== StreamingBackend.IVS) return;
    if (isViewer || !isStreaming || !streamId) return;

    heartbeatStream(streamId);
    const t = setInterval(() => {
      heartbeatStream(streamId);
    }, 30 * 1000);

    return () => clearInterval(t);
  }, [backend, isViewer, isStreaming, streamId]);

  // Host: mirror the on-stage guest roster onto the stream doc so that viewers
  // (who don't have the IVS participant list) can see and gift guests too.
  // INVITED reservations live in reservedGuestsRef so boxes paint before IVS media.
  const lastGuestSigRef = useRef('');
  useEffect(() => {
    if (backend !== StreamingBackend.IVS) return;
    if (isViewer || !isStreaming || !streamId) return;

    const byUser = new Map();
    reservedGuestsRef.current.forEach((g, userId) => {
      if (!g || typeof g.slotIndex !== 'number' || g.slotIndex < 1) return;
      byUser.set(String(userId), { ...g, userId: String(userId) });
    });
    (ivsHostSession.participants || []).forEach((p) => {
      if (!p || p.isLocal || !p.userId || p.userId === uid) return;
      const userId = String(p.userId);
      const slotIndex = typeof p.slotIndex === 'number' ? p.slotIndex : null;
      const prev = byUser.get(userId) || reservedGuestsRef.current.get(userId) || {};
      byUser.set(userId, {
        userId,
        slotIndex: slotIndex ?? prev.slotIndex ?? null,
        name: prev.name || null,
        photoUrl: prev.photoUrl || null,
        status: 'LIVE',
      });
      // Media arrived — drop INVITED reservation so kick/leave cleans cleanly.
      if (reservedGuestsRef.current.has(userId)) {
        reservedGuestsRef.current.delete(userId);
      }
    });
    const guests = Array.from(byUser.values()).filter(
      (g) => typeof g.slotIndex === 'number' && g.slotIndex >= 1,
    );

    const sig = guests.map((g) => `${g.userId}:${g.slotIndex}:${g.status || ''}`).sort().join('|');
    if (sig === lastGuestSigRef.current) return;
    lastGuestSigRef.current = sig;

    let cancelled = false;
    (async () => {
      const resolved = await Promise.all(guests.map(async (g) => {
        let name = pickPublicLabel(
          { name: g.name, username: g.username, displayName: g.displayName },
          { uid: g.userId, fallback: '' },
        );
        if (name === 'Someone') name = '';
        let photoUrl = g.photoUrl || null;
        if (!name || !photoUrl) {
          try {
            const snap = await db.collection('users').doc(g.userId).get();
            const d = (snap && typeof snap.data === 'function' ? snap.data() : null) || {};
            name = name || pickPublicLabel(d, { uid: g.userId, fallback: 'Guest' });
            photoUrl = photoUrl || d.photoURL || d.userPhotoURL || null;
          } catch { /* best effort */ }
        }
        return {
          userId: g.userId,
          slotIndex: g.slotIndex,
          name,
          photoUrl,
          status: g.status || null,
        };
      }));
      if (cancelled) return;
      mirrorLiveGuests(streamId, resolved);
      setLiveGuests(resolved);
    })();

    return () => { cancelled = true; };
  }, [backend, isViewer, isStreaming, streamId, uid, ivsHostSession.participants]);

  // Host + viewer: read the mirrored guest roster from the stream doc so the
  // gift recipient picker can offer the host and every on-stage guest.
  useEffect(() => {
    const activeStreamId = isViewer ? routeStreamId : streamId;
    if (!activeStreamId) {
      setLiveGuests([]);
      return;
    }
    const unsub = HLSLiveStreamServiceInstance.subscribeToStream(activeStreamId, (data) => {
      const fromDoc = data && Array.isArray(data.guests) ? data.guests : [];
      // Merge INVITED reservations so a stale Firestore snapshot cannot blank
      // a box the host already reserved from the invite response.
      const byUser = new Map();
      fromDoc.forEach((g) => {
        if (g?.userId) {
          byUser.set(String(g.userId), {
            ...g,
            name: pickPublicLabel(g, { uid: g.userId, fallback: 'Guest' }),
          });
        }
      });
      reservedGuestsRef.current.forEach((g, userId) => {
        if (!byUser.has(String(userId))) {
          byUser.set(String(userId), {
            ...g,
            name: pickPublicLabel(g, { uid: userId, fallback: 'Guest' }),
          });
        }
      });
      setLiveGuests(Array.from(byUser.values()));
      if (data && data.guestLayoutMode) {
        setGuestLayoutMode(normalizeLiveLayoutMode(data.guestLayoutMode));
      }
      const bid = data?.activeBattleId ? String(data.activeBattleId) : null;
      setMirroredBattleId(bid);
    });
    return () => { try { unsub && unsub(); } catch { /* ignore */ } };
  }, [isViewer, routeStreamId, streamId]);

  // Host: mirror compositional layout so every viewer renders the same sticky layout.
  useEffect(() => {
    if (backend !== StreamingBackend.IVS) return;
    if (isViewer || !isStreaming || !streamId) return;
    mirrorGuestLayoutMode(streamId, guestLayoutMode);
  }, [backend, isViewer, isStreaming, streamId, guestLayoutMode]);

  // HLS mode: host subscribes to its own stream stats while live (so host doesn't stay at 0).
  useEffect(() => {
    if (backend === StreamingBackend.IVS) return;
    if (!isHost || isViewer) return;
    if (!isStreaming || !streamId) return;

    const unsubscribe = HLSLiveStreamServiceInstance.subscribeToStream(streamId, (data) => {
      if (data) {
        setViewCount(Math.max(0, data.viewCount || 0));
        setHeartCount((prev) => Math.max(prev, data.likes || 0));
      }
    });

    return () => {
      try {
        unsubscribe();
      } catch { }
    };
  }, [backend, isHost, isViewer, isStreaming, streamId]);

  // Removed legacy startRecordingSegment that used Web SDK; using HLSLiveStreamService instead

  const startStreaming = async () => {
    console.log('[LIVE][START_STREAMING_PRESSED] Button press detected!', { isHost, isStreaming, title });
    // Correlation id for this attempt
    goLiveAttemptIdRef.current = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setActiveAttemptId(goLiveAttemptIdRef.current);
    console.log('[LIVE][ATTEMPT_ID]', { goLiveAttemptId: goLiveAttemptIdRef.current });
    console.log('[LIVE][GO_LIVE_BUTTON]', {
      attemptId: goLiveAttemptIdRef.current,
      isHost,
      isStreaming,
      countdownInProgress: countdownInProgressRef.current,
      startInFlight: startInFlightRef.current,
    });

    // STEP 3: GUARD - Host only operation
    if (!isHost) {
      console.warn('[LIVE][GUARD] Ignoring startStreaming in non-host mode', {
        isHost,
        isViewer,
        mode,
      });
      return;
    }

    // Guard: prevent double-starts
    if (startInFlightRef.current || countdownInProgressRef.current) {
      console.warn('[LIVE][GUARD] Start ignored: startInFlight/countdown already active', {
        startInFlight: startInFlightRef.current,
        countdownInProgress: countdownInProgressRef.current,
      });
      return;
    }

    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for your live stream.');
      return;
    }

    // IVS backend does not use Expo CameraView ref; HLS backend does.
    if (backend !== StreamingBackend.IVS) {
      // Check if camera is ready and ref is available (HLS mode)
      if (!cameraRef.current) {
        console.log('â³ Camera not ready yet, waiting...');

        // Make sure camera is enabled
        setCameraReady(true);

        // Wait for camera to initialize
        setTimeout(() => {
          if (cameraRef.current) {
            console.log('âœ… Camera is now ready after waiting');
            startCountdown();
          } else {
            Alert.alert('Camera Error', 'Camera is not available. Please try restarting the app.');
          }
        }, 1000);
        return;
      }
    }

    console.log('âœ… Camera is ready, starting countdown');
    startCountdown();
  };

  // DEV-ONLY: E2E auto-start host live (no UI taps)
  useEffect(() => {
    if (!__DEV__) return;
    if (String(process.env?.EXPO_PUBLIC_E2E_LIVE || '') !== '1') return;
    if (!isHost) return;
    if (!routeE2EAutoStart) return;

    if (e2eAutoTriggeredRef.current) return;
    if (isStreaming) return;
    if (startInFlightRef.current || countdownInProgressRef.current) return;

    // Wait for stable auth before auto-start.
    if (!authReady || !isAuthenticated || !uid) return;

    // Only auto-start IVS; avoid accidentally starting HLS path.
    if (backend !== StreamingBackend.IVS) {
      console.warn('[E2E_LIVE] Auto-start requested but backend is not IVS', { backend });
      return;
    }

    const desiredTitle = String(routeE2ETitle || 'E2E Live').trim();
    if (!String(title || '').trim()) {
      setTitle(desiredTitle);
      return; // wait for state update
    }

    console.warn('[E2E_LIVE] Auto-starting host live now', {
      uid,
      title,
      attemptId: goLiveAttemptIdRef.current,
    });
    e2eAutoTriggeredRef.current = true;

    // Give navigation/layout a moment to settle before invoking native IVS startup.
    // This reduces Surface/SurfaceTexture lifecycle races on some devices.
    let timeoutId;
    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      timeoutId = setTimeout(() => {
        try {
          startStreaming();
        } catch { }
      }, 900);
    });

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (interactionHandle && typeof interactionHandle.cancel === 'function') {
        interactionHandle.cancel();
      }
    };
  }, [
    authReady,
    isAuthenticated,
    uid,
    isHost,
    routeE2EAutoStart,
    routeE2ETitle,
    backend,
    isStreaming,
    title,
  ]);

  // Extracted countdown logic to separate function for clarity
  const startCountdown = () => {
    console.log('[LIVE][START_COUNTDOWN] Countdown starting now!', { goLiveAttemptId: goLiveAttemptIdRef.current });
    // Auth stability gate: require stable auth for 500ms before countdown
    const authStableStartTs = Date.now();
    const checkAuthStable = () => authReady && isAuthenticated && !!uid;
    if (!checkAuthStable()) {
      console.warn('[LIVE][AUTH_GUARD_FAIL]', { reason: 'AUTH_NOT_STABLE_AT_COUNTDOWN_START', authReady, isAuthenticated, uid });
      Alert.alert('Login required', 'You must be logged in to go live.');
      return;
    }
    // Debounce window
    setTimeout(() => {
      if (!checkAuthStable()) {
        console.warn('[LIVE][AUTH_FLIP_DETECTED]', { reason: 'AUTH_FLIPPED_DURING_DEBOUNCE', authReady, isAuthenticated, uid });
        Alert.alert('Login changed', 'Authentication changed; canceling start. Please try again.');
        return;
      }
      goLiveStartedRef.current = true;
      try {
        global.__BLYP_LIVE_ACTIVE__ = true;
      } catch { }
      // Start countdown animation
      setStartingLive(true);
      setShowCountdown(true);
      setCountdownValue(3);
      countdownInProgressRef.current = true;
      let count = 3;
      countdownIntervalRef.current = setInterval(() => {
        // If auth flips during countdown, cancel
        if (!checkAuthStable()) {
          console.warn('[LIVE][AUTH_FLIP_DETECTED]', { reason: 'AUTH_FLIPPED_DURING_COUNTDOWN', authReady, isAuthenticated, uid });
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          countdownInProgressRef.current = false;
          setShowCountdown(false);
          try {
            global.__BLYP_LIVE_ACTIVE__ = false;
          } catch { }
          Alert.alert('Login changed', 'Authentication changed; start canceled.');
          return;
        }
        count--;
        setCountdownValue(count);
        console.log('[LIVE][COUNTDOWN_TICK]', count, { goLiveAttemptId: goLiveAttemptIdRef.current });
        if (count === 0) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          countdownInProgressRef.current = false;
          console.log('[LIVE][COUNTDOWN_COMPLETE] Countdown done, calling actuallyStartStream', { goLiveAttemptId: goLiveAttemptIdRef.current });
          // Release Expo CameraView before IVS opens Camera2 (same device conflict).
          setShowCountdown(false);
          setPreLivePreview(false);
          startInFlightRef.current = true;
          setTimeout(() => {
            actuallyStartStream();
          }, 450);
        }
      }, 1000);
    }, 500);
  };

  const actuallyStartStream = async () => {
    // STEP 3: GUARD - Host only operation
    if (!isHost) {
      console.warn('[LIVE][GUARD] actuallyStartStream called in non-host mode, aborting', {
        isHost,
        mode,
      });
      return;
    }

    // Auth guard: ensure user is logged in before attempting stream
    if (!authReady) {
      console.warn('[LIVE][AUTH_GUARD_FAIL]', {
        reason: 'AUTH_NOT_READY',
        uid,
        isAuthenticated,
        authReady,
      });
      Alert.alert(
        'Please wait',
        'We are still finishing login. Try again in a moment.'
      );
      return;
    }

    if (!isAuthenticated || !uid) {
      console.warn('[LIVE][AUTH_GUARD_FAIL]', {
        reason: 'NO_UID_OR_NOT_AUTHENTICATED',
        uid,
        isAuthenticated,
        authReady,
      });
      Alert.alert(
        'Login required',
        'You must be logged in to go live.'
      );
      return;
    }

    // DEV: Skip Firebase auth bridge (Firestore rules are open)
    if (__DEV__) {
      console.log('[LIVE][AUTH] DEV: skipping Firebase auth bridge (Firestore rules are open).');
    }

    try {
      console.log('[LIVE][ACTUALLY_START_STREAM] Function called', { isHost, uid, authReady, isAuthenticated, goLiveAttemptId: goLiveAttemptIdRef.current });

      // Feature flag guard: block if streaming disabled
      const streamingEnabled = isLiveStreamingEnabled();
      console.log('[LIVE][STREAMING_FLAG_CHECK]', { streamingEnabled });

      if (!streamingEnabled) {
        console.error('[LIVE][STREAMING_DISABLED] Feature flag check failed!');
        Alert.alert(
          'Live streaming not available',
          'Our live streaming backend is not fully configured yet. Please try again later.'
        );
        setIsStreaming(false);
        return;
      }

      console.log('ðŸš€ Starting live stream', { backend, uid, title });

      const resolvedDisplayName = getDisplayNameSafe();
      console.log('[LIVE][DEBUG_DISPLAYNAME_RESOLUTION]', {
        resolvedDisplayName,
        uid,
      });

      console.log('[LIVE][CREATE_STREAM_CALL]', {
        userId: uid,
        userDisplayName: resolvedDisplayName,
        title,
        mode,
        backend,
      });

      // IVS Backend: Start streaming via IVS Real-Time
      if (backend === StreamingBackend.IVS) {
        console.log('[LIVE][IVS] Starting IVS broadcast');
        console.log('[LIVE][IVS][PRE_START]', {
          hasIvsHostSession: !!ivsHostSession,
          hasStartStreaming: !!ivsHostSession?.startStreaming,
          facing,
          connectionState: ivsHostSession?.connectionState
        });

        logStreamingEvent('STREAM_START_REQUEST', {
          backendId: 'IVS',
          userId: uid,
          source: 'UI',
          mode: 'host',
          goLiveAttemptId: goLiveAttemptIdRef.current,
        });

        try {
          if (!ivsHostSession.enabled) {
            throw new Error('IVS host session is not enabled.');
          }

          console.log('[LIVE][IVS][HOST_START_SEQUENCE]', {
            attemptId: goLiveAttemptIdRef.current,
            sessionId: ivsHostSession.sessionId,
            streamIdRef: ivsHostSession.streamIdRef?.current,
            connectionState: ivsHostSession.connectionState,
          });

          console.log('[LIVE][IVS][CALLING_START_STREAMING]', { goLiveAttemptId: goLiveAttemptIdRef.current });
          const ivsStreamId = await ivsHostSession.startStreaming(
            facing === 'back' ? 'back' : 'front',
            goLiveAttemptIdRef.current
          );
          console.log('[LIVE][IVS][START_STREAMING_RETURNED]', { sessionId: ivsStreamId });

          if (!ivsStreamId) {
            throw new Error('IVS start failed: missing session id');
          }

          setStreamId(ivsStreamId);

          // Register stream in Firestore so other users can discover it
          console.log('[LIVE][IVS][REGISTERING_FIRESTORE]', { streamId: ivsStreamId, title, uid, goLiveAttemptId: goLiveAttemptIdRef.current });
          const reg = await createFirestoreStream({
            streamId: ivsStreamId,
            title: title || 'Live Stream',
            thumbnailUrl: null,
            userId: uid,
            attemptId: goLiveAttemptIdRef.current,
          });
          // IVS stage is already live here. A Firestore directory failure must not
          // tear down a working broadcast (Wave 0 rules briefly denied liveStreams).
          if (reg?.ok === false) {
            console.error('[LIVE][IVS][FIRESTORE_REGISTER_SOFT_FAIL]', {
              streamId: ivsStreamId,
              error: reg.error,
            });
            Alert.alert(
              'Live started',
              'You are broadcasting, but discovery listing failed. Viewers may not find this stream until sync recovers.'
            );
          } else {
            console.log('[LIVE][IVS][FIRESTORE_REGISTERED]', { streamId: ivsStreamId });
          }
          try {
            await heartbeatStream(ivsStreamId);
          } catch (hbErr) {
            console.warn('[LIVE][IVS][HEARTBEAT_AFTER_REGISTER_FAIL]', hbErr?.message || hbErr);
          }

          // Only mark as streaming after native session confirmed
          // Note: We wait for connection state 'connected' event in listener
          setIsStreaming(true);
          setStreamStartTime(Date.now());

          // STRICT: Only log success AFTER we know native succeeded (no error + state advancing)
          logStreamingEvent('STREAM_START_SUCCESS', {
            backendId: 'IVS',
            userId: uid,
            streamId: ivsStreamId,
            connectionState: ivsHostSession.connectionState,
            source: 'UI',
            goLiveAttemptId: goLiveAttemptIdRef.current,
          });

          console.log('ðŸŽ‰ IVS live streaming started successfully', {
            streamId: ivsStreamId,
            connectionState: ivsHostSession.connectionState,
          });

        } catch (error) {
          console.error('[LIVE][IVS][START_FAILED]', error);
          console.error('[LIVE][IVS][ERROR_DETAILS]', {
            message: error?.message,
            stack: error?.stack,
            error: String(error),
            hookError: ivsHostSession.error
          });

          logStreamingEvent('STREAM_START_FAILURE', {
            backendId: 'IVS',
            userId: uid,
            reason: error.message || String(error),
            hookError: ivsHostSession.error,
            source: 'UI',
            goLiveAttemptId: goLiveAttemptIdRef.current,
          });

          const rawMessage = String(error?.message || error || '');
          const lower = rawMessage.toLowerCase();
          const isCognitoJwtError = rawMessage.includes('[COGNITO_JWT]');
          const isExplicitNotLoggedIn =
            rawMessage.includes('Not logged in to Cognito') ||
            lower.includes('missing/expired session') ||
            lower.includes('no authenticated user') ||
            lower.includes('not authenticated') ||
            lower.includes('invalid or expired session');

          // Treat only clear Cognito-auth failures as a login-required UX.
          // Other errors should surface as a normal streaming error.
          if (isCognitoJwtError && isExplicitNotLoggedIn) {
            Alert.alert(
              'Login required',
              'Your Cognito session is missing or expired. Please sign in again, then try going live.',
              [{ text: 'OK', style: 'default' }]
            );
          } else {
            Alert.alert('Streaming Error', error.message || 'Could not start IVS stream.');
          }
          setIsStreaming(false);
          setStartingLive(false);
          setPreLivePreview(true);
          try {
            global.__BLYP_LIVE_ACTIVE__ = false;
          } catch { }
          startInFlightRef.current = false;
          goLiveStartedRef.current = false;

          // Compensating rollback (P4.B): startStreaming() may have already
          // brought up the native IVS session before a later step (e.g. the
          // Firestore registration) threw. Without tearing the native session
          // down here, the host is left publishing to an orphaned stage that no
          // viewer can discover (and that silently bills AWS). Best-effort stop +
          // directory cleanup so a partial failure never leaves a ghost live.
          try {
            const orphanStreamId = ivsHostSession.streamIdRef?.current || streamId;
            try {
              await ivsHostSession.stopStreaming();
            } catch (stopErr) {
              console.warn('[LIVE][IVS][START_ROLLBACK_STOP_FAILED]', stopErr?.message || String(stopErr));
            }
            if (orphanStreamId) {
              try {
                await endFirestoreStream(orphanStreamId, uid);
              } catch (cleanupErr) {
                console.warn('[LIVE][IVS][START_ROLLBACK_CLEANUP_FAILED]', cleanupErr?.message || String(cleanupErr));
              }
            }
            setStreamId(null);
            setStreamStartTime(null);
          } catch (rollbackErr) {
            console.warn('[LIVE][IVS][START_ROLLBACK_FAILED]', rollbackErr?.message || String(rollbackErr));
          }
        }

        return;
      }

      // HLS Backend (Legacy): Start segment recording
      console.log('[LIVE][HLS] Starting HLS segment recording (legacy)');

      // Double-check camera ref is available for HLS mode
      if (!cameraRef.current) {
        Alert.alert('Camera Error', 'Camera reference was lost. Please try again.');
        return;
      }

      logStreamingEvent('STREAM_START_REQUEST', {
        backendId: 'HLS',
        userId: uid,
        source: 'UI',
        mode: 'host',
      });

      const hlsBackend = getStreamingBackend();
      const result = await hlsBackend.createStream({
        userId: uid,
        title: title,
        displayName: resolvedDisplayName,
        photoURL: null,
        email: null,
        attemptId: goLiveAttemptIdRef.current,
        headers: { 'X-GoLive-Attempt-Id': goLiveAttemptIdRef.current },
      });

      // Handle structured error
      if (!result.ok) {
        console.error('âŒ Stream creation failed:', result.reason || result.error);

        logStreamingEvent('STREAM_START_FAILURE', {
          backendId: 'HLS',
          userId: uid,
          reason: result.reason,
          errorMessage: result.error,
          source: 'UI',
        });

        if (result.reason === 'NOT_LOGGED_IN') {
          Alert.alert(
            'Streaming error',
            'We had a problem starting your stream. Please try again.'
          );
        } else if (result.reason === 'BACKEND_NOT_CONFIGURED') {
          Alert.alert(
            'Live streaming not available',
            'The live streaming backend is not configured right now.'
          );
        } else if (result.reason === 'PERMISSION_DENIED') {
          Alert.alert(
            'Live streaming not available',
            'You do not have permission to stream from this account.'
          );
        } else {
          Alert.alert(
            'Streaming error',
            result.error || 'Unable to start live stream.'
          );
        }

        setIsStreaming(false);
        return;
      }

      logStreamingEvent('STREAM_START_SUCCESS', {
        backendId: 'HLS',
        userId: uid,
        streamId: result.data.streamId,
        source: 'UI',
        goLiveAttemptId: goLiveAttemptIdRef.current,
      });

      const newStreamId = result.data.streamId;

      setStreamId(newStreamId);
      console.log('âœ… HLS Stream created:', newStreamId);

      setIsStreaming(true);
      setStreamStartTime(Date.now());
      segmentIndexRef.current = 0;
      streamingActiveRef.current = true;
      setSegmentNumber(0);

      // Start continuous segment recording (2.5 second intervals)
      startSegmentRecordingLoop(newStreamId);

      console.log('ðŸŽ‰ HLS live streaming started successfully');

    } catch (error) {
      console.error('âŒ Stream start error:', error);
      Alert.alert('Streaming Error', 'Could not start live stream. Please try again.');
      streamingActiveRef.current = false;
      setIsStreaming(false);
      startInFlightRef.current = false;
    }
  };

  // Continuous segment recording loop
  const startSegmentRecordingLoop = async (streamIdParam) => {
    // STEP 3: GUARD - Host only operation
    if (!isHost) {
      console.warn('[LIVE][GUARD] startSegmentRecordingLoop called in non-host mode, blocking', {
        isHost,
        mode,
      });
      return;
    }

    const currentStreamId = streamIdParam || streamId;
    if (!currentStreamId) {
      console.error('âŒ No stream ID for recording');
      return;
    }
    if (!uid) {
      console.error('âŒ No user ID for recording uploads');
      return;
    }

    console.log('ðŸŽ¬ Starting segment recording loop', { currentStreamId });

    const recordNextSegment = async () => {
      const hasCamera = !!cameraRef.current;
      const isStreamingActive = streamingActiveRef.current;
      const currentSegmentNumber = segmentIndexRef.current;

      console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] CHECK: hasCamera=${hasCamera}, isStreamingActive=${isStreamingActive}`);

      if (!hasCamera || !isStreamingActive) {
        console.log('â¹ï¸ Stopping segment loop: camera or stream unavailable', {
          hasCamera,
          isStreamingActive,
          currentStreamId,
        });
        // Loop will exit naturally when isStreamingActive becomes false
        return;
      }

      // CRITICAL: Prevent re-entry - only one recording at a time
      if (isRecordingSegmentRef.current) {
        console.warn(`[RECORD_SEGMENT_${currentSegmentNumber}] Already recording, skipping re-entry`);
        return;
      }

      isRecordingSegmentRef.current = true;

      try {
        setIsRecording(true);
        console.log(`ðŸ“¹ Recording segment ${currentSegmentNumber}... BEFORE recordAsync`);

        // Record 2.5 second segment
        console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] Calling recordAsync with maxDuration=${SEGMENT_DURATION_SECONDS}, quality=720p`);
        const video = await cameraRef.current.recordAsync({
          maxDuration: SEGMENT_DURATION_SECONDS,
          quality: '720p',
        });
        console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] recordAsync COMPLETED, received video.uri`);

        setIsRecording(false);
        console.log(`âœ… Segment ${currentSegmentNumber} recorded:`, video.uri);

        // Guard against truncated files that can produce invalid segments
        let segmentSize = 0;
        let fileExists = false;
        try {
          const info = await FileSystem.getInfoAsync(video.uri);
          fileExists = info?.exists || false;
          segmentSize = info?.size || 0;
          console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] File info: exists=${fileExists}, size=${segmentSize}`);

          if (!fileExists) {
            console.error(`[RECORD_SEGMENT_${currentSegmentNumber}] File does not exist, aborting upload`, { uri: video.uri });
            return;
          }

          if (segmentSize < MIN_SEGMENT_BYTES) {
            console.error(`[RECORD_SEGMENT_${currentSegmentNumber}] File too small (likely corrupt), aborting upload`, {
              size: segmentSize,
              minBytes: MIN_SEGMENT_BYTES,
              uri: video.uri,
            });
            return;
          }
        } catch (infoErr) {
          console.error(`[RECORD_SEGMENT_${currentSegmentNumber}] getInfoAsync failed, CANNOT validate segment`, infoErr);
          // Without size validation, we MUST abort to prevent corrupt uploads
          return;
        }

        // Upload segment via streaming backend
        const backend = getStreamingBackend();
        console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] Uploading to backend...`);
        const uploadResult = await backend.uploadSegment({
          streamId: currentStreamId,
          userId: uid,
          fileUri: video.uri,
          segmentNumber: currentSegmentNumber,
        });

        if (!uploadResult.ok) {
          console.error(`âŒ Segment ${currentSegmentNumber} upload failed:`, uploadResult.error);
        } else {
          console.log(`âœ… Segment ${currentSegmentNumber} uploaded`);
        }

        // Increment ref first so next run uses N+1, then reflect to state for UI
        segmentIndexRef.current = currentSegmentNumber + 1;
        setSegmentNumber(segmentIndexRef.current);
        console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] Segment completed, incrementing counter -> ${segmentIndexRef.current}`);

      } catch (error) {
        setIsRecording(false);
        console.error(`âŒ Error recording segment ${currentSegmentNumber}:`, error.message, error);
        console.error(`[RECORD_SEGMENT_${currentSegmentNumber}] Full error stack:`, JSON.stringify(error, Object.getOwnPropertyNames(error)));
      } finally {
        // CRITICAL: Always release recording guard
        isRecordingSegmentRef.current = false;
      }
    };

    // CRITICAL: Sequential recording loop - wait for each segment to complete before starting next
    // This prevents overlap and ensures upload finishes before viewer timeout
    const recordLoop = async () => {
      while (streamingActiveRef.current && cameraRef.current) {
        await recordNextSegment();
        // Short delay before next segment (allows state updates to propagate)
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      console.log('â¹ï¸ Recording loop exited');
    };

    // Start the loop
    recordLoop().catch(err => {
      console.error('âŒ Recording loop crashed:', err);
      streamingActiveRef.current = false;
    });
  };

  const withSoftTimeout = useCallback((promise, ms, label) => {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label || 'operation'}_timeout`)), ms);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }, []);

  const buildSummaryParams = useCallback(
    (id) => ({
      streamId: String(id || '').trim(),
      title: title || '',
      startedAt: typeof streamStartTime === 'number' ? streamStartTime : Date.now(),
      likes: heartCount || 0,
      peakViewers: viewCount || 0,
    }),
    [title, streamStartTime, heartCount, viewCount]
  );

  const stopStreaming = async () => {
    const summaryId = String(
      (backend === StreamingBackend.IVS
        ? (ivsHostSession?.streamIdRef?.current || streamId)
        : streamId) || ''
    ).trim();
    const summaryParams = buildSummaryParams(summaryId);

    const goSummaryNow = () => {
      if (!summaryParams.streamId) {
        if (typeof navigation?.goBack === 'function') {
          exitHandledRef.current = true;
          navigation.goBack();
        }
        return;
      }
      exitHandledRef.current = true;
      if (typeof navigation?.replace === 'function') {
        navigation.replace('LiveSummary', summaryParams);
      } else if (typeof navigation?.navigate === 'function') {
        navigation.navigate('LiveSummary', summaryParams);
      }
    };

    try {
      console.log('â¹ï¸ Stopping stream', { backend, streamId: summaryId });

      // IVS Backend: Stop native broadcast
      if (backend === StreamingBackend.IVS) {
        console.log('[LIVE][IVS] Stopping IVS broadcast');

        logStreamingEvent('STREAM_END_REQUEST', {
          backendId: 'IVS',
          streamId: summaryId,
          userId: uid,
          source: 'UI',
        });

        try {
          await withSoftTimeout(ivsHostSession.stopStreaming(), 8000, 'ivs_stop');
          console.log('âœ… IVS stream stopped');
        } catch (error) {
          console.warn('âš ï¸ IVS stream stop failed:', error);
          logStreamingEvent('STREAM_END_FAILURE', {
            backendId: 'IVS',
            streamId: summaryId,
            userId: uid,
            reason: error?.message || String(error),
            source: 'UI',
          });
        }

        // Navigate to summary immediately — never wait on Firestore cleanup.
        setIsStreaming(false);
        goSummaryNow();

        if (summaryId) {
          console.log('[LIVE][IVS][UNREGISTERING_FIRESTORE]', { streamId: summaryId, uid });
          void withSoftTimeout(endFirestoreStream(summaryId, uid), 6000, 'firestore_end')
            .then(() => console.log('[LIVE][IVS][FIRESTORE_UNREGISTERED]', { streamId: summaryId }))
            .catch((firestoreError) =>
              console.warn('[LIVE][IVS][FIRESTORE_CLEANUP_FAILED]', firestoreError?.message || String(firestoreError))
            );
        }

        logStreamingEvent('STREAM_END_SUCCESS', {
          backendId: 'IVS',
          streamId: summaryId,
          userId: uid,
          source: 'UI',
        });
      } else {
        // HLS Backend (Legacy): Stop segment recording
        console.log('[LIVE][HLS] Stopping HLS segment recording (legacy)');

        streamingActiveRef.current = false;
        segmentIndexRef.current = 0;

        if (cameraRef.current && isRecording) {
          try {
            await withSoftTimeout(cameraRef.current.stopRecording(), 5000, 'hls_stop_recording');
          } catch (e) {
            console.warn('[LIVE][HLS] stopRecording failed', e?.message || String(e));
          }
        }

        if (streamId) {
          logStreamingEvent('STREAM_END_REQUEST', {
            backendId: 'HLS',
            streamId,
            userId: uid,
            source: 'UI',
          });

          try {
            const hlsBackend = getStreamingBackend();
            const endResult = await withSoftTimeout(
              hlsBackend.endStream({ streamId, userId: uid }),
              8000,
              'hls_end'
            );
            if (!endResult?.ok) {
              console.warn('âš ï¸ HLS stream end failed:', endResult?.error);
              logStreamingEvent('STREAM_END_FAILURE', {
                backendId: 'HLS',
                streamId,
                userId: uid,
                reason: endResult?.reason,
                errorMessage: endResult?.error,
                source: 'UI',
              });
            } else {
              console.log('âœ… HLS stream ended:', streamId);
              logStreamingEvent('STREAM_END_SUCCESS', {
                backendId: 'HLS',
                streamId,
                userId: uid,
                source: 'UI',
              });
            }
          } catch (e) {
            console.warn('[LIVE][HLS] endStream failed', e?.message || String(e));
          }
        }

        setIsStreaming(false);
        goSummaryNow();
      }

      // Cleanup remaining local state after navigation (non-blocking for UX).
      setStreamStartTime(null);
      setStreamId(null);
      setSegmentNumber(0);
      setIsRecording(false);
      setComments([]);
      setViewCount(0);
      setHeartCount(0);
      setTitle('');
    } catch (error) {
      console.error('âŒ Error stopping stream:', error);
      setIsStreaming(false);
      setStreamStartTime(null);
      setStreamId(null);
      setSegmentNumber(0);
      setIsRecording(false);
      goSummaryNow();
    }
  };

  const summaryStreamId = String((isViewer ? routeStreamId : streamId) || '').trim();

  const goToSummary = useCallback(() => {
    const params = buildSummaryParams(summaryStreamId);
    if (!params.streamId) {
      if (typeof navigation?.goBack === 'function') {
        exitHandledRef.current = true;
        navigation.goBack();
      }
      return;
    }

    exitHandledRef.current = true;
    if (typeof navigation?.replace === 'function') {
      navigation.replace('LiveSummary', params);
    } else if (typeof navigation?.navigate === 'function') {
      navigation.navigate('LiveSummary', params);
    }
  }, [navigation, summaryStreamId, buildSummaryParams]);

  const _handleConfirmExit = useCallback(async () => {
    setShowExitConfirm(false);
    if (exitHandledRef.current) return;
    exitHandledRef.current = true;
    if (!isViewer && isStreaming) {
      try {
        await stopStreaming();
        return;
      } catch (_) {
        // fall through to summary
      }
    }
    goToSummary();
  }, [goToSummary, isViewer, isStreaming, stopStreaming]);

  const confirmExitLive = useCallback(() => {
    if (exitHandledRef.current) return;
    setShowExitConfirm(true);
  }, []);

  // Intercept swipe-back + back navigation (only while this screen is focused).
  useFocusEffect(
    useCallback(() => {
      const unsub = navigation.addListener('beforeRemove', (e) => {
        if (exitHandledRef.current) return;
        if (commentsModalVisible) return;

        // If we don't have a streamId, don't trap the user.
        if (!summaryStreamId) return;

        // Viewers / guests: leave through the summary screen (same as host end).
        if (isViewer) {
          e.preventDefault();
          goToSummary();
          return;
        }

        // Only confirm-trap a HOST who is actively broadcasting.
        if (!isStreaming) return;

        e.preventDefault();
        confirmExitLive();
      });

      return unsub;
    }, [navigation, confirmExitLive, commentsModalVisible, summaryStreamId, isViewer, isStreaming, goToSummary])
  );

  // Launch a floating reaction (emoji=null => heart) and record it as engagement.
  // `emoji` null keeps the classic heart icon; any emoji floats that sticker.
  // Rapid taps are batched so Frenemies 50-like challenges stay achievable.
  const likeBatchRef = useRef({ count: 0, timer: null });
  const triggerReaction = async (emoji = null) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // haptics are best-effort
    }
    // Animate heart icon pulse on the like control.
    Animated.sequence([
      Animated.timing(animatedValue, {
        toValue: 1,
        duration: 300,
        easing: Easing.elastic(1),
        useNativeDriver: true,
      }),
      Animated.timing(animatedValue, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    setReactionBurst((prev) => ({ key: prev.key + 1, emoji }));

    setHeartCount((current) => current + 1);

    // Update like count via backend asynchronously (non-blocking). All reactions
    // count as positive engagement so the live like total stays meaningful.
    const activeStreamId = routeStreamId || streamId;
    if (!activeStreamId || !uid) return;

    likeBatchRef.current.count += 1;
    if (likeBatchRef.current.timer) clearTimeout(likeBatchRef.current.timer);
    likeBatchRef.current.timer = setTimeout(async () => {
      const batch = Math.min(20, likeBatchRef.current.count || 1);
      likeBatchRef.current.count = 0;
      likeBatchRef.current.timer = null;
      try {
        // Session engagement + Frenemies likes challenge (batched).
        await bumpLiveEngagement(String(activeStreamId), { likes: batch });
      } catch {
        // non-fatal
      }
      try {
        const token = await getCognitoJwtForApi({ tokenType: 'id' });
        // Fire one CF like per batch unit (cap) so shared counter still moves.
        await HLSLiveStreamServiceInstance.addLike(activeStreamId, uid, token);
      } catch (_e) {
        try {
          await HLSLiveStreamServiceInstance.toggleLike(activeStreamId, uid, true);
        } catch {
          // ignore — optimistic UI already updated
        }
      }
    }, 180);
  };

  const sendHeart = () => triggerReaction(null);

  const sendComment = async (textOverride) => {
    const activeStreamId = isViewer ? routeStreamId : streamId;
    const raw = (typeof textOverride === 'string' ? textOverride : newComment).trim();
    if (!raw || !activeStreamId) return;

    if (!uid || !isAuthenticated) {
      console.error('Cannot send comment: user not authenticated');
      Alert.alert('Login Required', 'You must be logged in to comment.');
      return;
    }

    // Safety filter: drop hate/abuse outright, mask soft profanity.
    const { blocked, clean } = inspectText(raw);
    if (blocked) {
      Alert.alert('Message not sent', 'That message goes against our Community Guidelines.');
      if (typeof textOverride !== 'string') setNewComment('');
      return;
    }
    const content = clean.trim();
    if (!content) return;

    // Optimistic bubble: show it instantly so sending feels responsive. It's
    // reconciled away when the real comment echoes back (effect above), or
    // removed here on failure / after a safety timeout if it never echoes.
    const tempId = `pending-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const optimistic = {
      id: tempId,
      userId: uid,
      username: pickPublicLabel(
        {
          username: hostUserDoc?.username,
          handle: hostUserDoc?.handle,
          displayName: isViewer ? getDisplayNameSafe() : resolvedHostName,
        },
        { uid, fallback: 'You' },
      ),
      text: content,
      createdAt: Date.now(),
      pending: true,
    };
    setPendingComments((prev) => [...prev, optimistic]);
    if (typeof textOverride !== 'string') {
      setNewComment('');
    }
    const dropPending = () => setPendingComments((prev) => prev.filter((p) => p.id !== tempId));
    const safetyTimer = setTimeout(dropPending, 15000);

    try {
      const token = await getCognitoJwtForApi({ tokenType: 'id' });
      await HLSLiveStreamServiceInstance.addComment(activeStreamId, content, uid, token);
      try {
        await bumpLiveEngagement(String(activeStreamId), { comments: 1 });
      } catch {
        // ignore
      }
      try {
        const dn = getDisplayNameSafe();
        await frenemiesChat(String(activeStreamId), content, dn);
      } catch {
        // no active challenge / non-fatal
      }
    } catch (error) {
      console.error('Error sending comment:', error);
      clearTimeout(safetyTimer);
      dropPending();
      const message = error?.message || 'Failed to send comment. Please try again.';
      Alert.alert('Error', message);
    }
  };

  const buildShareUrl = (activeStreamId) => {
    const id = String(activeStreamId || '').trim();
    if (!id) return 'https://blyp.world';
    return `https://blyp.world/live/${encodeURIComponent(id)}`;
  };

  // Viewer safety menu: report the stream or block the host.
  const openLiveSafetyMenu = () => {
    const actions = [
      { text: 'Report this live', onPress: () => setLiveReportVisible(true) },
    ];
    if (hostUid && hostUid !== uid) {
      actions.push({
        text: 'Block host',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            'Block host',
            'You won’t see their posts, comments, lives or messages. You can unblock them from their profile.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Block',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await blockUser(hostUid);
                    Alert.alert('Blocked', 'You’ve blocked this host.');
                    try { navigation.goBack(); } catch {}
                  } catch (e) {
                    Alert.alert('Couldn’t block', e?.message || 'Please try again.');
                  }
                },
              },
            ]
          );
        },
      });
    }
    actions.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Live options', '', actions);
  };

  const shareLive = async () => {
    const activeStreamId = isViewer ? routeStreamId : streamId;
    if (!activeStreamId) return;

    const url = buildShareUrl(activeStreamId);
    const message = `Watch my live on Blyp\n${url}`;

    try {
      await Share.share({ message, url });
      try {
        await bumpLiveEngagement(String(activeStreamId), { shares: 1 });
      } catch {
        // ignore
      }
    } catch (e) {
      // If the share sheet fails (rare), still allow the user to copy the link.
    }

    // Copy link (optional). If clipboard module isn't present in the installed dev client,
    // we just skip copying.
    const copied = await tryCopyToClipboard(url);
    if (copied) {
      try {
        Toast.show({ type: 'success', text1: 'Link copied', text2: url });
      } catch (e) {
        Alert.alert('Link copied', url);
      }
    }
  };

  const openGift = (recipient) => {
    setGiftRecipient(recipient && recipient.userId ? recipient : null);
    setGiftOpenSignal(Date.now());
  };

  // Tap a commenter to gift them (viewer-gifting). Self is ignored.
  const giftCommenter = (item) => {
    const targetId = item?.userId;
    if (!targetId) return;
    if (uid && targetId === uid) return;
    openGift({
      userId: String(targetId),
      name: pickPublicLabel(item, { uid: targetId, fallback: 'Viewer' }),
    });
  };

  const inviteGuestFromFollowGraph = useCallback(async (user) => {
    const targetId = user?.id || user?.userId;
    const sid = ivsHostSession?.sessionId || ivsHostSession?.streamId || streamId;
    if (!targetId || !sid) {
      Alert.alert('Invite failed', 'Go live first, then invite someone to join.');
      throw new Error('missing_session');
    }
    setInvitingGuestUid(String(targetId));
    try {
      const res = await hostInviteGuest(String(sid), String(targetId));
      const slotIndex =
        typeof res?.slotIndex === 'number' && res.slotIndex >= 1 ? res.slotIndex : null;
      if (slotIndex != null) {
        const reserved = {
          userId: String(targetId),
          slotIndex,
          name: pickPublicLabel(user || {}, { uid: targetId, fallback: 'Guest' }),
          photoUrl: user?.photoURL || user?.photoUrl || user?.avatar || null,
          status: 'INVITED',
        };
        reservedGuestsRef.current.set(String(targetId), reserved);
        setLiveGuests((prev) => {
          const next = (Array.isArray(prev) ? prev : []).filter(
            (g) =>
              g &&
              String(g.userId) !== String(targetId) &&
              !(typeof g.slotIndex === 'number' && g.slotIndex === slotIndex),
          );
          next.push(reserved);
          mirrorLiveGuests(String(sid), next);
          return next;
        });
      }
      Toast.show?.({
        type: 'success',
        text1: 'Invite sent',
        text2: `${pickPublicLabel(user || {}, { uid: targetId, fallback: 'Guest' })} got a Blyp ping`,
      });
    } catch (e) {
      const msg = String(e?.message || e?.code || '');
      Alert.alert(
        msg.includes('PANEL_FULL') ? 'Panel full' : 'Invite failed',
        msg.includes('PANEL_FULL')
          ? `You can have up to ${MAX_GUEST_SLOTS} guests on stage at once.`
          : 'Could not invite this person right now.'
      );
      throw e;
    } finally {
      setInvitingGuestUid(null);
    }
  }, [ivsHostSession?.sessionId, ivsHostSession?.streamId, streamId]);

  // Host tapping a commenter: choose to gift them OR invite them up as a guest.
  // (Viewers only get the gift action.) The invite is host-initiated — the viewer
  // gets an accept prompt and only then goes on stage.
  const onPressCommenter = (item) => {
    const targetId = item?.userId;
    if (!targetId) return;
    if (uid && targetId === uid) return;
    if (!isHost) {
      giftCommenter(item);
      return;
    }
    const label = pickPublicLabel(item, { uid: targetId, fallback: 'this viewer' });
    Alert.alert(label, 'What would you like to do?', [
      { text: 'Send gift', onPress: () => giftCommenter(item) },
      {
        text: 'Invite to join',
        onPress: async () => {
          const sid = ivsHostSession?.sessionId || ivsHostSession?.streamId || streamId;
          if (!sid) return;
          try {
            await hostInviteGuest(String(sid), String(targetId));
          } catch (e) {
            const msg = String(e?.message || '');
            Alert.alert(
              msg.includes('PANEL_FULL') ? 'Panel full' : 'Invite failed',
              msg.includes('PANEL_FULL')
                ? `You can have up to ${MAX_GUEST_SLOTS} guests on stage at once.`
                : 'Could not invite this viewer right now.'
            );
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Everyone can gift everyone: viewers can gift the host or any on-stage guest,
  // and the host can gift their guests. If there is only one possible recipient
  // we skip the chooser; otherwise we present a quick picker.
  const promptGiftRecipient = () => {
    if (activeBattleId) {
      const parts = battlePartsRef.current;
      if (!parts || parts.state !== 'LIVE' || !parts.liveStartedAt) {
        Alert.alert('Battle gifts open at LIVE', 'Both sides must be on stage and the countdown must finish.');
        return;
      }
      const sides = [
        {
          userId: parts.creatorUid,
          name: parts.creatorName,
          battleSide: 'A',
          label: `SIDE A · ${normalizeHandle(parts.creatorName || 'Side A')}`,
        },
        {
          userId: parts.opponentUid,
          name: parts.opponentName,
          battleSide: 'B',
          label: `SIDE B · ${normalizeHandle(parts.opponentName || 'Side B')}`,
        },
      ].filter((target) => target.userId && String(target.userId) !== String(uid || ''));
      if (!sides.length) {
        Alert.alert('No battle side available', 'You cannot send a battle gift to yourself.');
        return;
      }
      Alert.alert(
        'Gift a Battle Arena side',
        'Choose SIDE A or SIDE B. Your gift scores only for that side.',
        [
          ...sides.map((target) => ({
            text: target.label,
            onPress: () => openGift(target),
          })),
          { text: 'Cancel', style: 'cancel' },
        ],
        { cancelable: true },
      );
      return;
    }

    const isSelfHost = !!(uid && hostUid && uid === hostUid);
    const guests = (liveGuests || []).filter((g) => g && g.userId && g.userId !== uid);

    const recipients = [];
    if (!isSelfHost) {
      recipients.push({
        userId: hostUid,
        name: resolvedHostName || 'Host',
        label: `Host · ${normalizeHandle(resolvedHostName || 'Host')}`,
      });
    }
    guests.forEach((g) => {
      recipients.push({
        userId: g.userId,
        name: pickPublicLabel(g, { uid: g.userId, fallback: 'Guest' }),
        label: `Guest · ${normalizeHandle(pickPublicLabel(g, { uid: g.userId, fallback: 'Guest' }))}`,
      });
    });

    if (recipients.length === 0) {
      // Host with no guests on stage — nobody to gift.
      Alert.alert('No one to gift yet', 'Invite a guest on stage, then you can send them a gift.');
      return;
    }
    if (recipients.length === 1) {
      openGift(recipients[0]);
      return;
    }
    Alert.alert(
      'Send a gift to',
      'Choose who receives your gift',
      [
        ...recipients.map((r) => ({ text: r.label, onPress: () => openGift({ userId: r.userId, name: r.name }) })),
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true },
    );
  };

  // Subscribe to comments (host: when streaming; viewer: whenever viewing a stream)
  useEffect(() => {
    const activeStreamId = isViewer ? routeStreamId : streamId;
    if (!activeStreamId) return;
    if (!isViewer && !isStreaming) return;

    const unsubscribe = HLSLiveStreamServiceInstance.subscribeToComments(activeStreamId, (items) => {
      // Normalize to expected shape for UI
      const normalized = items.map((c) => ({
        id: c.id,
        userId: c.userId || c.uid || null,
        username: resolveCommentUsername(c),
        avatar: resolveCommentAvatar(c),
        text: c.content || c.text || '',
        createdAt:
          (typeof c?.timestamp?.toMillis === 'function' ? c.timestamp.toMillis() : null) ||
          (typeof c?.timestamp === 'number' ? c.timestamp : null) ||
          (typeof c?.createdAt === 'number' ? c.createdAt : null) ||
          null,
      }));
      setComments(normalized);
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      setComments([]);
    };
  }, [isStreaming, streamId, isViewer, routeStreamId]);

  // "X joined" chat lines: subscribe to the room-event bus and append a synthetic
  // comment whenever a viewer joins. Additive + best-effort; deduped by event id,
  // capped so long streams don't accumulate unbounded entries.
  useEffect(() => {
    const activeStreamId = isViewer ? routeStreamId : streamId;
    if (!activeStreamId) return;
    if (!isViewer && !isStreaming) return;
    let sub = null;
    let active = true;
    const seen = new Set();
    (async () => {
      try {
        sub = await subscribeToRoomEvents(activeStreamId, (evt) => {
          if (!evt || evt.type !== 'viewer.joined') return;
          if (evt.id && seen.has(evt.id)) return;
          if (evt.id) seen.add(evt.id);
          const viewerUserId = evt.viewerUserId || null;
          const name = pickPublicLabel(
            { displayName: evt.displayName },
            { uid: viewerUserId, fallback: 'Viewer' },
          );
          setJoinMessages((prev) => {
            const next = [
              ...prev,
              {
                id: `join-${evt.id || `${evt.viewerUserId || ''}-${Date.now()}`}`,
                userId: viewerUserId,
                username: name,
                avatar: null,
                text: 'joined',
                createdAt: Date.parse(evt.ts) || Date.now(),
                system: true,
              },
            ];
            return next.slice(-25);
          });
        });
        if (!active && sub) { try { sub.close(); } catch { /* ignore */ } }
      } catch (e) {
        console.warn('[LIVE][ROOM_EVENTS_JOIN_SUBSCRIBE_FAILED]', e?.message || String(e));
      }
    })();
    return () => {
      active = false;
      try { sub?.close?.(); } catch { /* ignore */ }
      setJoinMessages([]);
    };
  }, [isStreaming, streamId, isViewer, routeStreamId]);

  const flipCamera = async () => {
    if (flipInFlightRef.current) return;
    flipInFlightRef.current = true;
    try {
      if (backend === StreamingBackend.IVS) {
        if (typeof ivsHostSession?.switchCamera === 'function') {
          // Native parks SurfaceTexture attaches during HAL swap. After settle,
          // remount the TextureView so a fresh Surface attaches — reusing the
          // old one causes EGL_BAD_NATIVE_WINDOW / freeze on Fold.
          await ivsHostSession.switchCamera();
          setFacing((current) => (current === 'front' ? 'back' : 'front'));
          setHostPreviewEpoch((n) => n + 1);
          return;
        }
        setFacing((current) => (current === 'front' ? 'back' : 'front'));
        return;
      }

      setFacing((current) => (current === 'front' ? 'back' : 'front'));
    } catch (e) {
      console.warn('[LIVE][FLIP_CAMERA_FAILED]', e?.message || String(e));
    } finally {
      flipInFlightRef.current = false;
    }
  };

  // Pinch-to-zoom on the host preview. Updates a plain `zoom` prop consumed by
  // the native IVS broadcast view (center-crop scale) on Android + iOS.
  const clampZoom = (z) => Math.min(4, Math.max(1, Number.isFinite(z) ? z : 1));

  const onHostPinchEvent = (e) => {
    const next = clampZoom(hostZoomBaseRef.current * (e?.nativeEvent?.scale ?? 1));
    hostZoomCurrentRef.current = next;
    setHostZoom(next);
  };

  const onHostPinchStateChange = (e) => {
    if (e?.nativeEvent?.oldState === GestureState.ACTIVE) {
      hostZoomBaseRef.current = clampZoom(hostZoomCurrentRef.current);
    }
  };

  // Host mic mute/unmute. Plumbing exists in the native client + host session
  // hook on both platforms; this surfaces it in the broadcaster UI.
  const toggleMic = async () => {
    if (backend !== StreamingBackend.IVS) return;
    if (typeof ivsHostSession?.setMicEnabled !== 'function') return;
    try {
      const next = !(ivsHostSession?.isMicEnabled ?? true);
      await ivsHostSession.setMicEnabled(next);
    } catch (e) {
      console.warn('[LIVE][MIC_TOGGLE_FAILED]', e?.message || String(e));
    }
  };

  // Host moderation: which guests the host has muted (optimistic local mirror of
  // the server `mutedByHost` state; the guest's client enforces the actual mic cut).
  const [mutedGuestIds, setMutedGuestIds] = useState(() => new Set());

  // Host moderation: toggle a guest's microphone (host or moderator only, enforced
  // server-side). Optimistic with rollback so the icon reflects intent instantly.
  const toggleGuestMute = async (guest) => {
    if (!guest) return;
    const guestUserId = guest.userId || guest.participantId;
    const sid = ivsHostSession?.sessionId || ivsHostSession?.streamId || streamId;
    if (!guestUserId || !sid) return;
    const willMute = !mutedGuestIds.has(guestUserId);
    setMutedGuestIds((prev) => {
      const next = new Set(prev);
      if (willMute) next.add(guestUserId); else next.delete(guestUserId);
      return next;
    });
    try {
      await muteGuest(String(sid), String(guestUserId), willMute);
    } catch (e) {
      console.warn('[LIVE][MUTE_GUEST_FAILED]', e?.message || String(e));
      setMutedGuestIds((prev) => {
        const next = new Set(prev);
        if (willMute) next.delete(guestUserId); else next.add(guestUserId);
        return next;
      });
      Alert.alert('Couldn’t update mic', 'Please try again.');
    }
  };

  // Host moderation: which guests the host has turned the camera off for
  // (optimistic mirror of server `cameraOffByHost`; the guest's client enforces it).
  const [cameraOffGuestIds, setCameraOffGuestIds] = useState(() => new Set());

  // Host moderation: toggle a guest's camera (host/moderator only, server-enforced).
  // When off, the guest cannot turn it back on themselves.
  const toggleGuestCamera = async (guest) => {
    if (!guest) return;
    const guestUserId = guest.userId || guest.participantId;
    const sid = ivsHostSession?.sessionId || ivsHostSession?.streamId || streamId;
    if (!guestUserId || !sid) return;
    const willTurnOff = !cameraOffGuestIds.has(guestUserId);
    setCameraOffGuestIds((prev) => {
      const next = new Set(prev);
      if (willTurnOff) next.add(guestUserId); else next.delete(guestUserId);
      return next;
    });
    try {
      await setGuestCamera(String(sid), String(guestUserId), willTurnOff);
    } catch (e) {
      console.warn('[LIVE][GUEST_CAMERA_FAILED]', e?.message || String(e));
      setCameraOffGuestIds((prev) => {
        const next = new Set(prev);
        if (willTurnOff) next.delete(guestUserId); else next.add(guestUserId);
        return next;
      });
      Alert.alert('Couldn’t update camera', 'Please try again.');
    }
  };

  // ── Guest Control sheet (host-only) ────────────────────────────────────────
  // Tapping a guest tile opens one shared sheet to act on that guest: identity,
  // relationship, session stats, gift, mute/camera/report/disconnect.
  const [giftTotalsByUser, setGiftTotalsByUser] = useState({});
  const [sessionEngagementByUser, setSessionEngagementByUser] = useState({});
  const [guestControlVisible, setGuestControlVisible] = useState(false);
  const [selectedGuestControlId, setSelectedGuestControlId] = useState(null);
  const [guestReportTarget, setGuestReportTarget] = useState(null);
  const [guestJoinedAt, setGuestJoinedAt] = useState({});

  const publicLabelsByUser = useMemo(() => {
    const labels = {};
    const add = (person, personId) => {
      const id = toTrimmedString(personId || person?.userId || person?.uid);
      if (!id) return;
      const cached = userNameCacheRef.current.get(id);
      labels[id] = pickPublicLabel(
        { ...(person || {}), username: cached || person?.username },
        { uid: id, fallback: labels[id] || 'Supporter' },
      );
    };
    add(hostUserDoc, hostUid);
    (liveGuests || []).forEach((g) => add(g, g?.userId));
    (comments || []).forEach((c) => add(c, c?.userId));
    add(incomingGiftEvent?.sender, incomingGiftEvent?.sender?.userId);
    add(incomingGiftEvent?.receiver, incomingGiftEvent?.receiver?.userId);
    return labels;
  }, [comments, hostUid, hostUserDoc, incomingGiftEvent, liveGuests]);

  // Build the guest roster for the sheet (name/avatar from the mirrored roster).
  const guestControlList = useMemo(() => {
    const list = Array.isArray(liveGuests) ? liveGuests : [];
    return list
      .filter((g) => g && (g.userId || g.participantId) && g.userId !== uid)
      .map((g) => ({
        userId: g.userId,
        participantId: g.participantId,
        name: pickPublicLabel(g, { uid: g.userId || g.participantId, fallback: 'Guest' }),
        photoUrl: g.photoUrl || g.photoURL || null,
        slotIndex: g.slotIndex,
      }));
  }, [liveGuests, uid]);

  // Record when each guest first appears (for "time on stage").
  useEffect(() => {
    if (!guestControlList.length) return;
    setGuestJoinedAt((prev) => {
      let changed = false;
      const next = { ...prev };
      guestControlList.forEach((g) => {
        const id = g.userId || g.participantId;
        if (id && !next[id]) {
          next[id] = Date.now();
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [guestControlList]);

  const openGuestControl = (guest) => {
    const id = guest?.userId || guest?.participantId;
    if (!id) return;
    setSelectedGuestControlId(String(id));
    setGuestControlVisible(true);
  };

  // Refresh session engagement tallies while the guest control sheet is open.
  useEffect(() => {
    if (!guestControlVisible) return undefined;
    const sid = String(routeStreamId || streamId || '');
    if (!sid) return undefined;
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await getLiveEngagementSession(sid);
        if (!cancelled && res?.byUser) {
          setSessionEngagementByUser((prev) => {
            const next = { ...prev };
            Object.entries(res.byUser).forEach(([uidKey, eng]) => {
              const cur = next[uidKey] || { likes: 0, shares: 0, comments: 0, coinsSpent: 0, coinsReceived: 0 };
              next[uidKey] = {
                likes: Math.max(cur.likes || 0, eng.likes || 0),
                shares: Math.max(cur.shares || 0, eng.shares || 0),
                comments: Math.max(cur.comments || 0, eng.comments || 0),
                coinsSpent: Math.max(cur.coinsSpent || 0, eng.coinsSpent || 0),
                coinsReceived: Math.max(cur.coinsReceived || 0, eng.coinsReceived || 0),
              };
            });
            return next;
          });
        }
      } catch {
        // non-fatal
      }
    };
    pull();
    const t = setInterval(pull, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [guestControlVisible, routeStreamId, streamId]);

  const handleGuestGift = (guest) => {
    setGuestControlVisible(false);
    if (guest?.userId) openGift({ userId: String(guest.userId), name: guest.name || 'Guest' });
  };

  const handleGuestProfile = (guest) => {
    const id = guest?.userId;
    if (!id) return;
    setGuestControlVisible(false);
    try {
      navigation.navigate('UserProfile', { userId: String(id), username: guest.name || '@user' });
    } catch (e) {
      console.warn('[LIVE][OPEN_PROFILE_FAILED]', e?.message || String(e));
    }
  };

  const handleGuestReport = (guest) => {
    if (!guest?.userId) return;
    setGuestControlVisible(false);
    setGuestReportTarget({ userId: String(guest.userId), name: guest.name || 'this guest' });
  };

  const handleGuestKick = (guest) => {
    setGuestControlVisible(false);
    confirmKickGuest(guest);
  };

  const adoptBattleOnLive = useCallback(async (battleId, role = 'creator') => {
    if (!battleId) return;
    setLocalBattleId(String(battleId));
    try {
      navigation?.setParams?.({ battleId: String(battleId), battleRole: role });
    } catch { /* ignore */ }
    const sid = streamId || ivsHostSession?.sessionId || ivsHostSession?.streamId;
    if (sid) {
      mirrorActiveBattleId(sid, String(battleId));
    }
  }, [navigation, streamId, ivsHostSession?.sessionId, ivsHostSession?.streamId]);

  const exitBattleView = useCallback(async () => {
    const sid =
      routeStreamId ||
      streamId ||
      ivsHostSession?.sessionId ||
      ivsHostSession?.streamId;

    setShowArtillery(false);
    setGamesOpen(false);
    setSelectedLiveGame(null);
    setLocalBattleId(null);
    setMirroredBattleId(null);

    try {
      navigation?.setParams?.({
        battleId: undefined,
        battleRole: undefined,
        battleSessionId: undefined,
      });
    } catch {
      // The local state still guarantees an exit from battle chrome.
    }

    if (sid && routeBattleRole !== 'opponent') {
      await mirrorActiveBattleId(sid, null);
    }

    // Side B joined somebody else's arena; returning to Battle Detail also
    // tears down their publisher session. Side A remains in their normal live.
    if (routeBattleRole === 'opponent' && navigation?.canGoBack?.()) {
      navigation.goBack();
    }
  }, [
    navigation,
    routeBattleRole,
    routeStreamId,
    streamId,
    ivsHostSession?.sessionId,
    ivsHostSession?.streamId,
  ]);

  const handleGuestChallenge = useCallback((guest) => {
    if (!guest?.userId || !uid || challengeBusy) return;
    if (activeBattleId) {
      Alert.alert('Match already active', 'End the current match before challenging another guest.');
      return;
    }
    const guestName = guest.name || 'this guest';
    Alert.alert(
      'Start battle now?',
      `Battle ${guestName} immediately? This is a live challenge, not a pending request.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Start battle',
          onPress: async () => {
            setChallengeBusy(true);
            try {
              const hostName = resolvedHostName || 'Host';
              const res = await challengeGuestInLive(
                {
                  id: uid,
                  displayName: hostName,
                  username: hostName,
                  photoURL: '',
                },
                {
                  id: String(guest.userId),
                  displayName: guestName,
                  username: guest.name || '',
                  photoURL: guest.photoUrl || guest.photoURL || '',
                },
                {
                  liveStreamId:
                    streamId ||
                    ivsHostSession?.sessionId ||
                    ivsHostSession?.streamId ||
                    null,
                  durationSec: 300,
                }
              );
              if (!res.ok) {
                Alert.alert('Couldn’t start challenge', 'Please try again.');
                return;
              }
              setGuestControlVisible(false);
              await adoptBattleOnLive(res.id, 'creator');
            } catch (e) {
              console.warn('[LIVE][CHALLENGE_GUEST_FAILED]', e?.message || e);
              Alert.alert('Couldn’t start challenge', 'Please try again.');
            } finally {
              setChallengeBusy(false);
            }
          },
        },
      ]
    );
  }, [
    uid, challengeBusy, activeBattleId, streamId,
    ivsHostSession?.sessionId, ivsHostSession?.streamId, adoptBattleOnLive,
    resolvedHostName,
  ]);

  // Host moderation: remove a guest from the stage.
  const confirmKickGuest = (guest) => {
    if (!guest) return;
    const guestUserId = guest.userId || guest.participantId;
    const sid = ivsHostSession?.sessionId || ivsHostSession?.streamId || streamId;
    if (!guestUserId || !sid) {
      Alert.alert('Cannot remove', 'This guest can’t be removed right now.');
      return;
    }
    const label = guest.handle ? `@${String(guest.handle).replace(/^@/, '')}` : 'this guest';
    Alert.alert(
      'Remove guest',
      `Remove ${label} from your live?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await kickGuest(String(sid), String(guestUserId));
              try {
                reservedGuestsRef.current.delete(String(guestUserId));
              } catch { /* ignore */ }
              setLiveGuests((prev) => {
                const next = (Array.isArray(prev) ? prev : []).filter(
                  (g) => g && String(g.userId) !== String(guestUserId),
                );
                mirrorLiveGuests(String(sid), next);
                return next;
              });
            } catch (e) {
              console.warn('[LIVE][KICK_GUEST_FAILED]', e?.message || String(e));
              Alert.alert('Couldn’t remove guest', 'Please try again.');
            }
          },
        },
      ]
    );
  };

  // Host camera enable/disable (separate from flip).
  const toggleHostCamera = async () => {
    if (backend !== StreamingBackend.IVS) return;
    if (typeof ivsHostSession?.setCameraEnabled !== 'function') return;
    try {
      const next = !(ivsHostSession?.isCameraEnabled ?? true);
      await ivsHostSession.setCameraEnabled(next);
    } catch (e) {
      console.warn('[LIVE][CAMERA_TOGGLE_FAILED]', e?.message || String(e));
    }
  };

  const formatDuration = (milliseconds) => {
    if (!milliseconds) return '00:00';
    const seconds = Math.floor((milliseconds / 1000) % 60);
    const minutes = Math.floor((milliseconds / 1000 / 60) % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const scale = animatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.2, 1],
  });

  // Handle camera ready state
  const handleCameraReady = () => {
    console.log('[LIVE][CAMERA_READY] CameraView is ready');
    // Note: setCameraReady already managed by permission effect
  };

  if (cameraPermission === null || microphonePermission === null) {
    return <View style={styles.container} />;
  }

  // Viewer mode: Show actual live stream playback
  if (isViewer) {
    // Feature flag guard for viewer mode
    if (!isLiveStreamingEnabled()) {
      return (
        <View style={styles.container}>
          <StatusBar style="light" />
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Live streaming not available</Text>
            <Text style={styles.errorMessage}>
              Live streaming is currently disabled for this build.
            </Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={confirmExitLive}
            >
              <Text style={styles.retryText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const showAuthOverlay = !authReady || authLoading;

    return (
      <View style={styles.container}>
        <StatusBar style="light" />

        {/* Bottom-anchored live chat. Host stacks chat ABOVE the guest tray;
            mirror that here so the tray sits on the bottom bar — not mid-screen
            above a fixed 28% chat band (which looked like a half-page split). */}
        <LiveChatOverlay
          messages={mergedComments}
          bottomInset={(viewerCommentsOverlayHeight || 0) + (viewerGuestPagerHeight || 0) + 8}
          onLayoutHeight={setViewerLiveChatHeight}
          onPressUser={onPressCommenter}
        />

        {/* Actual video playback */}
        <LiveStreamViewer
          streamId={routeStreamId}
          hostUid={hostUid}
          guestRoster={liveGuests}
          guestLayoutMode={guestLayoutMode}
          giftTotalsByUser={giftTotalsByUser}
          battleMode={!!activeBattleId}
          style={styles.viewerVideo}
          overlayBottomInset={(viewerCommentsOverlayHeight || 0) + 8}
          onGuestPagerLayout={setViewerGuestPagerHeight}
          onError={(error) => {
            console.error('âŒ Viewer playback error:', error);
            const errorMsg = error?.message || 'Unable to load stream';
            let userMsg = 'This stream is not available right now.';

            // Map structured errors to user messages
            if (errorMsg.includes('ended') || errorMsg.includes('Stream has ended')) {
              userMsg = 'This stream has ended.';
            } else if (
              errorMsg.includes('not found') ||
              errorMsg.includes('does not exist') ||
              errorMsg.includes('not live') ||
              errorMsg.includes('session_not_found')
            ) {
              userMsg = 'This stream is no longer available. Pull to refresh the Live list.';
            } else if (errorMsg.includes('connection') || errorMsg.includes('network')) {
              userMsg = 'Connection error. Please check your internet and try again.';
            } else if (errorMsg.includes('COGNITO') || errorMsg.includes('401') || errorMsg.includes('Invalid token')) {
              userMsg = 'Sign in again, then retry joining the live.';
            }

            Alert.alert(
              'Stream Unavailable',
              userMsg,
              [{ text: 'OK', onPress: () => goToSummary() }]
            );
          }}
        />

        {/* Tap anywhere on the video to send a like (single tap, per product).
            CRITICAL: this catcher now eats single taps wherever it overlaps an
            interactive element, so it is bounded to the open video area only —
            it stops above the bottom region (comments + guest tray) and the
            header sits on top of it (rendered later, pointerEvents box-none), so
            header controls and tray tiles still receive their taps.
            The guest tray is anchored at the bottom and grows
            UPWARD (its "Join" tile is the top-left, i.e. highest, tile), so a
            fixed bottom inset let the catcher cover the Join button once the
            comments bar + tray pushed it above that line — making "Join" do
            nothing. Stop the catcher above the live bottom region (comments
            overlay + guest tray) so every tray tile stays tappable, with the
            original 180px reserved as a floor and a small safety buffer. */}
        <GestureHandlerRootView
          style={[
            styles.viewerDoubleTapCatcher,
            {
              bottom: Math.max(
                180,
                (viewerCommentsOverlayHeight || 0) + (viewerLiveChatHeight || 0) + (viewerGuestPagerHeight || 0) + 8
              ),
            },
          ]}
        >
          <TapGestureHandler numberOfTaps={1} onActivated={() => triggerReaction(null)}>
            <View style={StyleSheet.absoluteFill} collapsable={false} />
          </TapGestureHandler>
        </GestureHandlerRootView>

        {/* Unified TikTok/IG-class live header */}
        <LiveViewerHeader
          topInset={LIVE_TOP_INSET}
          hostName={normalizeHandle(resolvedHostName || 'Host')}
          hostPhotoUrl={resolvedHostPhotoUrl}
          viewCount={viewCount}
          heartCount={heartCount}
          onPressMore={openLiveSafetyMenu}
          onPressClose={goToSummary}
        />

        <ReportModal
          visible={liveReportVisible}
          onClose={() => setLiveReportVisible(false)}
          targetType="stream"
          targetId={routeStreamId || streamId}
          targetLabel="this live"
          reportedUserId={hostUid && hostUid !== uid ? hostUid : undefined}
        />

        <LiveReactionsHearts
          burst={reactionBurst}
          bottomOffset={(viewerCommentsOverlayHeight || 0) + (viewerGuestPagerHeight || 0) + 68}
          rightOffset={16}
        />

        <LinearGradient
          colors={['transparent', 'rgba(10,10,12,0.28)', 'rgba(10,10,12,0.82)']}
          locations={[0, 0.4, 1]}
          pointerEvents="none"
          style={[
            styles.viewerBottomVignette,
            { height: Math.max(180, (viewerCommentsOverlayHeight || 0) + (viewerGuestPagerHeight || 0) + 96) },
          ]}
        />

        {/* Sits ABOVE the guest tray (not just the comment bar) so the emoji
            rail never overlaps the bottom row of guest tiles. */}
        <LiveReactionTray
          style={[
            styles.viewerReactionTray,
            { bottom: (viewerCommentsOverlayHeight || 0) + (viewerGuestPagerHeight || 0) + 14 },
          ]}
          onReact={(emoji) => triggerReaction(emoji)}
        />

        {showAuthOverlay && (
          <View style={styles.viewerAuthOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={[styles.errorMessage, { marginTop: 12 }]}>Preparing stream...</Text>
          </View>
        )}

        {/* Viewer bottom bar overlay */}
        <View
          style={styles.commentsContainer}
          pointerEvents="box-none"
          onLayout={(e) => setViewerCommentsOverlayHeight(e?.nativeEvent?.layout?.height || 0)}
        >
          <LiveBottomBar
            onPressComment={() => setCommentsModalVisible(true)}
            onPressLike={sendHeart}
            onPressShare={shareLive}
            onPressGift={promptGiftRecipient}
            onPressGames={openLiveGames}
            showGames={liveGamesAvailable}
            gamesActive={!!(gameOpen || showArtillery)}
            likeCount={heartCount}
            likeScale={scale}
          />
        </View>

        <CommentsModal
          visible={commentsModalVisible}
          onClose={() => setCommentsModalVisible(false)}
          mode="live"
          title="Live Chat"
          comments={comments}
          onSendComment={(text) => sendComment(text)}
        />

        <LiveGiftOverlay giftEvent={incomingGiftEvent} />

        <GiftSystem
          hideTrigger
          openSignal={giftOpenSignal}
          postId={routeStreamId || streamId}
          creatorId={giftRecipient?.userId || hostUid}
          creatorName={giftRecipient?.name || resolvedHostName || 'Host'}
          navigation={navigation}
          incomingGiftEvent={incomingGiftEvent}
          battleId={giftRecipient?.battleSide ? activeBattleId : undefined}
          battleSide={giftRecipient?.battleSide}
        />

        {activeBattleId ? (
          <BattleOverlay
            battleId={activeBattleId}
            currentUid={uid}
            liveStreamId={routeStreamId || streamId || null}
            onExit={exitBattleView}
            onRematchStarted={({ battleId: nextId }) => adoptBattleOnLive(nextId, 'opponent')}
          />
        ) : null}
        {renderArtilleryLayer()}
        {renderMarbleLayer()}
        {renderFrenemiesLayer()}
        {renderReactionDuelLayer()}
        {renderLiveGamesPicker()}
      </View>
    );
  }

  // Host mode: Show broadcaster UI with camera permissions check
  if (cameraPermission.status !== 'granted' || microphonePermission.status !== 'granted') {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>
          Camera and microphone access is required for live streaming.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={() => {
            requestCameraPermission();
            requestMicrophonePermission();
          }}
        >
          <Text style={styles.permissionButtonText}>Grant Permissions</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Host mode: Main broadcaster UI
  const RootContainer = Platform.OS === 'ios' ? KeyboardAvoidingView : View;
  return (
    <BlueScreen>
      <RootContainer
        style={styles.keyboardAvoidingContainer}
        {...(Platform.OS === 'ios' ? { behavior: 'padding' } : null)}
      >
        <StatusBar style="light" />

        {/* VIEWER MODE: Show viewer UI instead of camera */}
        {isViewer ? (
          <View style={{ flex: 1 }}>
            <LiveStreamViewer
              streamId={routeStreamId}
              hostUid={hostUid}
              guestRoster={liveGuests}
              guestLayoutMode={guestLayoutMode}
              giftTotalsByUser={giftTotalsByUser}
              battleMode={!!activeBattleId}
            />
          </View>
        ) : (
          /* HOST MODE: Show camera and streaming UI */
          <View style={styles.cameraContainer}>
            {/* Bottom-anchored live chat (newest at bottom, scrolls upward). Sits
                ABOVE the guest tray + bottom bar so it never overlaps faces/tiles. */}
            <LiveChatOverlay
              messages={mergedComments}
              bottomInset={(hostCommentsOverlayHeight || 0) + (hostGuestTrayHeight || 0) + 16}
              onPressUser={onPressCommenter}
            />

            {/* Host guest request overlay (themed) */}
            <Modal
              visible={!!activeGuestRequest?.userId}
              transparent
              animationType="fade"
              onRequestClose={closeGuestRequestOverlay}
            >
              <View style={styles.guestRequestBackdrop}>
                <View style={styles.guestRequestCard}>
                  <Text style={styles.guestRequestTitle} allowFontScaling={false}>Guest request</Text>
                  <LinearGradient
                    colors={[COLORS.gradientStart, COLORS.gradientMiddle, COLORS.gradientEnd]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.guestRequestIdentityPill}
                  >
                    <Text style={styles.guestRequestIdentityText} numberOfLines={1} allowFontScaling={false}>
                      {activeGuestRequestProfile.username
                        ? normalizeHandle(activeGuestRequestProfile.username)
                        : 'New guest'}
                    </Text>
                    {activeGuestRequestProfile.photoUrl ? (
                      <Image source={{ uri: activeGuestRequestProfile.photoUrl }} style={styles.guestRequestAvatar} />
                    ) : (
                      <View style={styles.guestRequestAvatarPlaceholder} />
                    )}
                  </LinearGradient>

                  <Text style={styles.guestRequestSubtitle} allowFontScaling={false}>
                    wants to join your live.
                  </Text>

                  <View style={styles.guestRequestActions}>
                    <TouchableOpacity
                      style={[styles.guestRequestButton, styles.guestRequestRejectButton]}
                      onPress={rejectActiveGuestRequest}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.guestRequestButtonText} allowFontScaling={false}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.guestRequestAcceptButtonHit}
                      onPress={acceptActiveGuestRequest}
                      activeOpacity={0.92}
                    >
                      <LinearGradient
                        colors={[COLORS.gradientStart, COLORS.gradientMiddle, COLORS.gradientEnd]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.guestRequestAcceptButton}
                      >
                        <Text style={styles.guestRequestButtonText} allowFontScaling={false}>Accept</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>

            {backend === StreamingBackend.IVS ? (
              <View
                style={[
                  styles.ivsHostStage,
                  activeBattleId ? styles.ivsBattleStage : null,
                  activeBattleId && battleLocalSide === 'B' ? styles.ivsBattleStageReverse : null,
                  !activeBattleId && guestLayoutMode === LIVE_LAYOUT_MODES.SIDE_BY_SIDE
                    ? styles.ivsComposeSide
                    : null,
                  !activeBattleId && guestLayoutMode === LIVE_LAYOUT_MODES.EQUAL_GRID
                    ? styles.ivsComposeEqual
                    : null,
                ]}
              >
                <View
                  style={
                    activeBattleId
                      ? styles.ivsBattlePane
                      : guestLayoutMode === LIVE_LAYOUT_MODES.SIDE_BY_SIDE
                        ? styles.ivsComposeHostPaneSide
                        : guestLayoutMode === LIVE_LAYOUT_MODES.EQUAL_GRID
                          ? styles.ivsComposeHostPaneEqual
                          : StyleSheet.absoluteFill
                  }
                >
                  {activeBattleId ? (
                    <View
                      pointerEvents="none"
                      style={battleLocalSide === 'B' ? styles.ivsBattleEdgeRight : styles.ivsBattleEdgeLeft}
                    />
                  ) : null}
                  {isStreaming && NativeIVSBroadcastView ? (
                    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
                      <PinchGestureHandler
                        ref={pinchRef}
                        simultaneousHandlers={[doubleTapRef, singleTapRef]}
                        onGestureEvent={onHostPinchEvent}
                        onHandlerStateChange={onHostPinchStateChange}
                      >
                        <View collapsable={false} style={StyleSheet.absoluteFill}>
                          <TapGestureHandler
                            ref={doubleTapRef}
                            numberOfTaps={2}
                            simultaneousHandlers={pinchRef}
                            onActivated={flipCamera}
                          >
                            <View collapsable={false} style={StyleSheet.absoluteFill}>
                              <TapGestureHandler
                                ref={singleTapRef}
                                numberOfTaps={1}
                                waitFor={doubleTapRef}
                                simultaneousHandlers={pinchRef}
                                onActivated={() => triggerReaction(null)}
                              >
                                <View collapsable={false} style={StyleSheet.absoluteFill}>
                                  <NativeIVSBroadcastView
                                    key={`host-preview-${hostPreviewEpoch}`}
                                    style={StyleSheet.absoluteFill}
                                    zoom={hostZoom}
                                  />
                                  {!(ivsHostSession?.isCameraEnabled ?? true) ? (
                                    <View style={styles.hostCameraOffOverlay} pointerEvents="none">
                                      {resolvedHostPhotoUrl ? (
                                        <Image source={{ uri: resolvedHostPhotoUrl }} style={styles.hostCameraOffAvatar} />
                                      ) : (
                                        <Icon name="videocam-off" size={42} color="rgba(255,255,255,0.85)" />
                                      )}
                                      <Text style={styles.hostCameraOffText} allowFontScaling={false}>Camera off</Text>
                                    </View>
                                  ) : null}
                                </View>
                              </TapGestureHandler>
                            </View>
                          </TapGestureHandler>
                        </View>
                      </PinchGestureHandler>
                    </GestureHandlerRootView>
                  ) : preLivePreview && cameraReady ? (
                    <CameraView
                      style={StyleSheet.absoluteFill}
                      facing={facing}
                      mode="video"
                      mirror={facing === 'front'}
                      onCameraReady={() => {
                        console.log('[CAMERA] pre-live CameraView ready');
                      }}
                    />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.background }]} />
                  )}
                </View>

                {activeBattleId ? (
                  <View style={styles.ivsBattlePane}>
                    <View
                      pointerEvents="none"
                      style={battleLocalSide === 'B' ? styles.ivsBattleEdgeLeft : styles.ivsBattleEdgeRight}
                    />
                    {isStreaming && battleOpponentParticipant && NativeIVSRealTimeView ? (
                      <NativeIVSRealTimeView
                        style={StyleSheet.absoluteFill}
                        sessionId={ivsHostSession.sessionId || ivsHostSession.streamId || streamId}
                        slotId={typeof battleOpponentParticipant.slotIndex === 'number' ? battleOpponentParticipant.slotIndex : 1}
                        participantId={battleOpponentParticipant.participantId}
                        remoteTrackCount={(ivsHostSession.participants || []).length}
                        zoom={16 / 9}
                        testID="ivs-host-battle-opponent"
                      />
                    ) : (
                      <View style={styles.ivsBattleWaiting}>
                        <Icon name="person-add-outline" size={28} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.ivsBattleWaitingText} allowFontScaling={false}>
                          Waiting for opponent
                        </Text>
                      </View>
                    )}
                  </View>
                ) : !activeBattleId &&
                  isStreaming &&
                  (guestLayoutMode === LIVE_LAYOUT_MODES.EQUAL_GRID ||
                    guestLayoutMode === LIVE_LAYOUT_MODES.SIDE_BY_SIDE) ? (
                  <View
                    style={
                      guestLayoutMode === LIVE_LAYOUT_MODES.SIDE_BY_SIDE
                        ? styles.ivsComposeGuestPaneSide
                        : styles.ivsComposeGuestPaneEqual
                    }
                  >
                    <ScrollView
                      style={styles.ivsComposeGuestScroll}
                      contentContainerStyle={
                        guestLayoutMode === LIVE_LAYOUT_MODES.SIDE_BY_SIDE
                          ? styles.ivsComposeGuestCol
                          : styles.ivsComposeGuestGrid
                      }
                      showsVerticalScrollIndicator={false}
                    >
                      {(() => {
                        const GUEST_TILE_ZOOM = 16 / 9;
                        const guestBySlot = new Map();
                        (ivsHostSession.participants || []).forEach((p) => {
                          if (p?.isLocal) return;
                          if (p?.role === 'host') return;
                          if (typeof p?.slotIndex === 'number' && p.slotIndex === 0) return;
                          if (typeof p?.slotIndex === 'number' && p.slotIndex >= 1 && p.slotIndex <= MAX_GUEST_SLOTS) {
                            if (!guestBySlot.has(p.slotIndex) || guestBySlot.get(p.slotIndex)?.isLocal) {
                              guestBySlot.set(p.slotIndex, p);
                            }
                          }
                        });
                        return Array.from({ length: MAX_GUEST_SLOTS }, (_, i) => {
                          const slotId = i + 1;
                          const p = guestBySlot.get(slotId) || null;
                          const rosterGuest = (liveGuests || []).find(
                            (g) => g && (
                              (typeof g.slotIndex === 'number' && g.slotIndex === slotId) ||
                              (p?.userId && String(g.userId) === String(p.userId))
                            )
                          ) || null;
                          const guestPhoto = rosterGuest?.photoUrl || rosterGuest?.photoURL || null;
                          const guestUserId = rosterGuest?.userId || p?.userId || null;
                          const hostForcedCamOff = !!(guestUserId && cameraOffGuestIds?.has?.(String(guestUserId)));
                          const remoteCamOff = !!(p?.isCameraDisabled || hostForcedCamOff);
                          return (
                            <View
                              key={`host-compose-slot-${slotId}`}
                              style={
                                guestLayoutMode === LIVE_LAYOUT_MODES.SIDE_BY_SIDE
                                  ? styles.ivsComposeTileSide
                                  : styles.ivsComposeTileEqual
                              }
                            >
                              {p && NativeIVSRealTimeView && !remoteCamOff ? (
                                <NativeIVSRealTimeView
                                  style={styles.ivsTileVideo}
                                  sessionId={ivsHostSession.sessionId || ivsHostSession.streamId || streamId}
                                  slotId={slotId}
                                  participantId={p.participantId}
                                  remoteTrackCount={(ivsHostSession.participants || []).length}
                                  zoom={GUEST_TILE_ZOOM}
                                  testID={`ivs-host-compose-guest-${slotId}`}
                                />
                              ) : p && remoteCamOff ? (
                                <View style={[styles.ivsTileVideo, styles.hostGuestCamOffFill]}>
                                  {guestPhoto ? (
                                    <Image source={{ uri: guestPhoto }} style={styles.hostGuestCamOffAvatar} />
                                  ) : (
                                    <Icon name="person" size={28} color="rgba(255,255,255,0.85)" />
                                  )}
                                </View>
                              ) : rosterGuest ? (
                                <ReservedGuestTile photoUrl={guestPhoto} label="Joining…" />
                              ) : (
                                <View style={styles.ivsEmptyTile}>
                                  <View style={styles.ivsEmptyTileInner} />
                                </View>
                              )}
                              <View pointerEvents="none" style={styles.ivsSlotNumberBadge}>
                                <Text style={styles.ivsSlotNumberText}>{slotId}</Text>
                              </View>
                              {p && !p.isLocal ? (
                                <TouchableOpacity
                                  style={StyleSheet.absoluteFill}
                                  activeOpacity={0.85}
                                  onPress={() => openGuestControl(p)}
                                />
                              ) : null}
                            </View>
                          );
                        });
                      })()}
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            ) : cameraReady ? (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing={facing}
                // Must be in video mode for recordAsync to resolve
                mode="video"
                onCameraReady={() => {
                  console.log('[CAMERA] âœ… CameraView onCameraReady fired - camera stream ACTIVE');
                  handleCameraReady();
                }}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: '#fff', fontSize: 16 }}>
                  {cameraPermission?.granted && microphonePermission?.granted
                    ? 'Loading camera...'
                    : 'Waiting for permissions...'}
                </Text>
              </View>
            )}

            {/* Host identity (top-left, over video) — hidden in battles (MatchBar owns names). */}
            {!activeBattleId && !isStreaming ? (
              <View
                style={[
                  styles.hostIdentityOverlay,
                  { top: LIVE_TOP_INSET },
                ]}
                pointerEvents="none"
              >
                <LinearGradient
                  colors={[COLORS.gradientStart, COLORS.gradientMiddle, COLORS.gradientEnd]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.hostIdentityPill}
                >
                  <Text style={styles.hostIdentityText} numberOfLines={1} allowFontScaling={false}>
                    {normalizeHandle(resolvedHostName || 'Host')}
                  </Text>
                  {resolvedHostPhotoUrl ? (
                    <Image source={{ uri: resolvedHostPhotoUrl }} style={styles.hostIdentityAvatar} />
                  ) : (
                    <View style={styles.hostIdentityAvatarPlaceholder} />
                  )}
                </LinearGradient>
              </View>
            ) : null}

            {/* Host guest boxes (IVS only) — battles use side-by-side stage instead.
                Equal / Split modes render sticky slots in the stage composition. */}
            {backend === StreamingBackend.IVS && isStreaming && !activeBattleId && layoutUsesBottomTray(guestLayoutMode) && (
              <View
                style={[
                  styles.ivsGuestTray,
                  { bottom: hostCommentsOverlayHeight || 0 },
                  hostGuestTrayMode === 'hidden'
                    ? { height: HOST_GUEST_TRAY_HIDDEN_TAB_HEIGHT, paddingBottom: 0 }
                    : null,
                  guestLayoutMode === LIVE_LAYOUT_MODES.HOST_FOCUS
                    ? styles.ivsGuestTrayFocus
                    : null,
                ]}
                {...hostGuestTrayPanResponder.panHandlers}
                onLayout={(e) => {
                  if (hostGuestTrayMode === 'hidden') {
                    setHostGuestTrayHeight(HOST_GUEST_TRAY_HIDDEN_TAB_HEIGHT);
                    return;
                  }
                  setHostGuestTrayHeight(e?.nativeEvent?.layout?.height || 0);
                }}
              >
                {hostGuestTrayMode === 'hidden' ? (
                  <View style={styles.ivsHiddenTrayHandle} pointerEvents="none">
                    <View style={styles.ivsHiddenTrayPill} />
                    <Text style={styles.ivsHiddenTrayText}>Swipe up to invite guests</Text>
                  </View>
                ) : (
                  <ScrollView
                    ref={hostGuestPagerScrollRef}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.ivsGuestPagerContent}
                  >
                    {(() => {
                      // Center-crop guest tiles so video fills the box without stretching.
                      const GUEST_TILE_ZOOM = 16 / 9;
                      // Guest slots are capped at the IVS publisher limit (host + 11 guests).
                      const guestSlotsTotal = MAX_GUEST_SLOTS;
                      const trayDensity =
                        guestLayoutMode === LIVE_LAYOUT_MODES.HOST_FOCUS
                          ? 'collapsed'
                          : hostGuestTrayMode === 'expanded'
                            ? 'expanded'
                            : 'collapsed';
                      const guestsPerPage = guestsPerTrayPage(guestLayoutMode, trayDensity);
                      const guestBySlot = new Map();
                      (ivsHostSession.participants || []).forEach((p) => {
                        // The host (local participant) should never consume a guest slot.
                        // If the SDK reports a local participant with a slotIndex, ignore it so the
                        // Invite tile stays visible unless a *guest* is actually in that box.
                        if (p?.isLocal) return;
                        if (p?.role === 'host') return;
                        if (typeof p?.slotIndex === 'number' && p.slotIndex === 0) return;
                        if (typeof p?.slotIndex === 'number' && p.slotIndex >= 1 && p.slotIndex <= guestSlotsTotal) {
                          // Prefer remote guests when duplicates appear
                          if (!guestBySlot.has(p.slotIndex) || guestBySlot.get(p.slotIndex)?.isLocal) {
                            guestBySlot.set(p.slotIndex, p);
                          }
                        }
                      });

                      const reservedSlots = new Set();
                      (liveGuests || []).forEach((g) => {
                        if (g && typeof g.slotIndex === 'number' && g.slotIndex >= 1) {
                          reservedSlots.add(g.slotIndex);
                        }
                      });

                      const firstInviteSlotId = (() => {
                        for (let i = 1; i <= guestSlotsTotal; i += 1) {
                          if (guestBySlot.has(i)) continue;
                          if (reservedSlots.has(i)) continue;
                          return i;
                        }
                        return null;
                      })();

                      const visibleGuestSlotIds = buildVisibleGuestSlotIds({
                        totalSlots: guestSlotsTotal,
                        occupiedSlots: guestBySlot.keys(),
                        reservedSlots,
                        joinSlotId: firstInviteSlotId,
                      });
                      if (firstInviteSlotId == null && visibleGuestSlotIds.length === 0) {
                        visibleGuestSlotIds.push(1);
                      }
                      const pageCount = Math.max(1, Math.ceil(Math.max(1, visibleGuestSlotIds.length) / guestsPerPage));
                      if (hostPrevVisibleGuestCountRef.current !== visibleGuestSlotIds.length) {
                        LayoutAnimation.configureNext(GUEST_TRAY_LAYOUT_ANIM);
                        hostPrevVisibleGuestCountRef.current = visibleGuestSlotIds.length;
                      }

                      return Array.from({ length: pageCount }, (_, pageIdx) => {
                        const slotsOnPage = visibleGuestSlotIds.slice(
                          pageIdx * guestsPerPage,
                          pageIdx * guestsPerPage + guestsPerPage
                        );
                        const pageSlots =
                          slotsOnPage.length > 0
                            ? slotsOnPage
                            : pageIdx === 0 && firstInviteSlotId
                              ? [firstInviteSlotId]
                              : pageIdx === 0
                                ? [1]
                                : [];
                        const pageVisibleCount = Math.max(1, pageSlots.length);
                        const tileWidthPct = guestTileWidthPercent(pageVisibleCount);
                        const tileMarginPct = guestTileHorizontalMarginPercent(pageVisibleCount);
                        const tileBaseStyle = {
                          width: `${tileWidthPct}%`,
                          marginHorizontal: `${tileMarginPct}%`,
                        };
                        return (
                          <View key={`host-guest-page-${pageIdx}`} style={styles.ivsGuestPage}>
                            <View style={hostGuestTrayMode === 'collapsed' ? styles.ivsGuestGridCollapsed : styles.ivsGuestGrid}>
                              {pageSlots.map((slotId) => {
                                const p = guestBySlot.get(slotId) || null;
                                const rosterGuest = (liveGuests || []).find(
                                  (g) => g && (
                                    (typeof g.slotIndex === 'number' && g.slotIndex === slotId) ||
                                    (p?.userId && String(g.userId) === String(p.userId))
                                  )
                                ) || null;
                                const guestUserId = rosterGuest?.userId || p?.userId || null;
                                const guestPhoto = rosterGuest?.photoUrl || rosterGuest?.photoURL || null;
                                const hostForcedCamOff = !!(guestUserId && cameraOffGuestIds?.has?.(String(guestUserId)));
                                const remoteCamOff = !!(p?.isCameraDisabled || hostForcedCamOff);
                                return (
                                  <View
                                    key={p?.participantId || `host-guest-slot-${slotId}`}
                                    style={[
                                      hostGuestTrayMode === 'collapsed' ? styles.ivsGuestTileCollapsed : styles.ivsGuestTile,
                                      tileBaseStyle,
                                    ]}
                                  >
                                    {p && NativeIVSRealTimeView && !remoteCamOff ? (
                                      <NativeIVSRealTimeView
                                        style={styles.ivsTileVideo}
                                        sessionId={ivsHostSession.sessionId || ivsHostSession.streamId || streamId}
                                        slotId={slotId}
                                        participantId={p.participantId}
                                        remoteTrackCount={(ivsHostSession.participants || []).length}
                                        zoom={GUEST_TILE_ZOOM}
                                        testID={`ivs-host-guest-${slotId}`}
                                      />
                                    ) : p && remoteCamOff ? (
                                      <View style={[styles.ivsTileVideo, styles.hostGuestCamOffFill]}>
                                        {guestPhoto ? (
                                          <Image source={{ uri: guestPhoto }} style={styles.hostGuestCamOffAvatar} />
                                        ) : (
                                          <Icon name="person" size={28} color="rgba(255,255,255,0.85)" />
                                        )}
                                      </View>
                                    ) : rosterGuest ? (
                                      <ReservedGuestTile photoUrl={guestPhoto} label="Joining…" />
                                    ) : slotId === firstInviteSlotId ? (
                                      <TouchableOpacity
                                        style={styles.ivsInviteTile}
                                        activeOpacity={0.85}
                                        onPress={() => setInviteGuestsOpen(true)}
                                        accessibilityLabel="Invite guests from followers"
                                      >
                                        <View style={styles.ivsInvitePlusCircle}>
                                          <Text style={styles.ivsInvitePlusText}>+</Text>
                                        </View>
                                        <Text style={styles.ivsInviteLabelText}>Invite</Text>
                                      </TouchableOpacity>
                                    ) : (
                                      <View style={styles.ivsEmptyTile}>
                                        <View style={styles.ivsEmptyTileInner} />
                                      </View>
                                    )}

                                    {slotId >= 1 && (
                                      <View pointerEvents="none" style={styles.ivsSlotNumberBadge}>
                                        <Text style={styles.ivsSlotNumberText}>{slotId}</Text>
                                      </View>
                                    )}

                                    {/* Tiles are button-free: tapping a guest opens the
                                        shared Guest Control sheet to manage them. */}
                                    {p && !p.isLocal ? (
                                      <TouchableOpacity
                                        style={StyleSheet.absoluteFill}
                                        activeOpacity={0.85}
                                        onPress={() => openGuestControl(p)}
                                      />
                                    ) : null}
                                  </View>
                                );
                              })}
                            </View>
                          </View>
                        );
                      });
                    })()}
                  </ScrollView>
                )}
              </View>
            )}

            {(showCountdown || startingLive) && (
              <View style={styles.startingOverlay} pointerEvents="none">
                {showCountdown ? (
                  <Text style={styles.countdownText}>{countdownValue > 0 ? countdownValue : ''}</Text>
                ) : (
                  <View style={styles.startingInner}>
                    <ActivityIndicator size="large" color="#00D2BE" />
                    <Text style={styles.startingText} allowFontScaling={false}>
                      Going live…
                    </Text>
                  </View>
                )}
              </View>
            )}

            {!isStreaming && !showCountdown && !startingLive ? (
              <View style={styles.preLiveContainer}>
                <LinearGradient
                  colors={['rgba(10,10,12,0.15)', 'rgba(10,10,12,0.35)', 'rgba(10,10,12,0.88)']}
                  locations={[0, 0.45, 1]}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                <TouchableOpacity
                  style={styles.preLiveClose}
                  onPress={confirmExitLive}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon name="close" size={24} color="#fff" />
                </TouchableOpacity>

                <View style={styles.preLiveHero}>
                  <Text style={styles.preLiveTitle} allowFontScaling={false}>Go live</Text>
                  <Text style={styles.preLiveSubtitle} allowFontScaling={false}>
                    Add a title so people know what your Blyp is about, then start broadcasting.
                  </Text>
                </View>

                <View style={styles.preLiveBottom}>
                  <TextInput
                    style={styles.titleInput}
                    value={title}
                    onChangeText={setTitle}
                    placeholder="What's your Blyp about?"
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    returnKeyType="done"
                    maxLength={100}
                    onSubmitEditing={() => Keyboard.dismiss()}
                  />

                  <TouchableOpacity
                    style={styles.preLiveDeskBtn}
                    onPress={() => setStageDeskOpen(true)}
                    activeOpacity={0.85}
                    accessibilityLabel={`Open ${STAGE_DESK_NAME}`}
                  >
                    <Icon name="options" size={18} color="#00D2BE" />
                    <Text style={styles.preLiveDeskBtnText} allowFontScaling={false}>
                      {STAGE_DESK_NAME}
                    </Text>
                    <Text style={styles.preLiveDeskHint} allowFontScaling={false}>
                      Customize alerts, goals, layout
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.goLiveButton}
                    onPress={() => {
                      if (goLiveStartedRef.current) {
                        console.log('[LIVE][GO_LIVE_BUTTON] start already triggered, skipping');
                        return;
                      }
                      if (LIVE_UI_PREVIEW) {
                        // Render the live overlay without IVS (emulator UI work).
                        setStreamStartTime(Date.now());
                        setIsStreaming(true);
                        return;
                      }
                      // Button press only triggers countdown; actual start happens after countdown completes
                      startStreaming();
                    }}
                    disabled={!title.trim()}
                    activeOpacity={0.85}
                  >
                    {title.trim() ? (
                      <LinearGradient
                        colors={[COLORS.gradientStart, COLORS.gradientMiddle, COLORS.gradientEnd]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.goLiveButtonInner}
                      >
                        <Text style={styles.goLiveButtonText}>Go Live</Text>
                      </LinearGradient>
                    ) : (
                      <View style={[styles.goLiveButtonInner, styles.disabledButton]}>
                        <Text style={styles.goLiveButtonTextDisabled}>Go Live</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                {/* Unified compact live header (host) */}
                <View
                  style={[styles.liveHeader, { top: LIVE_TOP_INSET }]}
                  pointerEvents="box-none"
                >
                  <View style={styles.liveHeaderIdentity}>
                    {resolvedHostPhotoUrl ? (
                      <Image source={{ uri: resolvedHostPhotoUrl }} style={styles.liveHeaderAvatar} />
                    ) : (
                      <View style={styles.liveHeaderAvatarPlaceholder} />
                    )}
                    <Text style={styles.liveHeaderName} numberOfLines={1} allowFontScaling={false}>
                      {normalizeHandle(resolvedHostName || 'Host')}
                    </Text>
                    <View style={styles.liveHeaderLivePill}>
                      <View style={styles.liveHeaderLiveDot} />
                      <Text style={styles.liveHeaderLiveText} allowFontScaling={false}>LIVE</Text>
                    </View>
                  </View>

                  <View style={styles.liveHeaderSpacer} />

                  <View style={styles.liveHeaderStatCluster}>
                    <View style={styles.liveHeaderStat}>
                      <Icon name="eye" size={15} color="#fff" />
                      <Text style={styles.liveHeaderStatText} allowFontScaling={false}>{viewCount}</Text>
                    </View>
                    <View style={styles.liveHeaderStat}>
                      <Icon name="heart" size={15} color="#FB7185" />
                      <Text style={styles.liveHeaderStatText} allowFontScaling={false}>{heartCount}</Text>
                    </View>
                  </View>
                </View>

                {isStreaming ? (
                  <StageDeskChrome
                    layout={stageDeskLayout}
                    isPro={stageDeskPro}
                    viewCount={viewCount}
                    heartCount={heartCount}
                    giftTotalsByUser={giftTotalsByUser}
                    publicLabelsByUser={publicLabelsByUser}
                    topInset={LIVE_TOP_INSET + 52}
                  />
                ) : null}

                <LiveReactionsHearts
                  burst={reactionBurst}
                  bottomOffset={(hostCommentsOverlayHeight || 0) + 18}
                  rightOffset={18}
                />

                {/* Host control row + layout switcher (unified bottom controls) */}
                <View
                  style={styles.commentsContainer}
                  pointerEvents="box-none"
                  onLayout={(e) => setHostCommentsOverlayHeight(e?.nativeEvent?.layout?.height || 0)}
                >
                  {showLayoutSwitcher ? (
                    <View style={styles.layoutSwitcher}>
                      {LIVE_LAYOUT_OPTIONS.map((opt) => {
                        const active = guestLayoutMode === opt.id;
                        return (
                          <TouchableOpacity
                            key={opt.id}
                            style={[styles.layoutOption, active && styles.layoutOptionActive]}
                            onPress={() => {
                              setGuestLayoutMode(opt.id);
                              if (opt.id === LIVE_LAYOUT_MODES.HOST_FOCUS) {
                                setHostGuestTrayMode('collapsed');
                              } else if (opt.id === LIVE_LAYOUT_MODES.BOTTOM_GRID) {
                                setHostGuestTrayMode((prev) => (prev === 'hidden' ? 'collapsed' : prev));
                              } else {
                                // Equal / Split use the stage composition, not the bottom tray.
                                setHostGuestTrayMode('hidden');
                              }
                              setShowLayoutSwitcher(false);
                            }}
                          >
                            <Icon name={opt.icon} size={22} color={active ? '#00D2BE' : '#fff'} />
                            <Text
                              style={[styles.layoutOptionLabel, active && styles.layoutOptionLabelActive]}
                              allowFontScaling={false}
                            >
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}

                  <View style={styles.hostControlRow}>
                    <TouchableOpacity style={styles.hostControl} onPress={toggleMic} activeOpacity={0.85}>
                      <View style={styles.hostControlCircle}>
                        <Icon
                          name={(ivsHostSession?.isMicEnabled ?? true) ? 'mic' : 'mic-off'}
                          size={22}
                          color="#fff"
                        />
                      </View>
                      <Text style={styles.hostControlLabel} allowFontScaling={false}>Mic</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.hostControl} onPress={flipCamera} activeOpacity={0.85}>
                      <View style={styles.hostControlCircle}>
                        <Icon name="camera-reverse" size={22} color="#fff" />
                      </View>
                      <Text style={styles.hostControlLabel} allowFontScaling={false}>Flip</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.hostControl} onPress={toggleHostCamera} activeOpacity={0.85}>
                      <View style={styles.hostControlCircle}>
                        <Icon
                          name={(ivsHostSession?.isCameraEnabled ?? true) ? 'videocam' : 'videocam-off'}
                          size={22}
                          color="#fff"
                        />
                      </View>
                      <Text style={styles.hostControlLabel} allowFontScaling={false}>Camera</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.hostControl} onPress={() => setCommentsModalVisible(true)} activeOpacity={0.85}>
                      <View style={styles.hostControlCircle}>
                        <Icon name="chatbubble" size={20} color="#fff" />
                      </View>
                      <Text style={styles.hostControlLabel} allowFontScaling={false}>Chat</Text>
                    </TouchableOpacity>

                    {liveGamesAvailable ? (
                      <TouchableOpacity
                        style={styles.hostControl}
                        onPress={openLiveGames}
                        activeOpacity={0.85}
                        accessibilityLabel="Open live games"
                      >
                        <View style={[styles.hostControlCircle, (gamesOpen || showArtillery) && styles.hostControlCircleActive]}>
                          <Icon
                            name="game-controller"
                            size={20}
                            color={(gamesOpen || showArtillery) ? '#00D2BE' : '#FDE68A'}
                          />
                        </View>
                        <Text style={styles.hostControlLabel} allowFontScaling={false}>Games</Text>
                      </TouchableOpacity>
                    ) : null}

                    <TouchableOpacity
                      style={styles.hostControl}
                      onPress={() => setStageDeskOpen(true)}
                      activeOpacity={0.85}
                      accessibilityLabel={`Open ${STAGE_DESK_NAME}`}
                    >
                      <View style={[styles.hostControlCircle, stageDeskOpen && styles.hostControlCircleActive]}>
                        <Icon name="options" size={20} color={stageDeskOpen ? '#00D2BE' : '#00D2BE'} />
                      </View>
                      <Text style={styles.hostControlLabel} allowFontScaling={false}>Desk</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.hostControl} onPress={confirmExitLive} activeOpacity={0.85}>
                      <View style={[styles.hostControlCircle, styles.hostControlCircleDanger]}>
                        <Icon name="close" size={24} color="#fff" />
                      </View>
                      <Text style={styles.hostControlLabel} allowFontScaling={false}>End</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <CommentsModal
                  visible={commentsModalVisible}
                  onClose={() => setCommentsModalVisible(false)}
                  mode="live"
                  title="Live Chat"
                  comments={comments}
                  onSendComment={(text) => sendComment(text)}
                />

                <LiveGiftOverlay giftEvent={incomingGiftEvent} />

                <GiftSystem
                  hideTrigger
                  openSignal={giftOpenSignal}
                  postId={routeStreamId || streamId}
                  creatorId={giftRecipient?.userId || hostUid}
                  creatorName={giftRecipient?.name || resolvedHostName || 'Host'}
                  navigation={navigation}
                  incomingGiftEvent={incomingGiftEvent}
                  battleId={giftRecipient?.battleSide ? activeBattleId : undefined}
                  battleSide={giftRecipient?.battleSide}
                />

                {activeBattleId ? (
                  <BattleOverlay
                    battleId={activeBattleId}
                    currentUid={uid}
                    liveStreamId={streamId || ivsHostSession?.sessionId || null}
                    onExit={exitBattleView}
                    onRematchStarted={({ battleId: nextId }) => adoptBattleOnLive(nextId, 'creator')}
                  />
                ) : null}
                {renderArtilleryLayer()}
                {renderMarbleLayer()}
                {renderFrenemiesLayer()}
                {renderReactionDuelLayer()}
                {renderLiveGamesPicker()}

                <GuestControlSheet
                  visible={guestControlVisible}
                  guests={guestControlList}
                  selectedGuestId={selectedGuestControlId}
                  onSelectGuest={setSelectedGuestControlId}
                  onClose={() => setGuestControlVisible(false)}
                  currentUserId={uid}
                  mutedGuestIds={mutedGuestIds}
                  cameraOffGuestIds={cameraOffGuestIds}
                  onToggleMute={toggleGuestMute}
                  onToggleCamera={toggleGuestCamera}
                  onKick={handleGuestKick}
                  onReport={handleGuestReport}
                  onGift={handleGuestGift}
                  onOpenProfile={handleGuestProfile}
                  onChallenge={handleGuestChallenge}
                  canChallenge={isHost && isStreaming && !activeBattleId}
                  challengeBusy={challengeBusy}
                  giftTotalsByUser={giftTotalsByUser}
                  joinedAtByUser={guestJoinedAt}
                  sessionEngagementByUser={sessionEngagementByUser}
                />

                <LiveInviteGuestsModal
                  visible={inviteGuestsOpen}
                  hostUid={uid}
                  onClose={() => setInviteGuestsOpen(false)}
                  onInvite={inviteGuestFromFollowGraph}
                  invitingUid={invitingGuestUid}
                />

                <ReportModal
                  visible={!!guestReportTarget}
                  onClose={() => setGuestReportTarget(null)}
                  targetType="user"
                  targetId={guestReportTarget?.userId}
                  targetLabel={guestReportTarget?.name ? `@${guestReportTarget.name}` : 'this guest'}
                  reportedUserId={guestReportTarget?.userId}
                />
              </>
            )}
          </View>
        )}
        {/* Stage Desk — host Live Dashboard (pre-live + live) */}
        {isHost ? (
          <LiveDashboardSheet
            visible={stageDeskOpen}
            onClose={() => setStageDeskOpen(false)}
            uid={uid}
            isStreaming={isStreaming}
            viewCount={viewCount}
            heartCount={heartCount}
            giftTotalsByUser={giftTotalsByUser}
            publicLabelsByUser={publicLabelsByUser}
            guestLayoutMode={guestLayoutMode}
            micOn={ivsHostSession?.isMicEnabled ?? true}
            cameraOn={ivsHostSession?.isCameraEnabled ?? true}
            marbleEnabled={MARBLE_ENABLED}
            battleActive={!!activeBattleId}
            onSetLayout={(modeId) => {
              setGuestLayoutMode(modeId);
              if (modeId === LIVE_LAYOUT_MODES.HOST_FOCUS) {
                setHostGuestTrayMode('collapsed');
              } else if (modeId === LIVE_LAYOUT_MODES.BOTTOM_GRID) {
                setHostGuestTrayMode((prev) => (prev === 'hidden' ? 'collapsed' : prev));
              } else {
                setHostGuestTrayMode('hidden');
              }
              setShowLayoutSwitcher(false);
            }}
            onToggleMic={toggleMic}
            onFlipCamera={flipCamera}
            onToggleCamera={toggleHostCamera}
            onOpenChat={() => {
              setStageDeskOpen(false);
              setCommentsModalVisible(true);
            }}
            onInviteGuests={() => {
              setStageDeskOpen(false);
              setInviteGuestsOpen(true);
            }}
            onOpenGuestSheet={() => {
              setStageDeskOpen(false);
              setGuestControlVisible(true);
            }}
            onShare={shareLive}
            onOpenGames={() => {
              setStageDeskOpen(false);
              openLiveGames();
            }}
            onSendComment={(text) => sendComment(text)}
            onNavigatePlans={() => {
              setStageDeskOpen(false);
              try {
                navigation.navigate('Plans');
              } catch {
                /* route may be absent in some stacks */
              }
            }}
          />
        ) : null}

        {/* Themed exit confirmation dialog */}
        <Modal
          visible={showExitConfirm}
          transparent
          animationType="fade"
          onRequestClose={() => setShowExitConfirm(false)}
        >
          <View style={styles.exitConfirmOverlay}>
            <View style={styles.exitConfirmCard}>
              <GradientText style={styles.exitConfirmTitle}>Exit live?</GradientText>
              <Text style={styles.exitConfirmBody} allowFontScaling={false}>
                If you leave now, your live will end for everyone.
              </Text>
              <View style={styles.exitConfirmActions}>
                <TouchableOpacity
                  style={[styles.exitConfirmBtn, styles.exitConfirmStayBtn]}
                  onPress={() => setShowExitConfirm(false)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.exitConfirmBtnText} allowFontScaling={false}>Stay</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.exitConfirmBtn, styles.exitConfirmExitBtn]}
                  onPress={_handleConfirmExit}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.exitConfirmBtnText, styles.exitConfirmExitText]} allowFontScaling={false}>Exit</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </RootContainer>
    </BlueScreen>
  );
}

const styles = StyleSheet.create({
  keyboardAvoidingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
    marginHorizontal: 20,
  },
  permissionButton: {
    backgroundColor: COLORS.gradientEnd,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    marginTop: 8,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  homeHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    // Keep height driven by the 44x44 buttons; avoid extra top gap vs other headers.
    paddingTop: 0,
    // Add a little breathing room under the logo before content.
    paddingBottom: 16,
  },
  homeHeaderBalances: { position: 'absolute', left: 56, height: '100%', justifyContent: 'center' },
  homeHeaderButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeHeaderLogoContainer: {
    flex: 1,
    alignItems: 'center',
  },

  liveHeaderRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
  },
  liveHeaderBack: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveHeaderCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveHeaderTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  liveHeaderSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  liveHeaderRight: {
    width: 40,
    height: 40,
  },

  ivsHostStage: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  ivsComposeSide: {
    flexDirection: 'row',
  },
  ivsComposeEqual: {
    flexDirection: 'column',
  },
  ivsComposeHostPaneSide: {
    flex: 1.15,
    height: '100%',
    overflow: 'hidden',
  },
  ivsComposeHostPaneEqual: {
    flex: 1.25,
    width: '100%',
    overflow: 'hidden',
  },
  ivsComposeGuestPaneSide: {
    flex: 0.85,
    height: '100%',
    paddingHorizontal: 6,
    paddingVertical: 8,
    backgroundColor: 'rgba(10,10,12,0.55)',
  },
  ivsComposeGuestPaneEqual: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: 'rgba(10,10,12,0.45)',
  },
  ivsComposeGuestScroll: {
    flex: 1,
  },
  ivsComposeGuestCol: {
    flexGrow: 1,
    gap: 8,
  },
  ivsComposeGuestGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  ivsComposeTileSide: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: 'rgba(0, 210, 190, 0.35)',
  },
  ivsComposeTileEqual: {
    width: '30%',
    marginHorizontal: '1.5%',
    marginBottom: 10,
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: 'rgba(0, 210, 190, 0.35)',
  },
  ivsGuestTrayFocus: {
    // Host-focus: keep the strip visually lighter above comments.
    opacity: 1,
  },
  ivsBattleStage: {
    flexDirection: 'row',
  },
  ivsBattleStageReverse: {
    flexDirection: 'row-reverse',
  },
  ivsBattlePane: {
    flex: 1,
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#0A0A0C',
  },
  ivsBattleEdgeLeft: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(0,210,190,0.85)',
    zIndex: 5,
  },
  ivsBattleEdgeRight: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(255,90,69,0.85)',
    zIndex: 5,
  },
  ivsBattleWaiting: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#121214',
  },
  ivsBattleWaitingText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    fontWeight: '700',
  },
  ivsGuestTray: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingBottom: 16,
  },
  ivsGuestPagerContent: {
    alignItems: 'flex-end',
  },
  ivsGuestPage: {
    // Match the ScrollView viewport width (tray has horizontal padding).
    width: width - 16,
  },
  ivsGuestGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
    justifyContent: 'center',
  },
  ivsGuestGridCollapsed: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    width: '100%',
    justifyContent: 'center',
  },
  ivsGuestTile: {
    // Fluid 3-wide default; width overridden per visible count for 1→2→3 reflow.
    width: '30.5%',
    marginHorizontal: '1.25%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(10,10,12,0.78)',
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 210, 190, 0.42)',
  },
  ivsGuestTileCollapsed: {
    // Fluid 3-wide row; width overridden when fewer guests for bigger tiles.
    width: '30.5%',
    marginHorizontal: '1.25%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(10,10,12,0.78)',
    marginBottom: 0,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 210, 190, 0.42)',
  },
  ivsGuestTileHidden: {
    opacity: 0,
  },
  ivsTileVideo: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  ivsEmptyTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ivsEmptyTileInner: {
    width: '72%',
    height: '72%',
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  ivsInviteTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ivsInvitePlusCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  ivsInvitePlusText: {
    color: 'white',
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 26,
  },
  ivsInviteLabelText: {
    marginTop: 8,
    color: 'white',
    fontSize: 13,
    fontWeight: '800',
  },
  ivsHiddenTrayHandle: {
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    height: 28,
    paddingHorizontal: 12,
  },
  ivsHiddenTrayPill: {
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 210, 190, 0.7)',
    marginBottom: 6,
  },
  ivsHiddenTrayText: {
    color: 'rgba(127, 237, 226, 0.95)',
    fontSize: 12,
    fontWeight: '700',
  },
  ivsSlotNumberBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  viewerBottomVignette: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 25,
  },
  viewerReactionTray: {
    position: 'absolute',
    left: 12,
    zIndex: 55,
    elevation: 55,
    maxWidth: '70%',
    overflow: 'hidden',
  },
  viewerSafetyButton: {
    position: 'absolute',
    right: 14,
    zIndex: 60,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  viewerDoubleTapCatcher: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 180,
    zIndex: 20,
  },
  ivsGuestKickButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    zIndex: 30,
    elevation: 30,
  },
  // Per-guest mic toggle (host/moderator). Sits left of the kick button.
  // Neutral near-black by default; rose (Pulse error) when the guest is muted.
  ivsGuestMuteButton: {
    position: 'absolute',
    top: 4,
    right: 32,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 10, 12, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    zIndex: 30,
    elevation: 30,
  },
  ivsGuestMuteButtonActive: {
    backgroundColor: 'rgba(251, 113, 133, 0.92)',
    borderColor: 'rgba(255,255,255,0.5)',
  },
  ivsSlotNumberText: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 12,
    fontWeight: '800',
  },
  ivsTilePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ivsTileText: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  preLiveContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 24,
    paddingTop: LIVE_TOP_INSET + 8,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    justifyContent: 'space-between',
  },
  preLiveClose: {
    position: 'absolute',
    top: LIVE_TOP_INSET,
    left: 16,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  preLiveHero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preLiveIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 210, 190, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 210, 190, 0.40)',
    marginBottom: 18,
  },
  preLiveTitle: {
    color: '#F5F5F7',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
  },
  preLiveSubtitle: {
    color: '#A1A1AA',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 300,
  },
  preLiveBottom: {
    gap: 14,
  },
  preLiveDeskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(0,210,190,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
  },
  preLiveDeskBtnText: {
    color: '#00D2BE',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  preLiveDeskHint: {
    flex: 1,
    textAlign: 'right',
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '600',
  },
  hostControlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 28,
    backgroundColor: 'rgba(10,10,12,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  hostControl: {
    alignItems: 'center',
    width: 54,
  },
  hostControlCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  hostCameraOffOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.92)',
  },
  hostCameraOffAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    marginBottom: 10,
  },
  hostCameraOffText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  hostGuestCamOffFill: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121214',
  },
  hostGuestCamOffAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  hostControlCircleActive: {
    backgroundColor: 'rgba(0,210,190,0.18)',
    borderColor: 'rgba(0,210,190,0.55)',
  },
  hostControlCircleDanger: {
    backgroundColor: 'rgba(244,63,94,0.92)',
    borderColor: 'rgba(255,255,255,0.18)',
  },
  hostControlLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 5,
  },
  layoutSwitcher: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: 'rgba(10,10,12,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 10,
    gap: 4,
  },
  layoutOption: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    minWidth: 64,
  },
  layoutOptionActive: {
    backgroundColor: 'rgba(0,210,190,0.12)',
  },
  layoutOptionLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 5,
  },
  layoutOptionLabelActive: {
    color: '#00D2BE',
  },
  titleEditorModalRoot: {
    flex: 1,
  },
  titleEditorBlur: {
    flex: 1,
  },
  titleEditorContent: {
    flex: 1,
  },
  titleEditorHeader: {
    paddingTop: Platform.OS === 'ios' ? 56 : 18,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleEditorHeaderAction: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  titleEditorBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  titleEditorInput: {
    color: COLORS.textPrimary,
    fontSize: 44,
    fontWeight: '800',
    paddingVertical: 10,
  },
  titleInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    color: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
  },
  titleInputTapTarget: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: 20,
    height: 52,
    borderRadius: 10,
  },
  goLiveButton: {
    alignSelf: 'stretch',
  },
  goLiveButtonInner: {
    flexDirection: 'row',
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  goLiveButtonText: {
    color: '#0A0A0C',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  goLiveButtonTextDisabled: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  liveIndicatorContainer: {
    position: 'absolute',
    top: 40,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveText: {
    backgroundColor: '#FF0000',
    color: 'white',
    fontWeight: 'bold',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 5,
    overflow: 'hidden',
    fontSize: 14,
  },
  viewCount: {
    color: 'white',
    marginLeft: 10,
    fontSize: 14,
  },
  duration: {
    color: 'white',
    marginLeft: 10,
    fontSize: 14,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
    backgroundColor: 'rgba(255, 0, 0, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff0000',
    marginRight: 4,
  },
  recordingText: {
    color: '#ff0000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  segmentCount: {
    color: 'white',
    marginLeft: 10,
    fontSize: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  streamIdDebug: {
    color: '#ffeb3b',
    marginLeft: 10,
    fontSize: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    fontFamily: 'monospace',
  },
  // Host camera controls: a right-side vertical rail that sits below the
  // unified header so it never collides with the identity/stat row.
  closeButton: {
    position: 'absolute',
    top: 100,
    right: 14,
    backgroundColor: 'rgba(244, 63, 94, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 23,
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1200,
    elevation: 1200,
  },
  flipButton: {
    position: 'absolute',
    top: 154,
    right: 14,
    backgroundColor: 'rgba(10, 10, 12, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 23,
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1200,
    elevation: 1200,
  },
  micButton: {
    position: 'absolute',
    top: 208,
    right: 14,
    backgroundColor: 'rgba(10, 10, 12, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 23,
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1200,
    elevation: 1200,
  },
  camToggleButton: {
    position: 'absolute',
    top: 262,
    right: 14,
    backgroundColor: 'rgba(10, 10, 12, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 23,
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1200,
    elevation: 1200,
  },
  commentsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: height * 0.4,
    // Transparent: this wrapper only positions the bottom bar. A solid
    // background here painted a full-width dark band over the stream that read
    // as "chat covers the whole screen".
    backgroundColor: 'transparent',
    zIndex: 60,
    elevation: 60,
  },
  commentsList: {
    flex: 1,
  },
  commentsListContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  commentRow: {
    maxWidth: '84%',
  },
  commentRowMine: {
    alignSelf: 'flex-end',
  },
  commentRowOther: {
    alignSelf: 'flex-start',
  },
  commentBubble: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  commentBubbleMine: {
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
  },
  commentBubbleOther: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  commentItem: {
    padding: 10,
    borderRadius: 10,
    marginHorizontal: 10,
    marginVertical: 5,
  },
  commentTicker: {
    height: 36,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  commentTickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  commentTickerSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  commentTickerSegmentSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    marginLeft: 16,
  },
  commentTickerLine: {
    color: 'white',
    fontSize: 14,
  },
  commentTickerUsername: {
    color: COLORS.gradientEnd,
    fontWeight: 'bold',
    fontSize: 14,
  },
  commentUsername: {
    color: COLORS.gradientEnd,
    fontWeight: 'bold',
    left: 20,
    zIndex: 1000,
    elevation: 1000,
    maxWidth: '80%',
  },
  hostIdentityPill: {
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '72%',
  },
  hostIdentityAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  hostIdentityAvatarPlaceholder: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },

  topMetaRow: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'column',
    alignItems: 'flex-start',
    zIndex: 1200,
    elevation: 1200,
  },
  topMetaStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    flexWrap: 'wrap',
    maxWidth: '100%',
  },
  topMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 10, 12, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginRight: 8,
    marginBottom: 8,
  },
  topMetaLivePill: {
    backgroundColor: 'rgba(244, 63, 94, 0.95)',
    borderColor: 'rgba(255, 255, 255, 0.28)',
    paddingHorizontal: 12,
  },
  topMetaLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ffffff',
    marginRight: 7,
  },
  topMetaPillText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  topMetaPillIcon: {
    marginRight: 6,
  },

  // Unified compact live header (host + viewer): one row -> avatar + @name + LIVE + counts.
  liveHeader: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1200,
    elevation: 1200,
  },
  liveHeaderIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 10, 12, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(0, 210, 190, 0.38)',
    borderRadius: 999,
    paddingLeft: 4,
    paddingRight: 10,
    paddingVertical: 4,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '58%',
  },
  liveHeaderAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 8,
  },
  liveHeaderAvatarPlaceholder: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  liveHeaderName: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    flexShrink: 1,
    minWidth: 0,
  },
  liveHeaderLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F43F5E',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  liveHeaderLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
    marginRight: 5,
  },
  liveHeaderLiveText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  liveHeaderSpacer: {
    flex: 1,
    minWidth: 8,
  },
  liveHeaderStat: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  liveHeaderStatCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 10, 12, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    paddingRight: 12,
    paddingVertical: 5,
  },
  liveHeaderStatText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    marginLeft: 4,
  },
  liveHeaderFollow: {
    marginLeft: 12,
    borderWidth: 1,
    borderColor: '#00D2BE',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  liveHeaderFollowText: {
    color: '#00D2BE',
    fontWeight: '800',
    fontSize: 12,
  },
  liveHeaderActionCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
    backgroundColor: 'rgba(10, 10, 12, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  liveHeaderClose: {
    marginLeft: 0,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },

  onAirBadge: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  onAirBadgeInner: {
    backgroundColor: COLORS.error,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  onAirText: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
    lineHeight: 20,
  },
  hostIdentityText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
    marginRight: 10,
    flexShrink: 1,
    minWidth: 0,
  },
  guestRequestBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  guestRequestCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  guestRequestTitle: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 18,
    marginBottom: 10,
    textAlign: 'center',
  },
  guestRequestIdentityPill: {
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: '100%',
  },
  guestRequestIdentityText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
    marginRight: 10,
    maxWidth: 260,
  },
  guestRequestAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  guestRequestAvatarPlaceholder: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  guestRequestSubtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 14,
    marginTop: 10,
    marginBottom: 14,
    textAlign: 'center',
  },
  guestRequestActions: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  guestRequestButton: {
    borderRadius: 9999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  guestRequestRejectButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    marginBottom: 12,
  },
  guestRequestAcceptButtonHit: {
    borderRadius: 9999,
    overflow: 'hidden',
    width: '100%',
  },
  guestRequestAcceptButton: {
    width: '100%',
    backgroundColor: 'transparent',
    borderRadius: 9999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestRequestButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  sendButtonHit: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    marginRight: 10,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartCount: {
    color: 'white',
    fontSize: 12,
    marginTop: 2,
  },
  countdownContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  countdownText: {
    color: 'white',
    fontSize: 96,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  startingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    zIndex: 4000,
    elevation: 4000,
  },
  startingInner: {
    alignItems: 'center',
  },
  startingText: {
    color: '#F5F5F7',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 14,
  },
  // Viewer mode styles
  viewerBackButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerHeader: {
    position: 'absolute',
    top: 50,
    left: 80,
    right: 20,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewerBroadcasterName: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gradientEnd,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  liveIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
    marginRight: 6,
  },
  liveText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  viewerVideo: {
    width: '100%',
    height: '100%',
  },
  viewerStats: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    zIndex: 10,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 10,
  },
  statText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  viewerCountBadge: {
    position: 'absolute',
    right: 20,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  viewerCountText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 6,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  viewerLikeFloating: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
  },
  viewerLikeStack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerLikeButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  viewerLikeCount: {
    marginTop: 6,
    color: 'white',
    fontSize: 13,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  viewerAuthOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitConfirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitConfirmCard: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 18,
    padding: 28,
    marginHorizontal: 32,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  exitConfirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  exitConfirmBody: {
    color: COLORS.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
  },
  exitConfirmActions: {
    flexDirection: 'row',
    gap: 12,
  },
  exitConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  exitConfirmStayBtn: {
    backgroundColor: COLORS.backgroundCard,
  },
  exitConfirmExitBtn: {
    backgroundColor: COLORS.error,
  },
  exitConfirmBtnText: {
    color: COLORS.textPrimary,
    fontWeight: '600',
    fontSize: 15,
  },
  exitConfirmExitText: {
    color: COLORS.white,
    fontWeight: '700',
  },
});

export default LiveStreamScreen;

