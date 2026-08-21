/**
 * LiveStreamViewer Component - TikTok-Style Architecture
 *
 * Production-grade live streaming viewer with:
 * - IVS Real-Time for low-latency streaming (primary)
 * - HLS segmented playback for legacy support
 * - Adaptive buffering for smooth experience
 * - Robust error recovery and fallback mechanisms
 * - Real-world performance optimizations
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  Alert,
  ScrollView,
  TouchableOpacity,
  PanResponder,
  AppState,
  InteractionManager,
  Image,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';

if (Platform.OS === 'ios' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function isDeadWatchError(message) {
  return /session_not_found|not found or not live/i.test(String(message || ''));
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import UnifiedVideo from './UnifiedVideo';
import { getStreamingBackend } from '../streaming/StreamingBackendFactory';
import { logStreamingEvent } from '../streaming/StreamingLog';
import HLSLiveStreamServiceInstance from '../services/HLSLiveStreamService';
import {
  incrementViewer as incrementFirestoreViewer,
  mirrorGuestRequest,
  clearGuestRequest,
} from '../services/LiveService';
import { db, firebaseEnabled } from '../config/firebase';
import StreamSegmentsAdapter from '../services/StreamSegmentsAdapter';
import EnterpriseAnalyticsService from '../services/EnterpriseAnalyticsService';
import ManifestService from '../services/ManifestService';
import PlaylistParserService from '../services/PlaylistParserService';
import PlaylistFetchService from '../services/PlaylistFetchService';
import QualitySelectionService from '../services/QualitySelectionService';
import { decideNextQuality, createSlidingWindowCounter, emitQualitySwitchEvent } from '../services/QualityAdaptationService';
import SegmentBandwidthEstimatorService from '../services/SegmentBandwidthEstimatorService';
import NetInfo from '@react-native-community/netinfo';
import { isManifestEnabled, isPlaylistViewerEnabled, getFeatureFlags } from '../config/FeatureFlags';
import { useAuth, useFirestoreDoc } from '../hooks/useCommon';
import { pickPublicLabel } from '../utils/publicLabel';
import { streamingConfig } from '../config/StreamingFeatureConfig';
import { StreamingBackend } from '../config/StreamingBackend';
import { useIVSViewerSession } from '../live/ivs/hooks/useIVSViewerSession';
import { COLORS } from '../styles/theme';
import Icon from './Icon';
import ReservedGuestTile from './live/ReservedGuestTile';
import { createGuestToken, requestGuestSlot, getMyGuestRequest, leaveGuest, guestHeartbeat, MAX_GUEST_SLOTS, frenemiesQueueJoin } from '../api/ivsLiveApi';
import { requestCameraAndAudioPermission } from '../utils/permissions';
import { getIVSNativeClient } from '../streaming/IVSNativeClient';
import { subscribeToRoomEvents } from '../realtime/roomEventsSocket';
import {
  LIVE_LAYOUT_MODES,
  DEFAULT_LIVE_LAYOUT_MODE,
  normalizeLiveLayoutMode,
  layoutUsesBottomTray,
  guestsPerTrayPage,
  guestBoxesForLayout,
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

import {
  getNativeIVSBroadcastView,
  getNativeIVSPlayerView,
  getNativeIVSRealTimeView,
} from '../live/ivs/native/views';
import TileCoinBadge, {
  coinsFromGiftTotals,
  tileCoinPositions,
} from './live/TileCoinBadge';

const LiveStreamViewer = ({
  streamId,
  onError,
  style,
  hostUid,
  overlayBottomInset = 0,
  onGuestPagerLayout,
  guestRoster = [],
  guestLayoutMode = DEFAULT_LIVE_LAYOUT_MODE,
  giftTotalsByUser = {},
  battleMode = false,
  hostBandHeight,
  hostExpanded = false,
  watchViewCount = 0,
  liveGoal = null,
  giftAlert = null,
  onToggleFullscreen,
  onHostPress,
}) => {
  const backend = streamingConfig.backend;

  // IVS Viewer Mode
  if (backend === StreamingBackend.IVS) {
    return (
      <IVSLiveStreamViewer
        streamId={streamId}
        hostUid={hostUid}
        onError={onError}
        style={style}
        overlayBottomInset={overlayBottomInset}
        onGuestPagerLayout={onGuestPagerLayout}
        guestRoster={guestRoster}
        guestLayoutMode={guestLayoutMode}
        giftTotalsByUser={giftTotalsByUser}
        battleMode={battleMode}
        hostBandHeight={hostBandHeight}
        hostExpanded={hostExpanded}
        watchViewCount={watchViewCount}
        liveGoal={liveGoal}
        giftAlert={giftAlert}
        onToggleFullscreen={onToggleFullscreen}
        onHostPress={onHostPress}
      />
    );
  }

  // HLS Legacy Mode
  return <HLSLiveStreamViewer streamId={streamId} onError={onError} style={style} />;
};

/**
 * IVS Live Stream Viewer
 * Uses Amazon IVS Real-Time for low-latency streaming
 */
const IVSLiveStreamViewer = ({
  streamId,
  hostUid,
  onError,
  style,
  overlayBottomInset = 0,
  onGuestPagerLayout,
  guestRoster = [],
  guestLayoutMode: guestLayoutModeProp = DEFAULT_LIVE_LAYOUT_MODE,
  giftTotalsByUser = {},
  battleMode = false,
  hostBandHeight,
  hostExpanded = false,
  watchViewCount = 0,
  liveGoal = null,
  giftAlert = null,
  onToggleFullscreen,
  onHostPress,
}) => {
  // Center-crop guest tiles so video fills the box without stretching.
  // For a square tile, a 16:9 cover factor is ~1.78 (works well for typical phone video orientations).
  const GUEST_TILE_ZOOM = 16 / 9;
  const NativeIVSBroadcastView = getNativeIVSBroadcastView();
  const NativeIVSPlayerView = getNativeIVSPlayerView();
  const NativeIVSRealTimeView = getNativeIVSRealTimeView();

  const { uid, getDisplayName } = useAuth();
  const { data: viewerUserDoc } = useFirestoreDoc('users', uid);
  const viewerDisplayName = useMemo(() => {
    let authName;
    try {
      authName = typeof getDisplayName === 'function' ? getDisplayName() : null;
    } catch {
      authName = null;
    }
    return pickPublicLabel(
      {
        username: viewerUserDoc?.username,
        handle: viewerUserDoc?.handle,
        displayName: viewerUserDoc?.displayName,
        name: authName,
      },
      { uid, fallback: 'Viewer' },
    );
  }, [getDisplayName, uid, viewerUserDoc]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const surfaceReadyMarkedRef = useRef(false);
  const markSurfaceReadyRef = useRef(() => {});
  const everConnectedRef = useRef(false);
  const endedNotifiedRef = useRef(false);
  const [guestRequestStatus, setGuestRequestStatus] = useState('idle'); // idle | sending | sent | error
  const [guestMode, setGuestMode] = useState(false);
  const guestModeRef = useRef(false);
  const [guestSlotId, setGuestSlotId] = useState(null);
  const [guestRequestedSlotId, setGuestRequestedSlotId] = useState(null);
  const [guestStageArn, setGuestStageArn] = useState(null);
  const [guestToken, setGuestToken] = useState(null);
  const [guestSessionId, setGuestSessionId] = useState(null);
  const guestSessionIdRef = useRef(null);
  const [guestJoinError, setGuestJoinError] = useState(null);
  const [guestGridHeight, setGuestGridHeight] = useState(0);
  const [guestPagerMeasuredHeight, setGuestPagerMeasuredHeight] = useState(0);
  // Guest boxes are visible on entry as one compact row; viewers can swipe up
  // for a second row or down to hide the tray completely.
  const [guestTrayMode, setGuestTrayMode] = useState('collapsed'); // expanded | collapsed | hidden
  const [suspendViewerAutoJoin, setSuspendViewerAutoJoin] = useState(false);
  // Host-applied mute on this user (when on stage as a guest). Host controls it;
  // the guest cannot self-unmute while true.
  const [mutedByHost, setMutedByHost] = useState(false);
  // Host-applied camera disable while on stage as a guest. Host owns it; the guest
  // cannot turn the camera back on themselves while true.
  const [cameraOffByHost, setCameraOffByHost] = useState(false);
  // Guest's own media preferences (honored unless host has forced mute/cam-off).
  const [selfMicOn, setSelfMicOn] = useState(true);
  const [selfCamOn, setSelfCamOn] = useState(true);
  const selfMicOnRef = useRef(true);
  const selfCamOnRef = useRef(true);
  const [selfPhotoUrl, setSelfPhotoUrl] = useState(null);
  // Set when the host invites this viewer up (host-initiated). Drives an accept prompt.
  const [hostInvite, setHostInvite] = useState(null);
  const prevVisibleGuestCountRef = useRef(null);
  // Refs so the AppState listener (registered once) reads the latest enforced state.
  const mutedByHostRef = useRef(false);
  const cameraOffByHostRef = useRef(false);
  mutedByHostRef.current = mutedByHost;
  cameraOffByHostRef.current = cameraOffByHost;
  selfMicOnRef.current = selfMicOn;
  selfCamOnRef.current = selfCamOn;
  const bgLeaveTimerRef = useRef(null);

  const applyLocalMedia = useCallback(() => {
    if (!guestModeRef.current) return;
    const micOn = selfMicOnRef.current && !mutedByHostRef.current;
    const camOn = selfCamOnRef.current && !cameraOffByHostRef.current;
    try {
      const nativeClient = getIVSNativeClient();
      if (nativeClient && typeof nativeClient.setMicEnabled === 'function') {
        Promise.resolve(nativeClient.setMicEnabled(micOn)).catch(() => {});
      }
      if (nativeClient && typeof nativeClient.setCameraEnabled === 'function') {
        Promise.resolve(nativeClient.setCameraEnabled(camOn)).catch(() => {});
      }
    } catch (e) {
      console.warn('[IVS_VIEWER][APPLY_LOCAL_MEDIA_FAILED]', e?.message || String(e));
    }
  }, []);

  const toggleSelfMic = useCallback(() => {
    if (!guestModeRef.current) return;
    if (mutedByHostRef.current) {
      Alert.alert('Mic locked', 'The host muted your microphone. They need to unmute you first.');
      return;
    }
    setSelfMicOn((prev) => {
      const next = !prev;
      selfMicOnRef.current = next;
      setTimeout(() => applyLocalMedia(), 0);
      return next;
    });
  }, [applyLocalMedia]);

  const toggleSelfCam = useCallback(() => {
    if (!guestModeRef.current) return;
    if (cameraOffByHostRef.current) {
      Alert.alert('Camera locked', 'The host turned your camera off. They need to turn it back on first.');
      return;
    }
    setSelfCamOn((prev) => {
      const next = !prev;
      selfCamOnRef.current = next;
      setTimeout(() => applyLocalMedia(), 0);
      return next;
    });
  }, [applyLocalMedia]);

  // Load this user's profile photo for the cam-off avatar tile.
  useEffect(() => {
    if (!uid || !firebaseEnabled || !db || typeof db.collection !== 'function') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const snap = await db.collection('users').doc(uid).get();
        const d = snap?.data?.() || {};
        const url = d.photoURL || d.photoUrl || d.profilePicture || d.avatar || null;
        if (!cancelled && url) setSelfPhotoUrl(String(url));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    if (guestMode) applyLocalMedia();
  }, [guestMode, selfMicOn, selfCamOn, mutedByHost, cameraOffByHost, applyLocalMedia]);

  const guestPagerScrollRef = useRef(null);
  const ivsSessionRef = useRef(null);

  useEffect(() => {
    guestModeRef.current = guestMode;
    if (!guestMode) {
      setMutedByHost(false);
      setCameraOffByHost(false);
      setSelfMicOn(true);
      setSelfCamOn(true);
      selfMicOnRef.current = true;
      selfCamOnRef.current = true;
    }
  }, [guestMode]);

  const guestRequestStatusRef = useRef('idle');
  useEffect(() => {
    guestRequestStatusRef.current = guestRequestStatus;
  }, [guestRequestStatus]);

  const generateGuestSessionId = useCallback(() => {
    const randomUUID = global?.crypto?.randomUUID?.();
    if (randomUUID && typeof randomUUID === 'string') return randomUUID;
    return `guest-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }, []);

  const leaveAsGuestAndCleanup = useCallback(async (reason, opts = {}) => {
    const force = opts?.force === true;
    const sid = guestSessionIdRef.current;

    try {
      if (streamId && sid) {
        await leaveGuest(streamId, sid, force);
      }
    } catch (e) {
      console.warn('[IVS_VIEWER][LEAVE_GUEST_API_FAILED]', { reason, error: e?.message || String(e) });
    }

    // Remove our Firestore request mirror so we no longer appear as pending.
    if (streamId && uid) clearGuestRequest(streamId, uid);

    try {
      const nativeClient = getIVSNativeClient();
      // Defensive: native stop can occasionally hang; never block state reset on it.
      const stopPromise = Promise.resolve(nativeClient.stopGuestSession());
      const timeoutPromise = new Promise((resolve) => {
        const t = setTimeout(() => {
          clearTimeout(t);
          resolve();
        }, 1500);
      });
      await Promise.race([stopPromise, timeoutPromise]);
    } catch (err) {
      console.warn('[IVS_VIEWER][STOP_GUEST_FAILED]', { reason, error: err?.message || String(err) });
    } finally {
      guestModeRef.current = false;
      setGuestMode(false);
      setGuestSlotId(null);
      setGuestRequestedSlotId(null);
      setGuestStageArn(null);
      setGuestToken(null);
      setGuestSessionId(null);
      guestSessionIdRef.current = null;
      setGuestJoinError(null);
      setGuestRequestStatus('idle');
      setSuspendViewerAutoJoin(false);

      const joinFn = ivsSessionRef.current?.joinStream;
      if (typeof joinFn === 'function') {
        try {
          await joinFn();
        } catch (err) {
          console.warn('[IVS_VIEWER][REJOIN_AS_VIEWER_ERROR]', err);
        }
      }
    }
  }, [streamId]);

  // App background/foreground while on stage. Previously we left the stage on ANY
  // backgrounding, so quickly checking another app (e.g. replying on WhatsApp)
  // kicked the guest off. Now we keep the slot for a grace period and only drop
  // it if the app stays backgrounded; on return we resume publishing (re-asserting
  // mic/camera, honoring any host-applied mute/camera-off).
  useEffect(() => {
    const GRACE_MS = 30000;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        const onStageOrPending = guestModeRef.current || guestRequestStatusRef.current === 'sent';
        if (onStageOrPending && !bgLeaveTimerRef.current) {
          bgLeaveTimerRef.current = setTimeout(() => {
            bgLeaveTimerRef.current = null;
            Promise.resolve(leaveAsGuestAndCleanup('appstate_timeout', { force: false })).catch(() => {});
          }, GRACE_MS);
        }
      } else {
        // Back in foreground within the grace window — cancel the pending leave.
        if (bgLeaveTimerRef.current) {
          clearTimeout(bgLeaveTimerRef.current);
          bgLeaveTimerRef.current = null;
        }
        // Resume the guest publish (the OS may have suspended the camera while away).
        if (guestModeRef.current) {
          try {
            applyLocalMedia();
          } catch (e) {
            console.warn('[IVS_VIEWER][RESUME_ON_FOREGROUND_FAILED]', e?.message || String(e));
          }
        }
      }
    });
    return () => {
      try { sub?.remove?.(); } catch { }
      if (bgLeaveTimerRef.current) {
        clearTimeout(bgLeaveTimerRef.current);
        bgLeaveTimerRef.current = null;
      }
    };
  }, [leaveAsGuestAndCleanup, applyLocalMedia]);

  // While guest publishing, keep a heartbeat so the backend can detect stale sessions.
  useEffect(() => {
    if (!streamId) return;
    if (!guestMode) return;
    if (!guestSessionId) return;

    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled) return;
      guestHeartbeat(streamId, guestSessionId).catch((e) => {
        console.warn('[IVS_VIEWER][GUEST_HEARTBEAT_FAILED]', e?.message || String(e));
      });
    }, 10_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [streamId, guestMode, guestSessionId]);

  // Host-remote-mute enforcement. When this user is on stage as a guest and the
  // host (or a moderator) mutes/unmutes them, honor it instantly by toggling the
  // local publisher mic via the native client. The guest cannot self-unmute while
  // muted — the host owns that state. Additive to the REST/poll path.
  useEffect(() => {
    if (!streamId) return;
    let sub = null;
    let active = true;
    (async () => {
      try {
        sub = await subscribeToRoomEvents(streamId, (evt) => {
          if (!evt) return;
          const t = evt.type;

          if (t === 'room.ended') {
            setConnectionStatus('ended');
            if (guestModeRef.current) {
              try { leaveAsGuestAndCleanup('room_ended', { force: true }); } catch { /* ignore */ }
            }
            if (onError) onError({ message: 'Stream has ended' });
            return;
          }

          if (t === 'guest.invited') {
            if (!uid || evt.guestUserId !== uid) return;
            if (guestModeRef.current) return;
            if (guestRequestStatusRef.current === 'sending') return;
            const slot = typeof evt.slotIndex === 'number' ? evt.slotIndex : null;
            // Paid Frenemies jump / other force seats: auto-join (pay ≠ decline).
            if (evt.force === true) {
              setHostInvite({ slotIndex: slot, force: true });
              return;
            }
            setHostInvite({ slotIndex: slot });
            return;
          }

          if (!evt.guestUserId || !uid || evt.guestUserId !== uid) return;
          if (!guestModeRef.current) return;
          if (t === 'guest.muted' || t === 'guest.unmuted') {
            const shouldMute = t === 'guest.muted';
            setMutedByHost(shouldMute);
            if (shouldMute) {
              setSelfMicOn(false);
              selfMicOnRef.current = false;
            }
            try {
              applyLocalMedia();
            } catch (e) {
              console.warn('[IVS_VIEWER][HOST_MUTE_ENFORCE_FAILED]', e?.message || String(e));
            }
          } else if (t === 'guest.camera_off' || t === 'guest.camera_on') {
            const shouldDisable = t === 'guest.camera_off';
            setCameraOffByHost(shouldDisable);
            if (shouldDisable) {
              setSelfCamOn(false);
              selfCamOnRef.current = false;
            }
            try {
              applyLocalMedia();
            } catch (e) {
              console.warn('[IVS_VIEWER][HOST_CAMERA_ENFORCE_FAILED]', e?.message || String(e));
            }
          } else if (t === 'guest.kicked') {
            // Host disconnected this guest: tear down our publish and return to
            // watching as a normal viewer. (This is what made the disconnect
            // button appear to "do nothing" before — the guest never reacted.)
            try { setGuestJoinError('You were removed from the stage by the host.'); } catch { /* ignore */ }
            try { leaveAsGuestAndCleanup('kicked_by_host', { force: true }); } catch { /* ignore */ }
          }
        });
        if (!active && sub) { try { sub.close(); } catch { /* ignore */ } }
      } catch (e) {
        console.warn('[IVS_VIEWER][ROOM_EVENTS_SUBSCRIBE_FAILED]', e?.message || String(e));
      }
    })();
    return () => {
      active = false;
      try { sub?.close?.(); } catch { /* ignore */ }
    };
  }, [streamId, uid, applyLocalMedia]);

  // Accept a host-initiated invite: the host already put us in INVITED with a
  // slot, so we can go straight to publishing (no request round-trip).
  const acceptHostInvite = useCallback(async () => {
    const slot = hostInvite?.slotIndex;
    setHostInvite(null);
    try {
      if (typeof slot === 'number') {
        setGuestRequestedSlotId(slot);
        setGuestSlotId(slot);
      }
      if (!guestSessionIdRef.current) {
        const sid = generateGuestSessionId();
        guestSessionIdRef.current = sid;
        setGuestSessionId(sid);
      }
      setGuestRequestStatus('sent');
      await attemptStartGuestPublish();
    } catch (e) {
      setGuestJoinError(e instanceof Error ? e.message : 'Unable to join as guest');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostInvite, attemptStartGuestPublish, generateGuestSessionId]);

  // Surface the host invite as a native prompt with Accept / Not now.
  // Forced seats (paid jump) skip the prompt and publish immediately.
  useEffect(() => {
    if (!hostInvite) return;
    if (hostInvite.force) {
      acceptHostInvite();
      return;
    }
    Alert.alert(
      'Invitation to join',
      'The host invited you to join the live as a guest.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => setHostInvite(null) },
        { text: 'Join', onPress: () => { acceptHostInvite(); } },
      ],
      { cancelable: true, onDismiss: () => setHostInvite(null) }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostInvite]);

  const setNextGuestTrayMode = useCallback((nextMode) => {
    setGuestTrayMode((prev) => {
      const next = typeof nextMode === 'string' ? nextMode : prev;
      // Reset paging to the first page when switching modes (avoids awkward mid-page offsets).
      try {
        guestPagerScrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: false });
      } catch { }
      return next;
    });
  }, []);

  const guestTrayPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => {
        const dx = Math.abs(gesture.dx || 0);
        const dy = Math.abs(gesture.dy || 0);
        // Only capture mostly-vertical gestures so horizontal page swipes keep working.
        return dy > 12 && dy > dx;
      },
      onPanResponderRelease: (_evt, gesture) => {
        const dy = gesture.dy || 0;
        if (dy > 22) {
          // Swipe down: expanded -> collapsed -> hidden
          setGuestTrayMode((prev) => {
            const next = prev === 'expanded' ? 'collapsed' : prev === 'collapsed' ? 'hidden' : 'hidden';
            try {
              guestPagerScrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: false });
            } catch { }
            return next;
          });
        } else if (dy < -22) {
          // Swipe up: hidden -> collapsed -> expanded
          setGuestTrayMode((prev) => {
            const next = prev === 'hidden' ? 'collapsed' : prev === 'collapsed' ? 'expanded' : 'expanded';
            try {
              guestPagerScrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: false });
            } catch { }
            return next;
          });
        }
      },
    })
  ).current;

  const guestStartInFlightRef = useRef(false);
  const guestStartAlertedRef = useRef(false);
  const GUEST_TRAY_HIDDEN_TAB_HEIGHT = 28;
  const GUEST_START_TIMEOUT_MS = 9000;

  const lastGuestResetStreamIdRef = useRef(null);

  // If the viewer navigates to a different stream (or remount reuses the component),
  // never carry guest state across sessions.
  useEffect(() => {
    const prev = lastGuestResetStreamIdRef.current;
    lastGuestResetStreamIdRef.current = streamId || null;
    if (!prev || prev === streamId) {
      return undefined;
    }

    let cancelled = false;

    const reset = async () => {
      try {
        const nativeClient = getIVSNativeClient();
        if (nativeClient && typeof nativeClient.stopGuestSession === 'function') {
          // Defensive: native stop can occasionally hang; never block state reset on it.
          const stopPromise = Promise.resolve(nativeClient.stopGuestSession());
          const timeoutPromise = new Promise((resolve) => {
            const t = setTimeout(() => {
              clearTimeout(t);
              resolve();
            }, 1500);
          });
          await Promise.race([stopPromise, timeoutPromise]);
        }
      } catch (err) {
        console.warn('[IVS_VIEWER][STREAM_CHANGE_STOP_GUEST_FAILED]', err);
      }

      if (cancelled) return;

      guestStartInFlightRef.current = false;
      guestStartAlertedRef.current = false;

      setGuestMode(false);
      guestModeRef.current = false;
      setGuestSlotId(null);
      setGuestRequestedSlotId(null);
      setGuestStageArn(null);
      setGuestToken(null);
      setGuestSessionId(null);
      guestSessionIdRef.current = null;
      setGuestJoinError(null);
      setGuestRequestStatus('idle');
      setSuspendViewerAutoJoin(false);
    };

    if (streamId) {
      reset();
    }

    return () => {
      cancelled = true;
    };
  }, [streamId]);

  const attemptStartGuestPublish = useCallback(async () => {
    if (!streamId) return;
    if (guestModeRef.current) return;
    if (guestStartInFlightRef.current) return;

    guestStartInFlightRef.current = true;
    try {
      const req = await getMyGuestRequest(streamId);
      const status = req?.status;

      if (!status) {
        return;
      }

      if (status === 'REJECTED') {
        setGuestRequestStatus('idle');
        setGuestJoinError('Host declined your request');
        Alert.alert('Request declined', 'Host declined your request to join.');
        if (streamId && uid) clearGuestRequest(streamId, uid);
        return;
      }

      if (status !== 'INVITED' && status !== 'LIVE') {
        // Still waiting for the host to accept.
        return;
      }

      const hasPermissions = await requestCameraAndAudioPermission();
      if (!hasPermissions) {
        setGuestJoinError('Camera and microphone permissions are required to join as a guest.');
        if (!guestStartAlertedRef.current) {
          guestStartAlertedRef.current = true;
          Alert.alert(
            'Permissions required',
            'Enable Camera and Microphone permissions to join as a guest, then tap Join again.'
          );
        }
        return;
      }

      const slotIndex = typeof req?.slotIndex === 'number' ? req.slotIndex : guestSlotId;
      if (typeof slotIndex !== 'number') {
        throw new Error('Guest slot not assigned yet');
      }

      let sid = guestSessionIdRef.current;
      if (!sid) {
        sid = generateGuestSessionId();
        guestSessionIdRef.current = sid;
        setGuestSessionId(sid);
      }

      let guestTokenResp;
      try {
        guestTokenResp = await createGuestToken(streamId, sid);
      } catch (e) {
        // Self-heal stale slot: force leave then retry once.
        const code = e?.code || e?.response?.code;
        const msg = e?.message || '';
        const looksStale = String(code || '').includes('GUEST_SESSION_ACTIVE') || String(msg).toLowerCase().includes('active');
        if (looksStale) {
          await leaveAsGuestAndCleanup('stale_slot_retry', { force: true });
          guestTokenResp = await createGuestToken(streamId, sid);
        } else {
          throw e;
        }
      }

      const { token, stageArn } = guestTokenResp;
      setGuestStageArn(stageArn);
      setGuestToken(token);
      setGuestSlotId(slotIndex);

      // IMPORTANT: Viewer mode uses the same native broadcast module as guest publish.
      // Starting guest while still joined as viewer can implicitly tear down/recreate the stage,
      // which shows up as the host video going black. So we stop the read-only viewer join first.
      setSuspendViewerAutoJoin(true);
      try {
        const leaveFn = ivsSessionRef.current?.leaveStream;
        if (typeof leaveFn === 'function') await leaveFn();
      } catch (leaveErr) {
        console.warn('[IVS_VIEWER][LEAVE_VIEWER_BEFORE_GUEST_FAILED]', leaveErr);
      }

      const nativeClient = getIVSNativeClient();
      const startPromise = nativeClient.startGuestSession({
        sessionId: streamId,
        stageArn,
        token,
        slotIndex,
      });

      // Defensive: if native never invokes the callback, don't leave the UI stuck.
      const timeoutPromise = new Promise((_, reject) => {
        const t = setTimeout(() => {
          clearTimeout(t);
          reject(new Error('Guest start timed out. Tap Retry to try again.'));
        }, GUEST_START_TIMEOUT_MS);
      });

      await Promise.race([startPromise, timeoutPromise]);
      await nativeClient.forceLiveLoudspeaker('guest-join-flow-complete');
      // Fold OEM often snaps earpiece after WebRTC peer connect — reassert past join.
      ;[400, 1200, 2800, 5000].forEach((ms) => {
        setTimeout(() => {
          void nativeClient.forceLiveLoudspeaker(`guest-join-reassert-${ms}`).catch(() => {});
        }, ms);
      });

      guestModeRef.current = true;
      setGuestMode(true);
      setGuestRequestStatus('idle');
      setGuestJoinError(null);
      guestStartAlertedRef.current = false;
      // Request fulfilled — clear the Firestore mirror so it no longer shows
      // as pending on the host.
      clearGuestRequest(streamId, uid);
    } catch (err) {
      console.error('[IVS_VIEWER][GUEST_PUBLISH_ERROR]', err);
      const message = err instanceof Error ? err.message : 'Unable to start guest session';
      setGuestJoinError(message);

      // If the switch to guest mode failed, re-enable viewer auto-join and
      // best-effort rejoin as a viewer so the stream continues playing.
      try {
        setSuspendViewerAutoJoin(false);
        const joinFn = ivsSessionRef.current?.joinStream;
        if (typeof joinFn === 'function') await joinFn();
      } catch (rejoinErr) {
        console.warn('[IVS_VIEWER][GUEST_REJOIN_AS_VIEWER_FAILED]', rejoinErr);
      }

      if (!guestStartAlertedRef.current) {
        guestStartAlertedRef.current = true;
        Alert.alert('Guest publish failed', message);
      }
      // Keep request status as 'sent' so Join can be used to retry publishing.
    } finally {
      guestStartInFlightRef.current = false;
    }
  }, [streamId, guestMode, guestSlotId, generateGuestSessionId, leaveAsGuestAndCleanup]);

  const ivsSession = useIVSViewerSession({
    streamId: streamId || '',
    enabled: !!streamId,
    // Guest publish replaces this read-only session in the singleton native
    // module; suspend auto-join until the guest session ends.
    autoJoin: !suspendViewerAutoJoin && !guestMode,
    displayName: viewerDisplayName,
    // Same Stage the website watches. HLS is a second delayed copy.
    preferPlayback: false,
  });
  const usePlayerWatch =
    !guestMode && ivsSession.viewerTransport === 'playback' && !!NativeIVSPlayerView;

  useEffect(() => {
    ivsSessionRef.current = ivsSession;
    markSurfaceReadyRef.current = ivsSession.markSurfaceReady;
  }, [ivsSession]);

  const handleViewerContainerLayout = useCallback((e) => {
    if (!surfaceReadyMarkedRef.current) {
      surfaceReadyMarkedRef.current = true;
      markSurfaceReadyRef.current?.();
    }
    const { width, height } = e.nativeEvent.layout;
    setLayout((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  // Real guest count = participants on stage excluding the host. Used to gate the
  // guest tray so it only occupies the screen when there's actually someone to show.
  const guestStreamCount = useMemo(() => {
    const streams = ivsSession.visibleStreams || [];
    if (streams.length <= 1) return 0;
    const host = streams.find((s) => s?.isHost) || streams[0] || null;
    return streams.filter(
      (s) => s && s !== host && (!host || !s.participantId || s.participantId !== host.participantId)
    ).length;
  }, [ivsSession.visibleStreams]);

  // Auto-manage the tray on guest-count transitions: open when guests arrive,
  // collapse to full-bleed host when the stage empties. Manual swipes still work
  // within a given guest-count state.
  const prevGuestCountRef = useRef(0);
  useEffect(() => {
    const had = prevGuestCountRef.current;
    if (had === 0 && guestStreamCount > 0) {
      // Keep the default reveal compact; a second row is an explicit swipe up.
      setGuestTrayMode('collapsed');
    } else if (had > 0 && guestStreamCount === 0 && !guestMode) {
      setGuestTrayMode('collapsed');
    }
    prevGuestCountRef.current = guestStreamCount;
  }, [guestStreamCount, guestMode]);

  // When this user goes on stage as a guest, make sure their self-tile is visible.
  useEffect(() => {
    if (guestMode) setGuestTrayMode((prev) => (prev === 'hidden' ? 'collapsed' : prev));
  }, [guestMode]);

  useEffect(() => {
    const mode = normalizeLiveLayoutMode(guestLayoutModeProp);
    if (mode !== LIVE_LAYOUT_MODES.SOLO && mode !== LIVE_LAYOUT_MODES.HOST_TOP_9) return;
    if (typeof onGuestPagerLayout === 'function') onGuestPagerLayout(0);
  }, [guestLayoutModeProp, onGuestPagerLayout]);

  useEffect(() => {
    if (__DEV__) console.log('[IVS_VIEWER][NATIVE_VIEW_CONTAINER_MOUNT]');
    return () => {
      if (__DEV__) console.log('[IVS_VIEWER][NATIVE_VIEW_CONTAINER_UNMOUNT]');
    };
  }, []);

  // Centralized IVS viewer session observability (dev-only — prod log spam janks JS thread).
  useEffect(() => {
    if (!__DEV__) return;
    console.log('[LIVE][IVS_VIEWER_SESSION]', {
      backend: 'ivs',
      streamId,
      connectionState: ivsSession.connectionState,
      networkQuality: ivsSession.networkQuality,
      remoteParticipants: ivsSession.remoteParticipants?.length ?? 0,
      remoteVideoTracks: ivsSession.remoteVideoTracks,
      isReceivingVideo: ivsSession.isReceivingVideo,
      error: ivsSession.error,
      stageArnTail: ivsSession.stageArn ? String(ivsSession.stageArn).slice(-10) : null,
      tokenLength: ivsSession.token ? String(ivsSession.token).length : 0,
      guestMode,
    });
  }, [
    streamId,
    ivsSession.connectionState,
    ivsSession.networkQuality,
    ivsSession.remoteParticipants,
    ivsSession.remoteVideoTracks,
    ivsSession.isReceivingVideo,
    ivsSession.error,
    ivsSession.stageArn,
    ivsSession.token,
    guestMode,
  ]);

  useEffect(() => {
    if (ivsSession.connectionState === 'connected') {
      if (__DEV__) console.log('[IVS_VIEWER][MEDIA_STATE]', {
        connectionState: ivsSession.connectionState,
        remoteParticipants: ivsSession.remoteParticipants.length,
        remoteVideoTracks: ivsSession.remoteVideoTracks,
        isReceivingVideo: ivsSession.remoteVideoTracks > 0,
      });
    }
  }, [ivsSession.connectionState, ivsSession.remoteParticipants.length, ivsSession.remoteVideoTracks]);

  useEffect(() => {
    if (ivsSession.error && isDeadWatchError(ivsSession.error)) {
      console.error('[IVS_VIEWER] Error:', ivsSession.error);
      if (onError && !endedNotifiedRef.current) {
        endedNotifiedRef.current = true;
        onError({ message: ivsSession.error });
      }
      setConnectionStatus('error');
      return;
    }
    if (ivsSession.reconnectExhausted && isDeadWatchError(ivsSession.error)) {
      if (onError && !endedNotifiedRef.current) {
        endedNotifiedRef.current = true;
        onError({ message: ivsSession.error });
      }
      setConnectionStatus('error');
      return;
    }
    if (ivsSession.reconnectExhausted && everConnectedRef.current) {
      // Keep last frame. Transient Stage drops are not "Stream has ended".
      console.warn('[IVS_VIEWER] reconnect exhausted after live connect; staying on last frame');
      setConnectionStatus('connected');
      return;
    }
    if (ivsSession.reconnectExhausted && !everConnectedRef.current) {
      if (onError && !endedNotifiedRef.current) {
        endedNotifiedRef.current = true;
        onError({ message: ivsSession.error || 'connection failed' });
      }
      setConnectionStatus('error');
      return;
    }
    if (ivsSession.connectionState === 'connected') {
      everConnectedRef.current = true;
      setConnectionStatus('connected');
      return;
    }
    if (ivsSession.connectionState === 'disconnected') {
      // Transient stage drop: keep the watch surface and let the session
      // hook re-join. Do not paint "Stream ended".
      setConnectionStatus('connecting');
    }
  }, [ivsSession.error, ivsSession.connectionState, ivsSession.reconnectExhausted, onError]);

  // Track view count on mount/unmount
  useEffect(() => {
    if (!streamId) return;

    let cancelled = false;
    const joinedKey = uid ? `viewer_joined:${streamId}:${uid}` : null;
    const hasDecrementedRef = { current: false };

    const decrementOnce = async (reason) => {
      if (hasDecrementedRef.current) return;
      hasDecrementedRef.current = true;
      if (!joinedKey) return;
      try {
        const existing = await AsyncStorage.getItem(joinedKey);
        if (!existing) return;
        await AsyncStorage.removeItem(joinedKey);
      } catch { }

      try {
        incrementFirestoreViewer(streamId, -1).catch(() => { });
        logStreamingEvent('VIEWER_LEAVE', {
          backendId: 'IVS',
          streamId,
          userId: uid,
          source: `viewer_ui_${reason}`,
        });
      } catch { }
    };

    logStreamingEvent('VIEWER_JOIN', {
      backendId: 'IVS',
      streamId,
      userId: uid,
      source: 'viewer_ui',
    });

    // IVS viewer counts are tracked on streams/{streamId}.viewerCount.
    // This counter can get stuck high if the app is killed before unmount runs.
    // Mitigation: track whether we've already incremented for this stream+uid.
    (async () => {
      if (!joinedKey) {
        incrementFirestoreViewer(streamId, +1).catch(() => { });
        return;
      }
      try {
        const existing = await AsyncStorage.getItem(joinedKey);
        if (cancelled) return;
        if (existing) {
          // We were already counted from a prior session; do not increment again.
          return;
        }
        await AsyncStorage.setItem(joinedKey, String(Date.now()));
      } catch {
        // If storage fails, fall back to old behavior.
      }
      if (!cancelled) {
        incrementFirestoreViewer(streamId, +1).catch(() => { });
      }
    })();

    // Re-add the viewer to the count when the app returns to the foreground and
    // we're still watching. Without this, backgrounding decremented the count
    // but coming back never restored it, so the viewer count drifted too low.
    const reincrementAfterForeground = async () => {
      if (!hasDecrementedRef.current) return;
      hasDecrementedRef.current = false;
      if (cancelled) return;
      if (!joinedKey) {
        incrementFirestoreViewer(streamId, +1).catch(() => { });
        return;
      }
      try {
        await AsyncStorage.setItem(joinedKey, String(Date.now()));
      } catch { }
      if (!cancelled) {
        incrementFirestoreViewer(streamId, +1).catch(() => { });
        logStreamingEvent('VIEWER_JOIN', {
          backendId: 'IVS',
          streamId,
          userId: uid,
          source: 'viewer_ui_foreground',
        });
      }
    };

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        // Best-effort decrement before the process dies.
        decrementOnce('appstate').catch(() => { });
      } else {
        reincrementAfterForeground().catch(() => { });
      }
    });

    return () => {
      cancelled = true;
      try {
        appStateSub?.remove?.();
      } catch { }
      InteractionManager.runAfterInteractions(() => {
        decrementOnce('unmount').catch(() => { });
      });
    };
  }, [streamId, uid]);

  // Keep latest leaveStream function without triggering cleanup on every render
  const leaveStreamRef = useRef(null);
  useEffect(() => {
    leaveStreamRef.current = ivsSession?.leaveStream;
  }, [ivsSession?.leaveStream]);

  // Clean up IVS viewer session ONLY on real unmount (not on re-renders)
  useEffect(() => {
    if (__DEV__) console.log('[IVS_VIEWER][MOUNT] Component initialized');
    return () => {
      InteractionManager.runAfterInteractions(() => {
        if (__DEV__) console.log('[IVS_VIEWER][UNMOUNT] Leaving viewer session');

        // Best-effort cleanup: if we were a guest (or had a pending request), notify backend so
        // re-join doesn't get blocked by a stale LIVE/REQUESTED record.
        try {
          const status = guestRequestStatusRef.current;
          const needsCleanup = guestModeRef.current || status === 'sent' || status === 'sending';
          const sid = guestSessionIdRef.current;
          if (needsCleanup && streamId && sid) {
            leaveGuest(streamId, sid, true).catch((e) => {
              console.warn('[IVS_VIEWER][UNMOUNT_LEAVE_GUEST_FAILED]', e?.message || String(e));
            });

            try {
              const nativeClient = getIVSNativeClient();
              Promise.resolve(nativeClient.stopGuestSession()).catch(() => { });
            } catch { }
          }
        } catch { }

        const leaveFn = leaveStreamRef.current;
        if (typeof leaveFn === 'function') {
          Promise.resolve(leaveFn()).catch((err) => {
            console.error('[IVS_VIEWER][UNMOUNT_LEAVE_ERROR]', err);
          });
        }
      });
    };
  }, []); // Empty deps = mount/unmount only

  const requestToJoinAsGuest = useCallback(
    async (slotId) => {
      if (!streamId) return;
      if (__DEV__) console.log('[IVS_VIEWER][REQUEST_JOIN]', { streamId, slotId, guestRequestStatus, guestMode });
      if (guestRequestStatus === 'sending') return;
      if (guestRequestStatus === 'sent') {
        // Retry publish (cannot re-request due to backend conditional write).
        setGuestJoinError(null);
        await attemptStartGuestPublish();
        return;
      }

      setGuestJoinError(null);
      setSuspendViewerAutoJoin(false);

      try {
        setGuestRequestStatus('sending');
        setGuestRequestedSlotId(slotId);
        setGuestSlotId(slotId);
        guestStartAlertedRef.current = false;

        if (!guestSessionIdRef.current) {
          const sid = generateGuestSessionId();
          guestSessionIdRef.current = sid;
          setGuestSessionId(sid);
        }

        // Create a guest request record. Host must accept before guest-token can be minted.
        await requestGuestSlot(streamId, slotId);
        // While Frenemies is live, also enter the fair FIFO queue (auto-fill on drop).
        // Ignore if Frenemies is not running.
        try {
          await frenemiesQueueJoin(streamId, {
            displayName: viewerDisplayName || undefined,
            source: 'guest_request',
          });
        } catch {
          /* GAME_NOT_FOUND / cooldown — guest request still stands */
        }
        // Mirror the request into Firestore so the host gets a reliable,
        // instant real-time notification (the live-service poll alone proved
        // flaky — host often "never saw" the request). Best-effort.
        // Include the requester's display name so the host prompt can show it
        // immediately (no userId flash while the host resolves the profile).
        mirrorGuestRequest(streamId, { userId: uid, displayName: viewerDisplayName || null, slotIndex: slotId });
        setGuestRequestStatus('sent');
      } catch (err) {
        console.error('[IVS_VIEWER][GUEST_JOIN_ERROR]', err);
        setGuestRequestStatus('error');
        const message = err instanceof Error ? err.message : 'Unable to join as guest';
        setGuestJoinError(message);
        Alert.alert('Guest join failed', message);
      }
    },
    [guestRequestStatus, streamId, attemptStartGuestPublish, generateGuestSessionId]
  );

  // After requesting to join: poll for host approval (INVITED) and only then start guest publishing.
  useEffect(() => {
    if (!streamId) return;
    if (guestMode) return;
    if (guestRequestStatus !== 'sent') return;
    // Slot index can be 0; only guard on non-number.
    if (typeof guestSlotId !== 'number') return;

    let cancelled = false;
    let timer = null;

    const tick = async () => {
      try {
        if (cancelled) return;
        await attemptStartGuestPublish();
      } catch (err) {
        // Keep polling; transient network failures shouldn't break join.
        console.warn('[IVS_VIEWER][GUEST_REQUEST_POLL_ERROR]', err);
      }
    };

    timer = setInterval(() => {
      tick();
    }, 2000);

    // Kick off immediately.
    tick();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [streamId, guestMode, guestRequestStatus, guestSlotId, attemptStartGuestPublish]);

  const leaveGuestMode = useCallback(async () => {
    await leaveAsGuestAndCleanup('user_leave', { force: false });
  }, [leaveAsGuestAndCleanup]);

  // Rendering must bind to the currently-active IVS stage join.
  // When in guestMode we use the guest token (publish+subscribe) to keep receiving remote video.
  const stageArnForSurface = guestMode && guestStageArn ? guestStageArn : ivsSession.stageArn;
  const tokenForSurface = guestMode && guestToken ? guestToken : ivsSession.token;
  const hasStageCredentials = !!stageArnForSurface && !!tokenForSurface;
  const showLoading = connectionStatus === 'connecting' && !ivsSession.canRender && ivsSession.remoteVideoTracks === 0;
  const showError = connectionStatus === 'error';
  const showDisconnected =
    connectionStatus === 'disconnected' && isDeadWatchError(ivsSession.error);

  // Heavy slot/roster derivation can make the JS thread janky when parent re-renders
  // (e.g. hearts/likes). Memoize so it only recomputes when the stream roster/participants
  // or layout mode changes.
  const slotLayout = useMemo(() => {
    if (!NativeIVSRealTimeView || !hasStageCredentials) return null;

    const renderableStreams = ivsSession.visibleStreams || [];

    const hostStream =
      renderableStreams.find((s) => s?.isHost) ||
      renderableStreams.find((s) => typeof s?.slotIndex === 'number' && s.slotIndex === 0) ||
      renderableStreams[0] ||
      null;

    // Exclude host both by object identity AND participantId so duplicates can't
    // render as multiple guest tiles.
    const guestStreams = renderableStreams.filter(
      (s) =>
        s &&
        s !== hostStream &&
        !s.isHost &&
        !(typeof s.slotIndex === 'number' && s.slotIndex === 0) &&
        (!hostStream || !s.participantId || s.participantId !== hostStream.participantId),
    );

    const guestLayoutMode = normalizeLiveLayoutMode(guestLayoutModeProp);
    const guestSlotsTotal = guestBoxesForLayout(guestLayoutMode);
    const useBottomTray = layoutUsesBottomTray(guestLayoutMode);
    const trayDensity =
      guestLayoutMode === LIVE_LAYOUT_MODES.HOST_FOCUS
        ? 'collapsed'
        : guestTrayMode === 'expanded'
          ? 'expanded'
          : 'collapsed';
    const guestsPerPage = useBottomTray && guestTrayMode !== 'hidden' ? guestsPerTrayPage(guestLayoutMode, trayDensity) : 0;

    // Roster mappings: userId <-> slotIndex plus photo.
    const rosterSlotByUser = new Map();
    const userBySlotIndex = new Map();
    const photoByUserId = new Map();
    (guestRoster || []).forEach((g) => {
      if (g && g.userId && typeof g.slotIndex === 'number' && g.slotIndex >= 1) {
        rosterSlotByUser.set(String(g.userId), g.slotIndex);
        userBySlotIndex.set(g.slotIndex, String(g.userId));
      }
      if (g && g.userId) {
        const photo = g.photoUrl || g.photoURL || null;
        if (photo) photoByUserId.set(String(g.userId), String(photo));
      }
    });
    if (uid && selfPhotoUrl) photoByUserId.set(String(uid), String(selfPhotoUrl));

    const effectiveSelfCamOn = selfCamOn && !cameraOffByHost;
    const effectiveSelfMicOn = selfMicOn && !mutedByHost;

    const userByParticipant = new Map();
    (ivsSession.remoteParticipants || []).forEach((p) => {
      if (p && p.participantId && p.userId) userByParticipant.set(p.participantId, String(p.userId));
    });

    // participantId lookup for roster->native stream fallback.
    const participantIdByUserId = new Map();
    userByParticipant.forEach((userId, participantId) => participantIdByUserId.set(userId, participantId));

    // Effective slot for each participant: prefer roster slot, then native slotIndex.
    const effectiveSlotByParticipantId = new Map();
    guestStreams.forEach((s) => {
      if (!s?.participantId) return;
      const userId = userByParticipant.get(s.participantId);
      const rosterSlot = userId ? rosterSlotByUser.get(userId) : undefined;
      const effectiveSlot =
        typeof rosterSlot === 'number'
          ? rosterSlot
          : typeof s.slotIndex === 'number' && s.slotIndex >= 1
            ? s.slotIndex
            : undefined;
      if (typeof effectiveSlot === 'number' && effectiveSlot >= 1) {
        effectiveSlotByParticipantId.set(s.participantId, effectiveSlot);
      }
    });

    const anySlotIndexed = guestStreams.some((s) => effectiveSlotByParticipantId.has(s?.participantId));

    // streamBySlot: O(1) lookups during tile rendering (no find/filter scans).
    const streamBySlot = new Map();
    if (anySlotIndexed) {
      guestStreams.forEach((s) => {
        const slot = effectiveSlotByParticipantId.get(s?.participantId);
        if (typeof slot === 'number' && slot >= 1) streamBySlot.set(slot, s);
      });
    } else {
      const streamByParticipantId = new Map(guestStreams.filter((s) => s?.participantId).map((s) => [s.participantId, s]));
      userBySlotIndex.forEach((rosterUserId, slot) => {
        if (typeof slot !== 'number' || slot < 1) return;
        const pid = participantIdByUserId.get(rosterUserId);
        if (!pid) return;
        const st = streamByParticipantId.get(pid);
        if (st) streamBySlot.set(slot, st);
      });
    }

    // Occupied slots drive tray pagination + join CTA.
    const occupiedSlots = new Set();
    if (typeof guestSlotId === 'number' && guestSlotId >= 1) occupiedSlots.add(guestSlotId);
    effectiveSlotByParticipantId.forEach((slot) => {
      if (typeof slot === 'number' && slot >= 1) occupiedSlots.add(slot);
    });
    userBySlotIndex.forEach((_, slot) => {
      if (typeof slot === 'number' && slot >= 1) occupiedSlots.add(slot);
    });

    const firstEmptySlot = (() => {
      for (let i = 1; i <= guestSlotsTotal; i += 1) {
        if (!occupiedSlots.has(i)) return i;
      }
      return null;
    })();

    const firstJoinSlotId = guestMode ? null : firstEmptySlot;

    // Fluid tray paints only roster/occupied/join-CTA.
    const reservedSlotsForTray = new Set();
    userBySlotIndex.forEach((_, slot) => {
      if (typeof slot === 'number' && slot >= 1) reservedSlotsForTray.add(slot);
    });

    const visibleGuestSlotIds =
      guestsPerPage > 0
        ? buildVisibleGuestSlotIds({
            totalSlots: guestSlotsTotal,
            occupiedSlots,
            reservedSlots: reservedSlotsForTray,
            joinSlotId: firstJoinSlotId,
          })
        : [];

    if (guestsPerPage > 0 && !guestMode && firstJoinSlotId == null && visibleGuestSlotIds.length === 0) {
      visibleGuestSlotIds.push(1);
    }

    const pageCount = guestsPerPage > 0 ? Math.max(1, Math.ceil(Math.max(1, visibleGuestSlotIds.length) / guestsPerPage)) : 0;

    const guestBottomStripHeight = guestTrayMode === 'hidden' ? 0 : 16;

    // slotUserIdBySlot: what user to show in a given slot.
    const slotUserIdBySlot = new Map();
    for (let slot = 1; slot <= guestSlotsTotal; slot += 1) {
      if (guestMode && guestSlotId === slot) {
        if (uid) slotUserIdBySlot.set(slot, uid);
        continue;
      }

      const rosterUserId = userBySlotIndex.get(slot);
      if (rosterUserId) {
        slotUserIdBySlot.set(slot, rosterUserId);
        continue;
      }

      const st = streamBySlot.get(slot);
      if (st?.participantId) {
        const userId = userByParticipant.get(st.participantId);
        if (userId) slotUserIdBySlot.set(slot, userId);
      }
    }

    return {
      hostStream,
      guestStreams,
      guestLayoutMode,
      guestSlotsTotal,
      useBottomTray,
      guestsPerPage,
      visibleGuestSlotIds,
      pageCount,
      firstJoinSlotId,
      guestBottomStripHeight,
      effectiveSelfCamOn,
      effectiveSelfMicOn,
      userBySlotIndex,
      photoByUserId,
      userByParticipant,
      streamBySlot,
      effectiveSlotByParticipantId,
      slotUserIdBySlot,
    };
  }, [
    hasStageCredentials,
    ivsSession.visibleStreams,
    ivsSession.remoteParticipants,
    guestRoster,
    guestLayoutModeProp,
    guestTrayMode,
    guestMode,
    guestSlotId,
    uid,
    selfPhotoUrl,
    selfCamOn,
    cameraOffByHost,
    selfMicOn,
    mutedByHost,
  ]);

  // Real-Time surface fed by viewer session credentials
  // Keep the native views mounted once credentials exist; gate visibility by canRender
  if (usePlayerWatch && NativeIVSPlayerView && !guestMode) {
    return (
      <View
        style={[styles.container, style]}
        onLayout={handleViewerContainerLayout}
      >
        <NativeIVSPlayerView collapsable={false} style={styles.playerView} />
        {showLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.statusText}>Connecting to live...</Text>
          </View>
        )}
        {showError && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.statusText}>This live is no longer available</Text>
          </View>
        )}
        {showDisconnected && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.statusText}>This live is no longer available</Text>
          </View>
        )}
      </View>
    );
  }

  if (NativeIVSRealTimeView && hasStageCredentials && slotLayout) {
    const {
      hostStream,
      guestStreams,
      guestLayoutMode,
      guestSlotsTotal,
      useBottomTray,
      guestsPerPage,
      visibleGuestSlotIds,
      pageCount,
      firstJoinSlotId,
      guestBottomStripHeight,
      effectiveSelfCamOn,
      effectiveSelfMicOn,
      userBySlotIndex,
      photoByUserId,
      userByParticipant,
      streamBySlot,
      effectiveSlotByParticipantId,
      slotUserIdBySlot,
    } = slotLayout;

    const renderableStreams = ivsSession.visibleStreams || [];
    const hasRenderableStreams = renderableStreams.length > 0;

    if (
      Platform.OS !== 'android' &&
      guestsPerPage > 0 &&
      prevVisibleGuestCountRef.current !== visibleGuestSlotIds.length
    ) {
      LayoutAnimation.configureNext(GUEST_TRAY_LAYOUT_ANIM);
      prevVisibleGuestCountRef.current = visibleGuestSlotIds.length;
    }

    // Coins gifted to a given user THIS stream (session tally from gift_event / server snapshot).
    const coinsForUser = (userId) => coinsFromGiftTotals(giftTotalsByUser, userId);
    // TikTok-style 1v1 battle: host | opponent side-by-side, no guest tray.
    if (battleMode) {
      const opponentStream = guestStreams[0] || null;
      const opponentUserId = opponentStream
        ? userByParticipant.get(opponentStream.participantId)
        : null;
      return (
        <View
          style={[styles.container, style]}
          onLayout={handleViewerContainerLayout}
        >
          <View style={styles.battleStage}>
            <View style={styles.battlePane}>
              <View pointerEvents="none" style={styles.battleEdgeLeft} />
              {hostStream ? (
                <NativeIVSRealTimeView
                  style={styles.realTimeView}
                  stageArn={stageArnForSurface}
                  token={tokenForSurface}
                  sessionId={streamId}
                  slotId={0}
                  participantId={hostStream.participantId}
                  remoteTrackCount={1}
                  zoom={1.0}
                  testID="ivs-realtime-battle-host"
                />
              ) : (
                <View style={styles.hostPlaceholder}>
                  <Text style={styles.placeholderText}>Waiting for host…</Text>
                </View>
              )}
              <TileCoinBadge coins={coinsForUser(hostUid)} style={tileCoinPositions.host} />
            </View>
            <View style={styles.battlePane}>
              <View pointerEvents="none" style={styles.battleEdgeRight} />
              {opponentStream ? (
                <NativeIVSRealTimeView
                  style={styles.realTimeView}
                  stageArn={stageArnForSurface}
                  token={tokenForSurface}
                  sessionId={streamId}
                  slotId={
                    typeof effectiveSlotByParticipantId.get(opponentStream.participantId) === 'number'
                      ? effectiveSlotByParticipantId.get(opponentStream.participantId)
                      : 1
                  }
                  participantId={opponentStream.participantId}
                  remoteTrackCount={1}
                  zoom={1.0}
                  testID="ivs-realtime-battle-opponent"
                />
              ) : (
                <View style={styles.battleWaiting}>
                  <Text style={styles.placeholderText}>Waiting for opponent…</Text>
                </View>
              )}
              <TileCoinBadge coins={coinsForUser(opponentUserId)} style={tileCoinPositions.guest} />
            </View>
          </View>
          {guestMode && (
            <View style={[styles.guestModeBanner, { top: 12 }]}>
              <Text style={styles.guestModeText}>On stage</Text>
              <View style={styles.guestMediaControls}>
                <TouchableOpacity
                  style={[styles.guestMediaBtn, (!selfMicOn || mutedByHost) && styles.guestMediaBtnOff]}
                  onPress={toggleSelfMic}
                >
                  <Icon name={(!selfMicOn || mutedByHost) ? 'mic-off' : 'mic'} size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.guestMediaBtn, (!selfCamOn || cameraOffByHost) && styles.guestMediaBtnOff]}
                  onPress={toggleSelfCam}
                >
                  <Icon name={(!selfCamOn || cameraOffByHost) ? 'videocam-off' : 'videocam'} size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.leaveGuestButton} onPress={leaveGuestMode}>
                  <Text style={styles.leaveGuestText}>Leave</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      );
    }

    const isQueuedJoin = guestRequestStatus === 'sent' && !guestJoinError;
    const isSendingJoin = guestRequestStatus === 'sending';
    const isSolo = guestLayoutMode === LIVE_LAYOUT_MODES.SOLO;
    const isHostTop9 = guestLayoutMode === LIVE_LAYOUT_MODES.HOST_TOP_9;

    const composeSide = guestLayoutMode === LIVE_LAYOUT_MODES.SIDE_BY_SIDE;
    const composeEqual = guestLayoutMode === LIVE_LAYOUT_MODES.EQUAL_GRID;
    // Solo / Host+9 used to early-return a different tree, which remounted
    // NativeIVSRealTimeView (new native tag) and left the SDK preview black
    // until leave+rejoin. Keep slot 0 in this tree; only restyle the pane.
    const renderHostTop9Grid = () => (
      <View style={styles.hostTop9Grid}>
        {[0, 1, 2].map((row) => (
          <View key={`host-top-9-row-${row}`} style={styles.hostTop9Row}>
            {[0, 1, 2].map((col) => {
              const globalSlotId = row * 3 + col + 1;
              const stream =
                !(guestMode && guestSlotId === globalSlotId)
                  ? streamBySlot.get(globalSlotId) || null
                  : null;
              const tileUserId =
                guestMode && guestSlotId === globalSlotId
                  ? uid
                  : slotUserIdBySlot.get(globalSlotId) || null;
              const isSelfTile = !!(guestMode && guestSlotId === globalSlotId);
              const remoteCamOff = !!(stream && stream.isCameraDisabled);
              const showAvatar =
                (isSelfTile && !effectiveSelfCamOn) || (!isSelfTile && remoteCamOff);
              const isJoinBox = !guestMode && globalSlotId === firstJoinSlotId;
              return (
                <View key={`host-top-9-${globalSlotId}`} style={styles.hostTop9Tile}>
                  <View pointerEvents="none" style={styles.hostTop9Rank}>
                    <Text style={styles.hostTop9RankText}>{globalSlotId}</Text>
                  </View>
                  <TileCoinBadge coins={coinsForUser(tileUserId)} style={tileCoinPositions.guest} />
                  {tileUserId ? (
                    <Text style={styles.hostTop9User} numberOfLines={1} allowFontScaling={false}>
                      {pickPublicLabel(
                        (guestRoster || []).find((g) => String(g?.userId) === String(tileUserId)) || {},
                        { uid: tileUserId, fallback: '' },
                      )}
                    </Text>
                  ) : null}
                  {isSelfTile ? (
                    NativeIVSBroadcastView ? (
                      <View style={styles.tileVideoSurface}>
                        {!showAvatar ? (
                          <NativeIVSBroadcastView zoom={GUEST_TILE_ZOOM} style={StyleSheet.absoluteFill} />
                        ) : null}
                      </View>
                    ) : (
                      <View style={styles.tilePlaceholder}>
                        <Text style={styles.placeholderText}>Camera unavailable</Text>
                      </View>
                    )
                  ) : stream && !showAvatar ? (
                    <NativeIVSRealTimeView
                      collapsable={false}
                      style={styles.realTimeView}
                      stageArn={stageArnForSurface}
                      token={tokenForSurface}
                      sessionId={streamId}
                      slotId={globalSlotId}
                      participantId={stream.participantId}
                      remoteTrackCount={1}
                      zoom={GUEST_TILE_ZOOM}
                      testID={`ivs-realtime-host-top-9-guest-${globalSlotId}`}
                    />
                  ) : isJoinBox ? (
                    <TouchableOpacity
                      style={[styles.joinTile, isQueuedJoin && styles.joinTileQueued]}
                      activeOpacity={0.85}
                      onPress={() => requestToJoinAsGuest(globalSlotId)}
                      disabled={isSendingJoin || isQueuedJoin}
                    >
                      <Text style={[styles.joinLabelText, isQueuedJoin && styles.joinLabelTextQueued]}>
                        {isSendingJoin ? 'REQUESTING…' : isQueuedJoin ? 'IN QUEUE' : guestJoinError ? 'RETRY' : 'JOIN'}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.emptyTile}>
                      <View style={styles.emptyTileInner} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
    const renderComposeGuestSlots = () => (
      <ScrollView
        style={styles.composeGuestScroll}
        contentContainerStyle={composeSide ? styles.composeGuestCol : styles.composeGuestGrid}
        showsVerticalScrollIndicator={false}
      >
        {Array.from({ length: guestSlotsTotal }, (_, i) => {
          const globalSlotId = i + 1;
          const stream = !(guestMode && guestSlotId === globalSlotId) ? streamBySlot.get(globalSlotId) || null : null;
          const tileUserId =
            guestMode && guestSlotId === globalSlotId ? uid : slotUserIdBySlot.get(globalSlotId) || null;
          const isSelfTile = !!(guestMode && guestSlotId === globalSlotId);
          const remoteCamOff = !!(stream && stream.isCameraDisabled);
          const showAvatar =
            (isSelfTile && !effectiveSelfCamOn) || (!isSelfTile && remoteCamOff);
          return (
            <View
              key={`viewer-compose-slot-${globalSlotId}`}
              style={composeSide ? styles.composeTileSide : styles.composeTileEqual}
            >
              <TileCoinBadge coins={coinsForUser(tileUserId)} style={tileCoinPositions.guest} />
              {isSelfTile ? (
                NativeIVSBroadcastView ? (
                  <View style={styles.tileVideoSurface}>
                    {!showAvatar ? (
                      <NativeIVSBroadcastView zoom={GUEST_TILE_ZOOM} style={StyleSheet.absoluteFill} />
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.tilePlaceholder}>
                    <Text style={styles.placeholderText}>Camera unavailable</Text>
                  </View>
                )
              ) : stream && !showAvatar ? (
                <NativeIVSRealTimeView
                  style={styles.realTimeView}
                  stageArn={stageArnForSurface}
                  token={tokenForSurface}
                  sessionId={streamId}
                  slotId={globalSlotId}
                  participantId={stream.participantId}
                  remoteTrackCount={1}
                  zoom={GUEST_TILE_ZOOM}
                  testID={`ivs-realtime-compose-guest-${globalSlotId}`}
                />
              ) : (
                <View style={styles.emptyTile}>
                  <View style={styles.emptyTileInner} />
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    );

    return (
      <View
        style={[styles.container, style]}
        onLayout={(e) => {
          handleViewerContainerLayout(e);
          if (typeof onGuestPagerLayout === 'function') onGuestPagerLayout(0);
        }}
      >
        {/* Host stays prominent + fixed; only guests page (or compose for Equal/Split). */}
        <View
          style={[
            styles.hostStage,
            isHostTop9 ? styles.hostTop9Stage : null,
            composeSide ? styles.composeSide : null,
            composeEqual ? styles.composeEqual : null,
          ]}
        >
          <View
            collapsable={false}
            style={
              isHostTop9
                ? [
                    styles.hostTop9HostBand,
                    hostBandHeight ? { height: hostBandHeight, aspectRatio: undefined } : null,
                  ]
                : composeSide
                  ? styles.composeHostPaneSide
                  : composeEqual
                    ? styles.composeHostPaneEqual
                    : StyleSheet.absoluteFill
            }
          >
            {hostStream ? (
              <NativeIVSRealTimeView
                collapsable={false}
                style={styles.realTimeView}
                stageArn={stageArnForSurface}
                token={tokenForSurface}
                sessionId={streamId}
                slotId={0}
                participantId={hostStream.participantId}
                remoteTrackCount={1}
                zoom={1.0}
                contentFit={isSolo ? 'cover' : 'contain'}
                testID={
                  isSolo
                    ? 'ivs-realtime-solo-host'
                    : isHostTop9
                      ? 'ivs-realtime-host-top-9'
                      : 'ivs-realtime-viewer-host'
                }
              />
            ) : (
              <View style={styles.hostPlaceholder}>
                <Text style={styles.placeholderText}>Waiting for host…</Text>
              </View>
            )}

            <TileCoinBadge coins={coinsForUser(hostUid)} style={tileCoinPositions.host} />

            {isHostTop9 ? (
              <View pointerEvents="box-none" style={styles.hostTop9HostHud}>
                {typeof onHostPress === 'function' ? (
                  <TouchableOpacity
                    style={StyleSheet.absoluteFill}
                    activeOpacity={1}
                    onPress={onHostPress}
                  />
                ) : null}
                <View style={styles.hostTop9Goal} pointerEvents="none">
                  <Text style={styles.hostTop9GoalLabel} numberOfLines={1} allowFontScaling={false}>
                    {liveGoal?.label || 'Live Goal'}
                  </Text>
                  <View style={styles.hostTop9GoalTrack}>
                    <View
                      style={[
                        styles.hostTop9GoalFill,
                        { width: `${Math.min(100, Math.max(0, Number(liveGoal?.pct) || 0))}%` },
                      ]}
                    />
                  </View>
                </View>
                {giftAlert?.name ? (
                  <View style={styles.hostTop9GiftPill} pointerEvents="none">
                    <Text style={styles.hostTop9GiftPillText} numberOfLines={1} allowFontScaling={false}>
                      {`${giftAlert.name} sent ${giftAlert.gift || 'a gift'}`}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.hostTop9HostMeta} pointerEvents="box-none">
                  <View style={styles.hostTop9Eye} pointerEvents="none">
                    <Icon name="eye" size={12} color="#fff" />
                    <Text style={styles.hostTop9EyeText} allowFontScaling={false}>
                      {Number(watchViewCount) || 0}
                    </Text>
                  </View>
                  {typeof onToggleFullscreen === 'function' ? (
                    <TouchableOpacity
                      style={styles.hostTop9Fs}
                      onPress={onToggleFullscreen}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name={hostExpanded ? 'remove' : 'add'} size={14} color="#fff" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}

            {guestMode && (
              <View style={styles.guestModeBanner}>
                <Text style={styles.guestModeText}>Guest mode</Text>
                <View style={styles.guestMediaControls}>
                  <TouchableOpacity
                    style={[styles.guestMediaBtn, (!selfMicOn || mutedByHost) && styles.guestMediaBtnOff]}
                    onPress={toggleSelfMic}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon
                      name={(!selfMicOn || mutedByHost) ? 'mic-off' : 'mic'}
                      size={16}
                      color="#fff"
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.guestMediaBtn, (!selfCamOn || cameraOffByHost) && styles.guestMediaBtnOff]}
                    onPress={toggleSelfCam}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon
                      name={(!selfCamOn || cameraOffByHost) ? 'videocam-off' : 'videocam'}
                      size={16}
                      color="#fff"
                    />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.leaveGuestButton} onPress={leaveGuestMode}>
                    <Text style={styles.leaveGuestText}>Leave guest</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {!!guestJoinError && (
              <View style={styles.guestErrorBanner}>
                <Text style={styles.guestErrorText}>{guestJoinError}</Text>
              </View>
            )}
          </View>
          {isHostTop9 && !hostExpanded ? renderHostTop9Grid() : null}
          {(composeSide || composeEqual) ? (
            <View style={composeSide ? styles.composeGuestPaneSide : styles.composeGuestPaneEqual}>
              {renderComposeGuestSlots()}
            </View>
          ) : null}
        </View>
        {isSolo && !guestMode ? (
          <TouchableOpacity
            style={[styles.soloJoinChip, isQueuedJoin && styles.joinTileQueued]}
            activeOpacity={0.85}
            onPress={() => requestToJoinAsGuest(1)}
            disabled={isSendingJoin || isQueuedJoin}
          >
            <Text style={[styles.soloJoinChipText, isQueuedJoin && styles.joinLabelTextQueued]}>
              {isSendingJoin ? 'REQUESTING…' : isQueuedJoin ? 'IN QUEUE' : guestJoinError ? 'RETRY' : 'JOIN'}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/*
          Fill the small gap between guest tiles and the comments bar with the header/theme color.
          Keeps the guest area itself transparent (no blue behind tiles).
        */}
        {useBottomTray && overlayBottomInset > 0 && guestBottomStripHeight > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.guestBottomStrip,
              { bottom: overlayBottomInset || 0, height: guestBottomStripHeight },
            ]}
          />
        )}

        {useBottomTray ? (
        <View
          {...guestTrayPanResponder.panHandlers}
          style={[
            styles.guestPager,
            overlayBottomInset ? { bottom: overlayBottomInset } : null,
            guestTrayMode === 'hidden'
              ? { height: GUEST_TRAY_HIDDEN_TAB_HEIGHT, paddingBottom: 0 }
              : guestGridHeight
                ? { height: guestGridHeight + 16 }
                : null,
          ]}
          onLayout={(e) => {
            if (guestTrayMode === 'hidden') {
              setGuestPagerMeasuredHeight(GUEST_TRAY_HIDDEN_TAB_HEIGHT);
              if (typeof onGuestPagerLayout === 'function') {
                onGuestPagerLayout(GUEST_TRAY_HIDDEN_TAB_HEIGHT);
              }
              return;
            }
            const h = e?.nativeEvent?.layout?.height || 0;
            setGuestPagerMeasuredHeight(h);
            if (typeof onGuestPagerLayout === 'function') {
              onGuestPagerLayout(h);
            }
          }}
        >
          {guestTrayMode === 'hidden' ? (
              <View style={styles.hiddenTrayHandle} pointerEvents="none">
              <View style={styles.hiddenTrayPill} />
              <Text style={styles.hiddenTrayText}>SWIPE UP</Text>
            </View>
          ) : (
            <ScrollView
              ref={guestPagerScrollRef}
              contentContainerStyle={styles.guestPagerContent}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEnabled={pageCount > 1}
            >
              {Array.from({ length: pageCount }, (_, pageIdx) => {
                const pageSlotIds = visibleGuestSlotIds.slice(
                  pageIdx * guestsPerPage,
                  pageIdx * guestsPerPage + guestsPerPage
                );
                // Always show at least the join tile on page 0 when nothing else yet.
                const slotsOnPage =
                  pageSlotIds.length > 0
                    ? pageSlotIds
                    : pageIdx === 0 && firstJoinSlotId
                      ? [firstJoinSlotId]
                      : pageIdx === 0
                        ? [1]
                        : [];
                const pageVisibleCount = Math.max(1, slotsOnPage.length);
                const tileWidthPct = guestTileWidthPercent(pageVisibleCount);
                const tileMarginPct = guestTileHorizontalMarginPercent(pageVisibleCount);
                const tileBaseStyle = {
                  width: `${tileWidthPct}%`,
                  marginHorizontal: `${tileMarginPct}%`,
                };
                return (
                  <View key={`guest-page-${pageIdx}`} style={[styles.guestPage, { width: layout.width || undefined }]}>
                    <View style={styles.guestPageInner}>
                      <View
                        style={guestTrayMode === 'collapsed' ? styles.guestGridCollapsed : styles.guestGrid}
                        onLayout={(e) => {
                          const h = e?.nativeEvent?.layout?.height || 0;
                          if (h) setGuestGridHeight(h);
                        }}
                      >
                        {slotsOnPage.map((globalSlotId) => {
                          // Place the guest whose host-assigned slotIndex matches this box,
                          // so the same guest lands in the same box on host + every viewer.
                          const stream = !(guestMode && guestSlotId === globalSlotId) ? streamBySlot.get(globalSlotId) || null : null;
                          const tileUserId =
                            guestMode && guestSlotId === globalSlotId ? uid : slotUserIdBySlot.get(globalSlotId) || null;
                          const isSelfTile = !!(guestMode && guestSlotId === globalSlotId);
                          const tilePhoto =
                            (tileUserId && photoByUserId.get(String(tileUserId))) || null;
                          const remoteCamOff = !!(stream && stream.isCameraDisabled);
                          const showAvatar =
                            (isSelfTile && !effectiveSelfCamOn) || (!isSelfTile && remoteCamOff);
                          const showMicOff =
                            (isSelfTile && !effectiveSelfMicOn) || (!!(stream && stream.isMuted));

                          return (
                            <View
                              key={stream?.streamKey || stream?.participantId || `guest-slot-${globalSlotId}`}
                              style={[
                                guestTrayMode === 'collapsed' ? styles.guestTileSquareCollapsed : styles.guestTileSquare,
                                tileBaseStyle,
                              ]}
                            >
                              <TileCoinBadge coins={coinsForUser(tileUserId)} style={tileCoinPositions.guest} />
                              {isSelfTile ? (
                                NativeIVSBroadcastView ? (
                                  <View style={styles.tileVideoSurface}>
                                    {!showAvatar ? (
                                      <NativeIVSBroadcastView zoom={GUEST_TILE_ZOOM} style={StyleSheet.absoluteFill} />
                                    ) : null}
                                  </View>
                                ) : (
                                  <View style={styles.tilePlaceholder}>
                                    <Text style={styles.placeholderText}>Camera unavailable</Text>
                                  </View>
                                )
                              ) : stream ? (
                                showAvatar ? (
                                  <View style={[styles.tileVideoSurface, styles.camOffFill]} />
                                ) : (
                                  <View style={styles.tileVideoSurface}>
                                    <NativeIVSRealTimeView
                                      style={styles.realTimeView}
                                      stageArn={stageArnForSurface}
                                      token={tokenForSurface}
                                      sessionId={streamId}
                                      slotId={globalSlotId}
                                      participantId={stream.participantId}
                                      remoteTrackCount={1}
                                      zoom={GUEST_TILE_ZOOM}
                                      testID={`ivs-realtime-viewer-guest-${globalSlotId}`}
                                    />
                                    {!stream.hasFirstFrame ? (
                                      <View style={styles.joiningOverlay} pointerEvents="none">
                                        <ReservedGuestTile
                                          photoUrl={tilePhoto}
                                          label="Joining…"
                                          style={StyleSheet.absoluteFill}
                                        />
                                      </View>
                                    ) : null}
                                  </View>
                                )
                              ) : userBySlotIndex.has(globalSlotId) ? (
                                <ReservedGuestTile photoUrl={tilePhoto} label="Joining…" />
                              ) : (
                                globalSlotId === firstJoinSlotId ? (
                                  (() => {
                                    const isQueued = guestRequestStatus === 'sent' && !guestJoinError;
                                    const isSending = guestRequestStatus === 'sending';
                                    return (
                                      <TouchableOpacity
                                        style={[styles.joinTile, isQueued && styles.joinTileQueued]}
                                        activeOpacity={0.85}
                                        onPress={() => requestToJoinAsGuest(globalSlotId)}
                                        disabled={isSending || isQueued}
                                      >
                                        <View style={[styles.joinPlusCircle, isQueued && styles.joinPlusCircleQueued]}>
                                          {isQueued ? (
                                            <Icon name="time-outline" size={18} color="#0A0A0C" />
                                          ) : (
                                            <Text style={styles.joinPlusText}>+</Text>
                                          )}
                                        </View>
                                        <Text style={[styles.joinLabelText, isQueued && styles.joinLabelTextQueued]}>
                                          {isSending
                                            ? 'REQUESTING…'
                                            : isQueued
                                              ? 'IN QUEUE'
                                              : guestJoinError
                                                ? 'RETRY'
                                                : 'JOIN'}
                                        </Text>
                                      </TouchableOpacity>
                                    );
                                  })()
                                ) : (
                                  <View style={styles.emptyTile}>
                                    <View style={styles.emptyTileInner} />
                                  </View>
                                )
                              )}

                              {showAvatar ? (
                                <View style={styles.camOffAvatarOverlay} pointerEvents="none">
                                  {tilePhoto ? (
                                    <Image source={{ uri: tilePhoto }} style={styles.camOffAvatar} />
                                  ) : (
                                    <View style={styles.camOffAvatarFallback}>
                                      <Icon name="person" size={28} color="rgba(255,255,255,0.85)" />
                                    </View>
                                  )}
                                </View>
                              ) : null}

                              {showMicOff ? (
                                <View style={styles.micOffBadge} pointerEvents="none">
                                  <Icon name="mic-off" size={12} color="#fff" />
                                </View>
                              ) : null}

                              {isSelfTile ? (
                                <View style={styles.selfTileControls}>
                                  <TouchableOpacity
                                    style={[styles.selfTileBtn, !effectiveSelfMicOn && styles.selfTileBtnOff]}
                                    onPress={toggleSelfMic}
                                  >
                                    <Icon name={effectiveSelfMicOn ? 'mic' : 'mic-off'} size={14} color="#fff" />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[styles.selfTileBtn, !effectiveSelfCamOn && styles.selfTileBtnOff]}
                                    onPress={toggleSelfCam}
                                  >
                                    <Icon name={effectiveSelfCamOn ? 'videocam' : 'videocam-off'} size={14} color="#fff" />
                                  </TouchableOpacity>
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
        ) : (
          // Equal / Split: guest chrome lives in the stage composition.
          typeof onGuestPagerLayout === 'function' ? (
            <View
              style={{ height: 0 }}
              onLayout={() => {
                setGuestPagerMeasuredHeight(0);
                onGuestPagerLayout(0);
              }}
            />
          ) : null
        )}
        {!hasRenderableStreams && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.statusText}>Preparing video...</Text>
            {__DEV__ && (
              <View style={styles.debugOverlay}>
                <Text style={styles.debugText}>Stage: {ivsSession.stageArn}</Text>
                <Text style={styles.debugText}>Session: {streamId}</Text>
                <Text style={styles.debugText}>Status: {ivsSession.connectionState}</Text>
                <Text style={styles.debugText}>Surface ready: {ivsSession.surfaceReady ? 'yes' : 'no'}</Text>
                <Text style={styles.debugText}>First frame: {ivsSession.firstFrameSeen ? 'yes' : 'no'}</Text>
                <Text style={styles.debugText}>Remote video tracks: {ivsSession.remoteVideoTracks}</Text>
                <Text style={styles.debugText}>Visible streams: {renderableStreams.length}</Text>
              </View>
            )}
          </View>
        )}
        {showLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.statusText}>Connecting to live stream...</Text>
          </View>
        )}
        {showError && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.errorText}>Failed to connect to stream</Text>
            <Text style={styles.statusText}>{ivsSession.error}</Text>
          </View>
        )}
        {showDisconnected && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.statusText}>This live is no longer available</Text>
          </View>
        )}
      </View>
    );
  }

  // HLS only when this session actually joined playback.
  if (usePlayerWatch && NativeIVSPlayerView) {
    return (
      <View style={[styles.container, style]}>
        <NativeIVSPlayerView style={styles.playerView} />
      </View>
    );
  }

  // Fallback: Show connected status with debug info
  return (
    <View style={[styles.container, style]}>
      <View style={styles.connectedPlaceholder}>
        <Text style={styles.connectedTitle}>
          {NativeIVSRealTimeView ? '⏳ Stream Loading...' : '❌ Error'}
        </Text>
        <Text style={styles.connectedSubtitle}>
          {!NativeIVSRealTimeView && 'Real-Time view not available on this platform'}
          {NativeIVSRealTimeView && !hasStageCredentials && 'Fetching stream credentials...'}
          {NativeIVSRealTimeView && hasStageCredentials && ivsSession.connectionState !== 'connected' && `Connection: ${ivsSession.connectionState}`}
          {NativeIVSRealTimeView && hasStageCredentials && ivsSession.connectionState === 'connected' && ivsSession.remoteVideoTracks === 0 && 'Waiting for broadcaster...'}
        </Text>
        <View style={styles.connectionInfo}>
          <Text style={styles.infoLabel}>Stream ID</Text>
          <Text style={styles.infoValue}>{streamId}</Text>
          <Text style={styles.infoLabel}>Connection State</Text>
          <Text style={styles.infoValue}>{ivsSession.connectionState}</Text>
          <Text style={styles.infoLabel}>Participants</Text>
          <Text style={styles.infoValue}>Connecting...</Text>
        </View>
      </View>
    </View>
  );
};

/**
 * HLS Live Stream Viewer (Legacy)
 * Uses segmented HLS playback
 */
const HLSLiveStreamViewer = ({ streamId, onError, style }) => {
  const { uid } = useAuth();
  const videoRef = useRef(null);
  const secondaryVideoRef = useRef(null);
  const [playbackUrl, setPlaybackUrl] = useState(null);

  // TikTok-style state management
  const [currentSegment, setCurrentSegment] = useState(-1);
  const [segmentBuffer, setSegmentBuffer] = useState(new Map());
  const [isBuffering, setIsBuffering] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [streamData, setStreamData] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  // Advanced playback management
  const unsubscribeRef = useRef(null);
  const playbackQueueRef = useRef([]);
  const lastSegmentTimeRef = useRef(0);
  const retryCountRef = useRef(0);
  const activeVideoRef = useRef('primary');
  const segmentTimeoutRef = useRef(null);
  const stallCheckRef = useRef(null);
  const lastPlaybackSegmentRef = useRef(-1);
  const variantsRef = useRef([]); // master playlist variants
  const chosenQualityRef = useRef(null); // current quality label
  const adaptationIntervalRef = useRef(null);
  const lastQualitySwitchRef = useRef(0);
  const stallCounterRef = useRef(createSlidingWindowCounter(15000)); // 15s window
  const lastEstimatorEmitRef = useRef(0); // throttle ABR estimator analytics

  // TikTok-style segment subscription with intelligent buffering
  useEffect(() => {
    if (!streamId) return;

    if (__DEV__) console.log(`🎬 TikTok-style viewer initializing for stream ${streamId}`);
    setConnectionStatus('connecting');

    // Log viewer subscribe request
    logStreamingEvent('VIEWER_SUBSCRIBE_REQUEST', {
      backendId: 'HLS',
      streamId,
      userId: uid || null,
      source: 'viewer_ui',
    });

    // Subscribe to stream updates via streaming backend
    const backend = getStreamingBackend();
    unsubscribeRef.current = backend.subscribeToStream(streamId, async (snapshot) => {
      // Backend returns ViewerStreamSnapshot | null
      const data = snapshot;
      if (!data) {
        console.log('📡 Stream ended or connection lost');
        setConnectionStatus('ended');
        logStreamingEvent('VIEWER_SUBSCRIBE_END', {
          backendId: 'HLS',
          streamId,
          source: 'viewer_ui',
        });
        handleStreamEnd();
        return; // End early when stream data unavailable
      }

      // Log first successful snapshot (status=live)
      if (connectionStatus === 'connecting' && data.status === 'live') {
        logStreamingEvent('VIEWER_SUBSCRIBE_SNAPSHOT', {
          backendId: 'HLS',
          streamId,
          status: 'live',
          viewerCount: data.viewCount,
          source: 'viewer_ui',
        });
      }

      setStreamData(data);

      if (data.status === 'ended' || data.isLive === false) {
        console.log('📡 Stream marked ended in snapshot');
        setConnectionStatus('ended');
        logStreamingEvent('VIEWER_SUBSCRIBE_END', {
          backendId: 'HLS',
          streamId,
          status: data.status || 'ended',
          source: 'viewer_ui',
        });
        handleStreamEnd();
        return;
      }

      setConnectionStatus('connected');

      // Capture playback URL if provided by backend
      if (data?.playbackUrl) {
        console.log('[LiveStreamViewer][PLAYBACK_URL] Received:', {
          playbackUrl: data.playbackUrl,
          status: data.status,
          streamId: data.streamId,
        });
        setPlaybackUrl(data.playbackUrl);
      } else {
        console.warn('[LiveStreamViewer][NO_PLAYBACK_URL]', {
          streamId,
          status: data?.status,
          dataKeys: data ? Object.keys(data) : 'null',
        });
      }

      // TikTok-style intelligent segment management
      if (data.currentSegment >= 0) {
        const latestSegment = data.currentSegment;
        // Prefer adapter window (subcollection) fallback to legacy map
        const windowSegments = await StreamSegmentsAdapter.getWindow(streamId, 5);
        const newBuffer = new Map();
        windowSegments.forEach(s => newBuffer.set(s.number, { ...s, timestamp: Date.now() }));
        setSegmentBuffer(newBuffer);
        if (currentSegment === -1 && latestSegment >= 0) {
          // Initial playback start should not reference a quality adaptation decision yet.
          // Cooldown logic applies only to subsequent quality switches handled in adaptation loop.
          setCurrentSegment(Math.max(0, latestSegment - 1));
          startPlayback();
        }
        // Manifest feature flag instrumentation (transitional)
        if (isManifestEnabled()) {
          try {
            let manifest = await ManifestService.generateLocalManifest(streamId);
            // Attempt remote master playlist fetch if playlist viewer mode enabled
            if (isPlaylistViewerEnabled()) {
              const remoteMaster = await PlaylistFetchService.getMaster(streamId);
              if (remoteMaster) {
                EnterpriseAnalyticsService.addEvent({ type: 'playlist_master_fetched', streamId, timestamp: Date.now() });
                lastQualitySwitchRef.current = Date.now();
                // For now choose first variant listed or fallback to local manifest
                const masterParsed = PlaylistParserService.parseMaster(remoteMaster);
                variantsRef.current = masterParsed.variants || [];
                let chosenQuality = null;
                let networkType = 'unknown';
                try {
                  const state = await NetInfo.fetch();
                  networkType = state?.type || 'unknown';
                } catch { }
                try {
                  chosenQuality = QualitySelectionService.chooseQuality(masterParsed.variants, networkType);
                } catch { }
                const variantToUse = chosenQuality || masterParsed.variants[0]?.playlist;
                if (variantToUse) {
                  const qualityContent = await PlaylistFetchService.getQuality(streamId, variantToUse.replace('.m3u8', ''));
                  if (qualityContent) {
                    manifest = qualityContent; // treat quality playlist as playable segment list
                    chosenQualityRef.current = variantToUse.replace('.m3u8', '');
                    EnterpriseAnalyticsService.addEvent({
                      type: 'playlist_quality_selected',
                      streamId,
                      quality: variantToUse.replace('.m3u8', ''),
                      experimentId: getFeatureFlags().playlistExperimentId,
                      timestamp: Date.now()
                    });
                  }
                }
              }
            }
            EnterpriseAnalyticsService.addEvent({
              type: 'manifest_generated_local',
              streamId,
              length: manifest ? manifest.split('\n').length : 0,
              timestamp: Date.now()
            });
            // Optional playlist viewer mode: parse quality playlist (simulate single quality)
            if (isPlaylistViewerEnabled() && manifest) {
              // For transitional mode, treat entire manifest as single quality playlist
              const parsedSegments = PlaylistParserService.parseQuality(manifest);
              if (parsedSegments.length) {
                const playlistBuffer = new Map();
                parsedSegments.slice(-5).forEach(seg => playlistBuffer.set(seg.number, { ...seg, timestamp: Date.now() }));
                setSegmentBuffer(playlistBuffer);
                if (currentSegment === -1) {
                  setCurrentSegment(parsedSegments[0].number);
                  startPlayback();
                }
                EnterpriseAnalyticsService.addEvent({
                  type: 'playlist_mode_segments_loaded',
                  streamId,
                  count: playlistBuffer.size,
                  quality: chosenQualityRef.current,
                  experimentId: getFeatureFlags().playlistExperimentId,
                  timestamp: Date.now()
                });
              }
            }
          } catch (e) {
            EnterpriseAnalyticsService.addEvent({
              type: 'manifest_generation_error',
              streamId,
              message: e?.message,
              timestamp: Date.now()
            });
          }
        }
      }
    });

    return () => {
      cleanup();
    };
  }, [streamId]);

  // Update view count on mount/unmount
  useEffect(() => {
    if (!streamId) return;
    HLSLiveStreamServiceInstance.updateViewCount(streamId, true).catch(() => { });
    return () => {
      HLSLiveStreamServiceInstance.updateViewCount(streamId, false).catch(() => { });
    };
  }, [streamId]);

  // TikTok-style continuous playback management
  useEffect(() => {
    if (segmentBuffer.size > 0 && currentSegment >= 0) {
      managePlayback();
    }
  }, [segmentBuffer, currentSegment]);

  /**
   * TikTok-style playback management with seamless transitions
   */
  const managePlayback = useCallback(async () => {
    const targetSegment = segmentBuffer.get(currentSegment);

    if (!targetSegment || !videoRef.current) {
      // Handle missing segment with TikTok-style recovery
      if (__DEV__) console.log(`⚠️ Segment ${currentSegment} not available, attempting recovery...`);
      handleMissingSegment();
      return;
    }

    if (__DEV__) console.log(`🎥 TikTok-style playback: segment ${currentSegment}`);

    try {
      setIsBuffering(false);
      setIsPlaying(true);
      retryCountRef.current = 0;

      // TikTok optimization: preload while playing current
      preloadNextSegment();
      // Sample bandwidth (non-blocking) occasionally
      if (isPlaylistViewerEnabled() && SegmentBandwidthEstimatorService.shouldSample() && targetSegment?.url) {
        SegmentBandwidthEstimatorService.sample(targetSegment.url);
      }

      const activeVideo = videoRef.current;

      // Load segment with optimized settings
      await activeVideo.loadAsync(
        { uri: targetSegment.url },
        {
          shouldPlay: true,
          volume: 1.0,
          rate: 1.0,
          shouldCorrectPitch: true,
          progressUpdateIntervalMillis: 500 // Reduce churn on status updates
        },
        false
      );

      lastSegmentTimeRef.current = Date.now();
      lastPlaybackSegmentRef.current = currentSegment;

    } catch (error) {
      console.error(`❌ Playback error for segment ${currentSegment}:`, error);
      handlePlaybackError(error);
    }
  }, [currentSegment, segmentBuffer]);

  /**
   * TikTok-style segment preloading for smooth experience
   */
  const preloadNextSegment = useCallback(() => {
    const nextSegment = segmentBuffer.get(currentSegment + 1);
    if (nextSegment && secondaryVideoRef.current) {
      if (__DEV__) console.log(`📦 Preloading segment ${currentSegment + 1}`);
      secondaryVideoRef.current.loadAsync(
        { uri: nextSegment.url },
        { shouldPlay: false },
        false
      ).catch(err => console.log('Preload failed:', err));
    }
  }, [currentSegment, segmentBuffer]);

  /**
   * TikTok-style playback status management with seamless transitions
   */
  const handlePlaybackStatusUpdate = useCallback((status) => {
    if (status.didJustFinish) {
      if (__DEV__) console.log(`✅ Segment ${currentSegment} completed, transitioning...`);

      // TikTok-style seamless transition to next segment
      const nextSegmentNumber = currentSegment + 1;
      if (segmentBuffer.has(nextSegmentNumber)) {
        setCurrentSegment(nextSegmentNumber);
      } else {
        // Wait for next segment with timeout
        setIsBuffering(true);
        waitForNextSegment(nextSegmentNumber);
      }
    }

    // Handle buffering states
    if (status.isBuffering !== isBuffering) {
      setIsBuffering(status.isBuffering);
    }

    // Monitor playback health (TikTok-style)
    if (status.isLoaded && !status.isBuffering && !status.didJustFinish) {
      lastSegmentTimeRef.current = Date.now();
      lastPlaybackSegmentRef.current = currentSegment;
    }
  }, [currentSegment, segmentBuffer, isBuffering]);

  /**
   * TikTok-style missing segment recovery
   */
  const handleMissingSegment = useCallback(() => {
    retryCountRef.current++;

    if (retryCountRef.current > 3) {
      console.log('❌ Too many retry attempts, skipping segment');
      setCurrentSegment(prev => prev + 1);
      retryCountRef.current = 0;
      return;
    }

    if (__DEV__) console.log(`🔄 Retry ${retryCountRef.current}/3 for segment ${currentSegment}`);
    setTimeout(() => {
      if (segmentBuffer.has(currentSegment)) {
        managePlayback();
      } else {
        handleMissingSegment();
      }
    }, 1000 * retryCountRef.current); // Exponential backoff
  }, [currentSegment, segmentBuffer, managePlayback]);

  /**
   * Wait for next segment with timeout
   */
  const waitForNextSegment = useCallback((segmentNumber) => {
    if (segmentTimeoutRef.current) {
      clearTimeout(segmentTimeoutRef.current);
    }

    segmentTimeoutRef.current = setTimeout(() => {
      if (segmentBuffer.has(segmentNumber)) {
        setCurrentSegment(segmentNumber);
      } else {
        if (__DEV__) console.log(`⏰ Timeout waiting for segment ${segmentNumber}`);
        // Try to skip to available segment
        const availableSegments = Array.from(segmentBuffer.keys()).sort((a, b) => a - b);
        const nextAvailable = availableSegments.find(s => s > currentSegment);
        if (nextAvailable) {
          setCurrentSegment(nextAvailable);
        }
      }
    }, 5000); // 5 second timeout
  }, [segmentBuffer, currentSegment]);

  /**
   * Handle playback errors with TikTok-style recovery
   */
  const handlePlaybackError = useCallback((error) => {
    console.error('🚨 Playback error:', error);
    retryCountRef.current++;

    if (retryCountRef.current > 2) {
      onError?.(new Error('Playback failed after retries'));
      return;
    }

    setTimeout(() => {
      managePlayback();
    }, 2000);
  }, [managePlayback, onError]);

  /**
   * Start initial playback
   */
  const startPlayback = useCallback(() => {
    if (__DEV__) console.log('🎬 Starting TikTok-style playback');
    setIsBuffering(false);
    setIsPlaying(true);
  }, []);

  /**
   * Handle stream end
   */
  const handleStreamEnd = useCallback(() => {
    setIsPlaying(false);
    setIsBuffering(false);

    logStreamingEvent('VIEWER_ERROR', {
      backendId: 'HLS',
      streamId,
      reason: 'STREAM_ENDED',
      errorMessage: 'Stream has ended',
      source: 'viewer_ui',
    });

    // Ensure all subscriptions and timers are cleared on early termination
    cleanup();
    onError?.(new Error('Stream has ended'));
  }, [onError, streamId]);

  /**
   * Cleanup function
   */
  const cleanup = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }
    if (segmentTimeoutRef.current) {
      clearTimeout(segmentTimeoutRef.current);
    }
    if (stallCheckRef.current) {
      clearInterval(stallCheckRef.current);
    }
    if (adaptationIntervalRef.current) {
      clearInterval(adaptationIntervalRef.current);
      adaptationIntervalRef.current = null;
    }
  }, []);

  // Stall detection & analytics emission
  useEffect(() => {
    if (!streamId) return;
    if (stallCheckRef.current) clearInterval(stallCheckRef.current);
    stallCheckRef.current = setInterval(() => {
      const now = Date.now();
      const sinceLast = now - lastSegmentTimeRef.current;
      const stalled = sinceLast > 6000; // >6s without progress
      if (stalled) {
        stallCounterRef.current.incr();
        EnterpriseAnalyticsService.trackStreamPerformance(streamId, {
          latency: sinceLast,
          bufferHealth: 0.0,
          quality: 'source',
          fps: 30,
          bitrate: 0,
          segmentUploadTime: 0,
          errorRate: retryCountRef.current / Math.max(1, currentSegment + 1),
        }).catch(() => { });
        EnterpriseAnalyticsService.trackError(streamId, {
          type: 'stall',
          message: 'Playback stall detected',
          code: 'STALL_6000_MS',
          severity: 'medium',
          context: { currentSegment, bufferSize: segmentBuffer.size, sinceLast },
          recoveryAttempted: false,
          recoverySuccessful: false,
          recoveryMethod: 'auto-skip',
          recoveryTime: 0,
        }).catch(() => { });
        // Attempt auto-skip if next segment exists
        const next = segmentBuffer.get(currentSegment + 1);
        if (next) {
          setCurrentSegment(currentSegment + 1);
        }
      }
    }, 3000);
    return () => {
      if (stallCheckRef.current) clearInterval(stallCheckRef.current);
    };
  }, [streamId, currentSegment, segmentBuffer]);

  // Dynamic adaptation loop (incremental ABR heuristic)
  useEffect(() => {
    if (!isPlaylistViewerEnabled()) return;
    if (!variantsRef.current || variantsRef.current.length < 2) return;
    if (adaptationIntervalRef.current) clearInterval(adaptationIntervalRef.current);
    adaptationIntervalRef.current = setInterval(async () => {
      const bwStats = SegmentBandwidthEstimatorService.getStats();
      let networkType = 'unknown';
      try {
        const s = await NetInfo.fetch();
        networkType = s?.type || 'unknown';
      } catch { }
      const metrics = {
        bufferSegments: segmentBuffer.size,
        stallCountWindow: stallCounterRef.current.count(),
        networkType,
        timeSinceLastSegmentMs: Date.now() - lastSegmentTimeRef.current,
        bufferSeconds: computeBufferedSeconds(),
        estimatedBandwidthKbps: estimateBandwidthKbps(),
        bwSampleCount: bwStats.count,
        bwLastSampleAgeMs: bwStats.lastSampleAgeMs,
        bwMeanKbps: bwStats.meanKbps,
        bwStddevKbps: bwStats.stddevKbps,
        bwConfidenceScore: bwStats.confidenceScore,
        bwCoefficientOfVariation: bwStats.coefficientOfVariation,
      };
      // Emit periodic estimator metrics for observability (throttled to 30s)
      const nowTs = Date.now();
      if (nowTs - (lastEstimatorEmitRef.current || 0) > 30000 && chosenQualityRef.current) {
        lastEstimatorEmitRef.current = nowTs;
        EnterpriseAnalyticsService.addEvent({
          type: 'abr_estimator_metrics',
          streamId,
          ewmaKbps: metrics.estimatedBandwidthKbps,
          meanKbps: bwStats.meanKbps,
          stddevKbps: bwStats.stddevKbps,
          sampleCount: metrics.bwSampleCount,
          lastSampleAgeMs: metrics.bwLastSampleAgeMs,
          confidenceScore: bwStats.confidenceScore,
          coefficientOfVariation: bwStats.coefficientOfVariation,
          bufferSeconds: metrics.bufferSeconds,
          bufferSegments: metrics.bufferSegments,
          networkType: metrics.networkType,
          currentQuality: chosenQualityRef.current,
          experimentId: getFeatureFlags().playlistExperimentId,
          timestamp: nowTs,
        });
      }
      if (!chosenQualityRef.current) return;
      const decision = decideNextQuality(chosenQualityRef.current, variantsRef.current.map(v => ({ name: v.playlist.replace('.m3u8', '') })), metrics);
      // Handle skipped delta upgrade analytics
      if (decision && decision.skipped === true) {
        const type = decision.reason === 'delta_blocked'
          ? 'quality_switch_skipped_delta'
          : decision.reason === 'confidence_blocked'
            ? 'quality_switch_skipped_confidence'
            : decision.reason === 'volatility_blocked'
              ? 'quality_switch_skipped_volatility'
              : 'quality_switch_skipped';
        EnterpriseAnalyticsService.addEvent({
          type,
          streamId,
          from: chosenQualityRef.current,
          to: decision.target,
          reason: decision.reason,
          experimentId: getFeatureFlags().playlistExperimentId,
          timestamp: Date.now(),
        });
      }
      if (decision && !decision.skipped && decision.target !== chosenQualityRef.current) {
        const direction = variantsRef.current.findIndex(v => v.playlist.replace('.m3u8', '') === decision.target) > variantsRef.current.findIndex(v => v.playlist.replace('.m3u8', '') === chosenQualityRef.current) ? 'upgrade' : 'downgrade';
        try {
          const qualityContent = await PlaylistFetchService.getQuality(streamId, decision.target);
          if (qualityContent) {
            const parsedSegments = PlaylistParserService.parseQuality(qualityContent);
            if (parsedSegments.length) {
              const playlistBuffer = new Map();
              parsedSegments.slice(-5).forEach(seg => playlistBuffer.set(seg.number, { ...seg, timestamp: Date.now() }));
              setSegmentBuffer(playlistBuffer);
              setCurrentSegment(parsedSegments[0].number);
              const previousQuality = chosenQualityRef.current;
              chosenQualityRef.current = decision.target;
              emitQualitySwitchEvent(
                Promise.resolve(EnterpriseAnalyticsService),
                direction,
                streamId,
                previousQuality,
                decision.target,
                decision.reason,
                getFeatureFlags().playlistExperimentId
              );
            }
          }
        } catch (e) {
          EnterpriseAnalyticsService.addEvent({ type: 'quality_switch_error', streamId, target: decision.target, message: e?.message, timestamp: Date.now() });
        }
      }
    }, 8000);
    return () => {
      if (adaptationIntervalRef.current) clearInterval(adaptationIntervalRef.current);
    };
  }, [segmentBuffer, streamId]);

  function computeBufferedSeconds() {
    let total = 0;
    segmentBuffer.forEach((seg, num) => {
      if (num >= currentSegment) {
        total += typeof seg.duration === 'number' ? seg.duration : 2;
      }
    });
    return total;
  }

  function estimateBandwidthKbps() {
    return SegmentBandwidthEstimatorService.getEstimatedBandwidthKbps() || null;
  }

  return (
    <View style={[styles.container, style]}>
      {/* Primary video player */}
      <UnifiedVideo
        ref={videoRef}
        style={styles.video}
        uri={playbackUrl || undefined}
        resizeMode="cover" // TikTok-style full coverage
        onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
        shouldPlay={true}
        volume={1.0}
        useNativeControls={false}
        isLooping={false}
      />

      {/* Secondary video player for preloading (hidden) */}
      <UnifiedVideo
        ref={secondaryVideoRef}
        style={styles.hiddenVideo}
        resizeMode="cover"
        shouldPlay={false}
        volume={0}
        useNativeControls={false}
      />

      {/* TikTok-style connection status */}
      {connectionStatus === 'connecting' && (
        <View style={styles.connectionContainer}>
          <ActivityIndicator size="large" color={COLORS.gradientEnd} />
          <Text style={styles.connectionText}>Connecting to live stream...</Text>
        </View>
      )}

      {/* Enhanced buffering indicator */}
      {isBuffering && connectionStatus === 'connected' && (
        <View style={styles.bufferingContainer}>
          <ActivityIndicator size="large" color={COLORS.gradientEnd} />
          <Text style={styles.bufferingText}>
            {segmentBuffer.size === 0 ? 'Loading stream...' : 'Buffering...'}
          </Text>
          <Text style={styles.bufferInfo}>
            Buffer: {segmentBuffer.size} segments
          </Text>
        </View>
      )}

      {/* TikTok-style live indicator with viewer count */}
      {streamData?.status === 'live' && (
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
          {streamData.viewCount > 0 && (
            <Text style={styles.viewerCount}>{streamData.viewCount}</Text>
          )}
        </View>
      )}

      {/* Connection quality indicator */}
      <View style={styles.qualityIndicator}>
        <View style={[
          styles.qualityDot,
          {
            backgroundColor: connectionStatus === 'connected'
              ? (retryCountRef.current === 0 ? '#00FF00' : '#FFFF00')
              : '#FF0000'
          }
        ]} />
      </View>

      {/* Debug info (TikTok-style detailed) */}
      {__DEV__ && (
        <View style={styles.debugInfo}>
          <Text style={styles.debugText}>Segment: {currentSegment}</Text>
          <Text style={styles.debugText}>Buffer: {segmentBuffer.size}</Text>
          <Text style={styles.debugText}>Status: {connectionStatus}</Text>
          <Text style={styles.debugText}>Retries: {retryCountRef.current}</Text>
          <Text style={styles.debugText}>Playing: {isPlaying ? 'Yes' : 'No'}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  video: {
    flex: 1,
    backgroundColor: '#000',
  },
  hiddenVideo: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  connectionContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  connectionText: {
    color: 'white',
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
  },
  bufferingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  bufferingText: {
    color: 'white',
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
  },
  bufferInfo: {
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 8,
    fontSize: 14,
  },
  liveIndicator: {
    position: 'absolute',
    top: 20,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 23, 68, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
    marginRight: 6,
  },
  liveText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  viewerCount: {
    color: 'white',
    fontSize: 12,
    marginLeft: 8,
    fontWeight: '600',
  },
  qualityIndicator: {
    position: 'absolute',
    top: 20,
    right: 20,
  },
  qualityDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  debugInfo: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 12,
    borderRadius: 8,
    minWidth: 160,
  },
  debugText: {
    color: 'white',
    fontSize: 11,
    fontFamily: 'monospace',
    marginVertical: 1,
  },
  playerView: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  realTimeView: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  tile: {
    width: '50%',
    height: '33.333%',
    padding: 4,
  },
  hostTile: {
    borderColor: '#4ade80',
    borderWidth: 1,
  },
  guestTile: {},
  hostStage: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
  },
  hostTop9Stage: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
  },
  hostTop9HostBand: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  hostTop9Grid: {
    flex: 1,
    backgroundColor: '#000',
    padding: 4,
  },
  hostTop9Row: {
    flex: 1,
    flexDirection: 'row',
  },
  hostTop9Tile: {
    flex: 1,
    overflow: 'hidden',
    margin: 3,
    borderRadius: 10,
    backgroundColor: '#111114',
    borderWidth: 1,
    borderColor: '#FF2D55',
  },
  hostTop9Rank: {
    position: 'absolute',
    top: 5,
    left: 5,
    zIndex: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#FF2D55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostTop9RankText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  hostTop9User: {
    position: 'absolute',
    left: 5,
    right: 5,
    bottom: 4,
    zIndex: 2,
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  hostTop9HostHud: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  hostTop9Goal: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(10,10,12,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,45,85,0.4)',
  },
  hostTop9GoalLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 4,
  },
  hostTop9GoalTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  hostTop9GoalFill: {
    height: '100%',
    backgroundColor: '#FF2D55',
  },
  hostTop9GiftPill: {
    position: 'absolute',
    left: 8,
    top: 8,
    maxWidth: '70%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,45,85,0.92)',
  },
  hostTop9GiftPillText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  hostTop9HostMeta: {
    position: 'absolute',
    right: 8,
    top: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hostTop9Eye: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(10,10,12,0.7)',
  },
  hostTop9EyeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  hostTop9Fs: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.7)',
  },
  soloJoinChip: {
    position: 'absolute',
    right: 12,
    bottom: 88,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 45, 85, 0.92)',
  },
  soloJoinChipText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  composeSide: {
    flexDirection: 'row',
  },
  composeEqual: {
    flexDirection: 'column',
  },
  composeHostPaneSide: {
    flex: 1.15,
    height: '100%',
    overflow: 'hidden',
  },
  composeHostPaneEqual: {
    flex: 1.25,
    width: '100%',
    overflow: 'hidden',
  },
  composeGuestPaneSide: {
    flex: 0.85,
    height: '100%',
    paddingHorizontal: 6,
    paddingVertical: 8,
    backgroundColor: 'rgba(10,10,12,0.55)',
  },
  composeGuestPaneEqual: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: 'rgba(10,10,12,0.45)',
  },
  composeGuestScroll: {
    flex: 1,
  },
  composeGuestCol: {
    flexGrow: 1,
    gap: 8,
  },
  composeGuestGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  composeTileSide: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 85, 0.35)',
  },
  composeTileEqual: {
    width: '30%',
    marginHorizontal: '1.5%',
    marginBottom: 10,
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 85, 0.35)',
  },
  battleStage: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    backgroundColor: '#0A0A0C',
  },
  battlePane: {
    flex: 1,
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#0A0A0C',
  },
  battleEdgeLeft: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(255,45,85,0.85)',
    zIndex: 5,
  },
  battleEdgeRight: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(255,90,69,0.85)',
    zIndex: 5,
  },
  battleWaiting: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121214',
  },
  guestModeBanner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  guestModeText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  guestMediaControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  guestMediaBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  guestMediaBtnOff: {
    backgroundColor: 'rgba(251,113,133,0.55)',
  },
  leaveGuestButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  leaveGuestText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  camOffFill: {
    backgroundColor: '#121214',
  },
  camOffAvatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.92)',
    zIndex: 20,
  },
  camOffAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  camOffAvatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  micOffBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251,113,133,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    zIndex: 30,
  },
  selfTileControls: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    zIndex: 35,
  },
  selfTileBtn: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,45,85,0.4)',
  },
  selfTileBtnOff: {
    backgroundColor: 'rgba(251,113,133,0.88)',
    borderColor: 'rgba(255,255,255,0.4)',
  },
  guestErrorBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  guestErrorText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  hostPlaceholder: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestPager: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 16,
    backgroundColor: 'transparent',
    zIndex: 2,
  },
  hiddenTrayHandle: {
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    height: 28,
    paddingHorizontal: 12,
  },
  hiddenTrayPill: {
    width: 48,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,45,85,0.72)',
    marginBottom: 4,
  },
  hiddenTrayText: {
    color: 'rgba(127,237,226,0.92)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  guestBottomStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: COLORS.background,
    zIndex: 1,
  },
  guestPagerContent: {
    alignItems: 'flex-end',
    paddingHorizontal: 0,
  },
  guestPageInner: {
    paddingHorizontal: 8,
  },
  guestPage: {
    width: '100%',
  },
  guestGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
    justifyContent: 'center',
  },
  guestGridCollapsed: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    width: '100%',
    justifyContent: 'center',
    paddingBottom: 12,
  },
  guestTileSquare: {
    // Fluid 3-wide default; width overridden per visible count for 1→2→3 reflow.
    width: '31%',
    marginHorizontal: '1.1%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(10,10,12,0.92)',
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,45,85,0.45)',
  },
  guestTileSquareCollapsed: {
    // Fluid 3-wide row; width overridden when fewer guests for bigger tiles.
    width: '31%',
    marginHorizontal: '1.1%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(10,10,12,0.92)',
    marginBottom: 4,
    borderWidth: 1.5,
    borderColor: 'rgba(255,45,85,0.45)',
  },
  guestTileHidden: {
    opacity: 0,
  },
  emptyTile: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.4,
  },
  emptyTileInner: {
    width: '62%',
    height: '62%',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  joiningOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  joinTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,45,85,0.10)',
  },
  joinPlusCircle: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF2D55',
    borderWidth: 0,
  },
  joinPlusText: {
    color: '#fff',
    fontSize: 24,
    lineHeight: 24,
    fontWeight: '900',
    marginTop: -1,
  },
  joinLabelText: {
    marginTop: 8,
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  // "In queue" state: pink-tinted tile so the viewer clearly sees they are
  // waiting for the host to accept (not just a greyed-out "Waiting…").
  joinTileQueued: {
    backgroundColor: 'rgba(255,45,85,0.18)',
  },
  joinPlusCircleQueued: {
    backgroundColor: '#FDE68A',
  },
  joinLabelTextQueued: {
    color: '#FDE68A',
  },
  tilePlaceholder: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 14,
    fontWeight: '600',
  },
  tileVideoSurface: {
    flex: 1,
    backgroundColor: COLORS.black,
    overflow: 'hidden',
  },
  tileDebug: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 8,
    borderRadius: 6,
  },
  debugOverlay: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 12,
    borderRadius: 8,
    minWidth: 160,
  },
  connectedPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    padding: 20,
  },
  connectedTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4ade80',
    marginBottom: 8,
    textAlign: 'center',
  },
  connectedSubtitle: {
    fontSize: 14,
    color: '#a0a0a0',
    marginBottom: 24,
    textAlign: 'center',
  },
  connectionInfo: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(76, 222, 128, 0.2)',
  },
  infoLabel: {
    fontSize: 12,
    color: '#808080',
    marginTop: 12,
    marginBottom: 4,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  infoValue: {
    fontSize: 13,
    color: '#e0e0e0',
    fontFamily: 'monospace',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    padding: 8,
    borderRadius: 6,
  },
  statusText: {
    color: 'white',
    fontSize: 16,
    marginTop: 16,
    textAlign: 'center',
  },
  errorText: {
    color: COLORS.error,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default React.memo(LiveStreamViewer);
