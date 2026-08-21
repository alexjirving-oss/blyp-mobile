/**
 * IVS Viewer Session Hook
 *
 * Watchers join the Real-Time stage (same picture as web). HLS is only used
 * when preferPlayback is set and server-side composition is actually ACTIVE.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  LiveStreamingClient,
  NetworkQuality,
  ViewerSessionParams,
  StreamParticipant,
} from '../../../streaming/LiveStreamingClient';
import { getIVSNativeClient } from '../../../streaming/IVSNativeClient';
import { joinLiveRealtime, joinLiveMass, getLiveProgram } from '../../../api/ivsLiveApi';
import { useIVSMultiGuestRegistry, StreamEntry } from './useIVSMultiGuestRegistry';
import { MAX_STAGE_PUBLISHERS } from '../multiGuestLayout';
import { planViewerJoin } from '../viewerJoinPlan';

export type IVSConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected';
export type IVSViewerTransport = 'realtime' | 'playback';

/** Viewer participant tokens are minted for 60 minutes; re-join before expiry. */
const VIEWER_TOKEN_REFRESH_MS = 50 * 60 * 1000;
const VIEWER_RECONNECT_MAX_ATTEMPTS = 5;

function devLog(message: string, payload?: unknown): void {
  if (!__DEV__) return;
  if (payload === undefined) {
    console.log(message);
    return;
  }
  console.log(message, payload);
}

function isDeadSessionError(message: string | null | undefined, code?: string): boolean {
  if (code === 'SESSION_NOT_FOUND') return true;
  if (!message) return false;
  return /session_not_found|not found or not live/i.test(message);
}

type UseIVSViewerSessionArgs = {
  streamId: string;
  enabled: boolean;
  autoJoin?: boolean;
  /** Prefer HLS only when composition is ACTIVE. Default is Real-Time stage. */
  preferPlayback?: boolean;
  /** This viewer's display name, sent on join so chat shows "Alex joined". */
  displayName?: string;
};

type UseIVSViewerSessionResult = {
  connectionState: IVSConnectionState;
  networkQuality: NetworkQuality;
  remoteParticipants: StreamParticipant[];
  remoteVideoTracks: number;
  isReceivingVideo: boolean;
  surfaceReady: boolean;
  firstFrameSeen: boolean;
  canRender: boolean;
  visibleStreams: StreamEntry[];
  overflowStreams: StreamEntry[];
  markSurfaceReady: () => void;
  joinStream: () => Promise<void>;
  leaveStream: () => Promise<void>;
  error: string | null;
  reconnectExhausted: boolean;
  stageArn?: string;
  token?: string;
  viewerTransport: IVSViewerTransport;
};

export function useIVSViewerSession(args: UseIVSViewerSessionArgs): UseIVSViewerSessionResult {
  const { streamId, enabled, autoJoin = true, preferPlayback = false, displayName } = args;
  const [connectionState, setConnectionState] = useState<IVSConnectionState>('idle');
  const [viewerTransport, setViewerTransport] = useState<IVSViewerTransport>('realtime');
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>(NetworkQuality.UNKNOWN);
  const [remoteParticipants, setRemoteParticipants] = useState<StreamParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reconnectExhausted, setReconnectExhausted] = useState<boolean>(false);
  const [stageArn, setStageArn] = useState<string | undefined>(undefined);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [remoteVideoTracks, setRemoteVideoTracks] = useState<number>(0);
  const [surfaceReady, setSurfaceReady] = useState<boolean>(false);
  const [remoteVideoAdded, setRemoteVideoAdded] = useState<boolean>(false);
  const [firstFrameSeen, setFirstFrameSeen] = useState<boolean>(false);
  const [joined, setJoined] = useState<boolean>(false);
  const remoteVideoCountsRef = useRef<Map<string, number>>(new Map());
  const seenStreamKeysRef = useRef<Set<string>>(new Set());
  const hasReceivedVideoRef = useRef<boolean>(false);
  const reconnectAttemptsRef = useRef<number>(0);
  const joinInFlightRef = useRef<boolean>(false);
  const forceRejoinRef = useRef<boolean>(false);
  const tokenRefreshRef = useRef<boolean>(false);
  const leaveInFlightRef = useRef<boolean>(false);
  const joinStreamRef = useRef<() => Promise<void>>(async () => {});
  const tokenRef = useRef<string | undefined>(undefined);
  const stageArnRef = useRef<string | undefined>(undefined);
  const joinedRef = useRef<boolean>(false);
  const lastJoinedSessionIdRef = useRef<string | null>(null);
  const lastSurfaceReadyRef = useRef<boolean>(false);
  const joinRequestedRef = useRef<boolean>(false);
  const lastStreamIdRef = useRef<string | null>(null);
  const participantMetaRef = useRef<Map<string, { isMuted: boolean; role?: string }>>(new Map());
  const lastNetworkQualityRef = useRef<NetworkQuality>(NetworkQuality.UNKNOWN);
  tokenRef.current = token;
  stageArnRef.current = stageArn;

  const multiGuestRegistry = useIVSMultiGuestRegistry({
    // Host + 11 guests. Cap of 11 previously dropped the 11th guest when the
    // host stream was also registered.
    maxPublishers: MAX_STAGE_PUBLISHERS,
    visibleSlots: MAX_STAGE_PUBLISHERS,
    overflowLimit: 0,
    batchWindowMs: 75,
  });

  const {
    visibleStreams,
    overflowStreams,
    upsertStream,
    removeStream,
    removeParticipantStreams,
    markFirstFrame,
    updateParticipantMuted,
    updateParticipantCameraDisabled,
    updateParticipantRole,
    reset: resetRegistry,
  } = multiGuestRegistry;

  const client: LiveStreamingClient = getIVSNativeClient();

  const markJoined = () => {
    joinedRef.current = true;
    setJoined(true);
    lastJoinedSessionIdRef.current = streamId;
  };

  // Fetch token and join as viewer (Real-Time stage participant, subscribe-only)
  const joinStream = useCallback(async () => {
    devLog('[ASSERT][VIEWER] joinStream called', {
      joined: joinedRef.current,
      inFlight: joinInFlightRef.current,
      surfaceReady,
    });
    joinRequestedRef.current = true;
    if (!surfaceReady) {
      devLog('[IVS_VIEWER][JOIN_ALLOWED_NO_SURFACE]', { streamId });
    }
    if (!enabled) {
      setError('Viewer session not enabled');
      return;
    }

    const force = forceRejoinRef.current;
    forceRejoinRef.current = false;

    // Guard against duplicate joins
    if (joinInFlightRef.current) {
      devLog('[IVS_VIEWER][JOIN_SKIPPED] Already joining', {
        inFlight: joinInFlightRef.current,
        joined: joinedRef.current,
      });
      return;
    }

    if (!force && joinedRef.current && lastJoinedSessionIdRef.current === streamId) {
      devLog('[VIEWER] already joined same session — skip');
      return;
    }

    joinInFlightRef.current = true;
    let reusedExistingToken = false;
    try {
      const refreshToken = tokenRefreshRef.current;
      tokenRefreshRef.current = false;
      const preserveMedia = hasReceivedVideoRef.current && !refreshToken;
      setError(null);
      setReconnectExhausted(false);
      if (!preserveMedia) {
        setConnectionState('connecting');
        hasReceivedVideoRef.current = false;
        remoteVideoCountsRef.current = new Map();
        setRemoteVideoTracks(0);
        setRemoteVideoAdded(false);
        setFirstFrameSeen(false);
        seenStreamKeysRef.current = new Set();
        participantMetaRef.current = new Map();
        resetRegistry();
      }

      devLog('[VIEWER][JOIN_REQUEST]', { sessionId: streamId });
      devLog('[IVS_VIEWER][JOIN_STREAM]', { streamId, preferPlayback, force, refreshToken });

      const existingToken = tokenRef.current;
      const existingArn = stageArnRef.current;
      if (force && !refreshToken && existingToken && existingArn) {
        reusedExistingToken = true;
        setViewerTransport('realtime');
        await client.joinAsViewer({
          sessionId: streamId,
          stageArn: existingArn,
          token: existingToken,
        });
        try {
          await client.forceLiveLoudspeaker('viewer-hook-stage-rejoined');
        } catch (routeErr) {
          console.warn('[IVS_VIEWER][LOUDSPEAKER_SOFT_FAIL]', routeErr);
        }
        markJoined();
        reconnectAttemptsRef.current = 0;
        if (preserveMedia) {
          setConnectionState('connected');
        }
        devLog('[IVS_VIEWER][REJOIN_SAME_TOKEN]', { streamId });
        return;
      }

      if (preferPlayback) {
        let playbackUrl: string | undefined;
        let compositionState: string | undefined;
        try {
          const program = await getLiveProgram(streamId);
          const fromProgram = String(program?.playbackUrl || '').trim();
          if (fromProgram) playbackUrl = fromProgram;
          if (program?.compositionState) compositionState = String(program.compositionState);
        } catch (progErr) {
          console.warn('[IVS_VIEWER][PROGRAM_LOOKUP_FAILED]', progErr);
        }
        if (planViewerJoin({ preferPlayback: true, playbackUrl, compositionState }).transport !== 'playback') {
          try {
            const mass = await joinLiveMass(streamId, displayName);
            if (mass?.mode === 'playback' && mass.playbackUrl) {
              playbackUrl = String(mass.playbackUrl).trim() || undefined;
              compositionState = 'ACTIVE';
            }
          } catch (massErr) {
            console.warn('[IVS_VIEWER][JOIN_PLAYBACK_LOOKUP_FAILED]', massErr);
          }
        }
        const plan = planViewerJoin({ preferPlayback: true, playbackUrl, compositionState });
        if (plan.transport === 'playback') {
          devLog('[IVS_VIEWER][JOIN_PLAYBACK]', { streamId, playbackUrlLength: plan.playbackUrl.length });
          await client.joinAsViewerPlayback({
            sessionId: streamId,
            playbackUrl: plan.playbackUrl,
          });
          try {
            await client.forceLiveLoudspeaker('viewer-hook-player-joined');
          } catch (routeErr) {
            console.warn('[IVS_VIEWER][LOUDSPEAKER_SOFT_FAIL]', routeErr);
          }
          setViewerTransport('playback');
          markJoined();
          setConnectionState('connected');
          setRemoteVideoAdded(true);
          devLog('[IVS_VIEWER][JOIN_PLAYBACK_COMPLETED]', { streamId });
          return;
        }
        devLog('[IVS_VIEWER][PLAYBACK_SKIPPED_USE_STAGE]', { streamId, compositionState });
      }

      setViewerTransport('realtime');

      // 1. Fetch viewer participant token from backend (stage subscriber)
      const response = await joinLiveRealtime(streamId, displayName);

      devLog('[IVS_VIEWER][TOKEN_RECEIVED]', {
        stageArn: response.stageArn,
        tokenLength: response.token?.length || 0,
      });

      // 2. Validate Real-Time stage credentials
      if (!response.stageArn || !response.token) {
        throw new Error('Backend did not return valid stage credentials (stageArn + token)');
      }

      setStageArn(response.stageArn);
      setToken(response.token);

      // 3. Join as viewer via IVS Real-Time stage (subscribe-only participant)
      const viewerParams: ViewerSessionParams = {
        sessionId: streamId,
        stageArn: response.stageArn,
        token: response.token,
      };

      await client.joinAsViewer(viewerParams);
      // Loudspeaker must not roll back a successful stage join (cross-account
      // viewers were getting kicked with a false join failure when audio route
      // reassert threw after IVS subscribe succeeded).
      try {
        await client.forceLiveLoudspeaker('viewer-hook-stage-joined');
      } catch (routeErr) {
        console.warn('[IVS_VIEWER][LOUDSPEAKER_SOFT_FAIL]', routeErr);
      }
      markJoined();
      reconnectAttemptsRef.current = 0;
      if (preserveMedia) {
        setConnectionState('connected');
      }
      devLog('[IVS_VIEWER][JOIN_COMPLETED]', { streamId });
      devLog('[IVS_VIEWER][STAGE_JOIN_SUCCESS]', {
        sessionId: streamId,
        stageArn: response.stageArn,
      });
    } catch (err) {
      console.error('[IVS_VIEWER][JOIN_ERROR]', err);
      const raw = err instanceof Error ? err.message : String(err || 'Failed to join stream');
      // Preserve structured codes so LiveStreamScreen can map SESSION_NOT_FOUND
      // without treating every failure as a generic "ended" toast.
      const code = (err as any)?.code || (err as any)?.response?.code;
      const dead = isDeadSessionError(raw, code);
      const msg = dead ? `session_not_found: ${raw}` : raw;
      joinedRef.current = false;
      lastJoinedSessionIdRef.current = null;
      setJoined(false);
      if (dead) {
        setError(msg);
        setConnectionState('disconnected');
        setStageArn(undefined);
        setToken(undefined);
        setReconnectExhausted(true);
      } else {
        // Keep last stage credentials so the native RT view stays mounted
        // while we retry. Wiping token unmounts IVSRealTimeView.
        console.warn('[IVS_VIEWER][JOIN_TRANSIENT]', { msg, reusedExistingToken });
        setError(null);
        setConnectionState('disconnected');
        if (reusedExistingToken) {
          tokenRef.current = undefined;
        }
      }
    } finally {
      joinInFlightRef.current = false;
    }
  }, [client, displayName, enabled, markJoined, preferPlayback, resetRegistry, streamId, surfaceReady]);

  joinStreamRef.current = joinStream;

  // Leave stream
  const leaveStream = useCallback(async () => {
    try {
      devLog('[IVS_VIEWER][LEAVE_STREAM]', { streamId });
      leaveInFlightRef.current = true;
      
      await client.leaveAsViewer();
      
      setConnectionState('idle');
      setViewerTransport('realtime');
      hasReceivedVideoRef.current = false;
      reconnectAttemptsRef.current = 0;
      setReconnectExhausted(false);
      resetRegistry();
      setRemoteVideoAdded(false);
      setFirstFrameSeen(false);
      joinedRef.current = false;
      setJoined(false);
      lastJoinedSessionIdRef.current = null;
      devLog('[IVS_VIEWER][LEFT]');
    } catch (err) {
      console.error('[IVS_VIEWER][LEAVE_ERROR]', err);
      setError(err instanceof Error ? err.message : 'Failed to leave stream');
    } finally {
      leaveInFlightRef.current = false;
    }
  }, [client, resetRegistry, streamId]);

  const markSurfaceReady = useCallback(() => {
    setSurfaceReady(true);
  }, []);

  useEffect(() => {
    if (lastStreamIdRef.current && lastStreamIdRef.current === streamId) {
      return;
    }
    if (lastStreamIdRef.current !== null && lastStreamIdRef.current !== streamId) {
      joinedRef.current = false;
      setJoined(false);
      lastJoinedSessionIdRef.current = null;
      devLog('[VIEWER] reset joined state on stream change', {
        from: lastStreamIdRef.current,
        to: streamId,
      });
    }
    lastStreamIdRef.current = streamId;
  }, [streamId]);

  // Listen to LiveStreamingClient events
  useEffect(() => {
    if (!enabled) return;

    // Remote participant joined (host or guest)
    const unsubParticipantJoined = client.on('remoteParticipantJoined', (event) => {
      devLog('[IVS_VIEWER][REMOTE_PARTICIPANT_JOINED]', event.payload);
      setRemoteParticipants((prev) => {
        const payload = event.payload as any;
        participantMetaRef.current.set(payload.participantId, {
          isMuted: payload.isMuted ?? false,
          role: payload.role,
        });
        updateParticipantRole(payload.participantId, payload.role);
        updateParticipantMuted(payload.participantId, payload.isMuted ?? false);
        const existing = prev.find((p) => p.participantId === payload.participantId);
        if (existing) return prev;
        return [
          ...prev,
          {
            participantId: payload.participantId,
            userId: payload.userId,
            slotIndex: payload.slotIndex,
            role: payload.role || 'host',
            isLocal: false,
            isMuted: false,
            isCameraDisabled: false,
          },
        ];
      });
    });

    // Remote participant updated
    const unsubParticipantUpdated = client.on('remoteParticipantUpdated', (event) => {
      devLog('[IVS_VIEWER][REMOTE_PARTICIPANT_UPDATED]', event.payload);
      setRemoteParticipants((prev) => {
        const payload = event.payload as any;
        const participantId = payload?.participantId;
        if (!participantId) return prev;
        const idx = prev.findIndex((p) => p.participantId === participantId);
        if (idx < 0) return prev;
        const current = prev[idx];
        const nextMuted =
          payload.isMuted !== undefined ? payload.isMuted : current.isMuted;
        const nextCamDisabled =
          payload.isCameraDisabled !== undefined
            ? !!payload.isCameraDisabled
            : current.isCameraDisabled;
        if (payload.isMuted !== undefined) {
          participantMetaRef.current.set(participantId, {
            isMuted: payload.isMuted,
            role: participantMetaRef.current.get(participantId)?.role,
          });
          updateParticipantMuted(participantId, payload.isMuted);
        }
        if (payload.isCameraDisabled !== undefined) {
          updateParticipantCameraDisabled(participantId, !!payload.isCameraDisabled);
        }
        if (payload.role) {
          const existing = participantMetaRef.current.get(participantId);
          participantMetaRef.current.set(participantId, {
            isMuted: existing?.isMuted ?? false,
            role: payload.role,
          });
          updateParticipantRole(participantId, payload.role);
        }
        if (
          nextMuted === current.isMuted &&
          nextCamDisabled === current.isCameraDisabled
        ) {
          return prev;
        }
        const next = prev.slice();
        next[idx] = {
          ...current,
          isMuted: nextMuted,
          isCameraDisabled: nextCamDisabled,
        };
        return next;
      });
    });

    // Remote participant left
    const unsubParticipantLeft = client.on('remoteParticipantLeft', (event) => {
      devLog('[IVS_VIEWER][REMOTE_PARTICIPANT_LEFT]', event.payload);
      const payload = event.payload as any;
      if (payload?.participantId) {
        const counts = new Map(remoteVideoCountsRef.current);
        counts.delete(payload.participantId);
        remoteVideoCountsRef.current = counts;
        const total = Array.from(counts.values()).reduce((acc, n) => acc + n, 0);
        setRemoteVideoTracks(total);
      }
      if (payload?.participantId) {
        participantMetaRef.current.delete(payload.participantId);
        removeParticipantStreams(payload.participantId);
      }
      setRemoteParticipants((prev) => prev.filter((p) => p.participantId !== payload.participantId));
    });

    // Network quality updated — skip identical values to avoid re-render churn.
    const unsubNetworkQuality = client.on('networkQualityUpdated', (event) => {
      const payload = event.payload as any;
      const quality = payload.quality as NetworkQuality;
      if (quality === lastNetworkQualityRef.current) return;
      lastNetworkQualityRef.current = quality;
      setNetworkQuality(quality);
    });

    // Remote video track added/removed (from native diagnostics)
    const unsubRemoteVideoAdded = client.on('remoteVideoTrackAdded', (event) => {
      const payload = event.payload as any;
      if (payload?.participantId) {
        const counts = new Map(remoteVideoCountsRef.current);
        const current = counts.get(payload.participantId) || 0;
        const next = current + 1;
        counts.set(payload.participantId, next);
        remoteVideoCountsRef.current = counts;
        const total = Array.from(counts.values()).reduce((acc, n) => acc + n, 0);
        setRemoteVideoTracks(total);
        if (!payload.streamKey) {
          console.warn('[IVS_VIEWER][REMOTE_VIDEO_ADDED_MISSING_STREAMKEY]', payload);
          return;
        }
        const participantMeta = participantMetaRef.current.get(payload.participantId);
        const isHost =
          participantMeta?.role === 'host' ||
          payload.role === 'host' ||
          payload.slotIndex === 0;
        const isMuted = participantMeta?.isMuted ?? false;
        upsertStream({
          participantId: payload.participantId,
          streamKey: payload.streamKey,
          isMuted,
          isHost,
          addedAt: Date.now(),
          // Host-assigned guest slot (from token attributes via native) so the
          // viewer can place each guest in the SAME box the host uses.
          slotIndex: typeof payload.slotIndex === 'number' ? payload.slotIndex : undefined,
        });
        if (!seenStreamKeysRef.current.has(payload.streamKey)) {
          seenStreamKeysRef.current.add(payload.streamKey);
          setRemoteVideoAdded(true);
        }
        devLog('[IVS_VIEWER][REMOTE_VIDEO_ADDED]', { total, participantId: payload.participantId });
      }
    });

    const unsubRemoteVideoRemoved = client.on('remoteVideoTrackRemoved', (event) => {
      const payload = event.payload as any;
      if (payload?.participantId) {
        const counts = new Map(remoteVideoCountsRef.current);
        const current = counts.get(payload.participantId) || 0;
        const next = Math.max(0, current - 1);
        if (next === 0) {
          counts.delete(payload.participantId);
        } else {
          counts.set(payload.participantId, next);
        }
        remoteVideoCountsRef.current = counts;
        const total = Array.from(counts.values()).reduce((acc, n) => acc + n, 0);
        setRemoteVideoTracks(total);
        if (payload.streamKey) {
          removeStream(payload.streamKey);
        }
        devLog('[IVS_VIEWER][REMOTE_VIDEO_REMOVED]', { total, participantId: payload.participantId });
      }
    });

    // Error event
    const unsubError = client.on('error', (event) => {
      const payload = event.payload as any;
      const message =
        typeof payload?.message === 'string'
          ? payload.message
          : payload?.message
            ? String(payload.message)
            : 'Playback error';
      const fatal = payload?.fatal ?? true;

      // Some IVS SDK/player layers can emit transient MultiHost playback errors even while
      // Real-Time stage video is already rendering. These should not tear down the session
      // or spam LogBox during development.
      const isMultiHostNoise = /multihost/i.test(message) && hasReceivedVideoRef.current;
      if (isMultiHostNoise) {
        console.warn('[IVS_VIEWER][NON_FATAL_ERROR_IGNORED]', { message, fatal });
        return;
      }

      if (isDeadSessionError(message, payload?.code)) {
        console.error('[IVS_VIEWER][ERROR_DEAD_SESSION]', payload);
        setError(message);
        setConnectionState('disconnected');
        setReconnectExhausted(true);
        return;
      }

      // Already watching: treat SDK errors as reconnect triggers, not "ended".
      if (hasReceivedVideoRef.current || joinedRef.current) {
        console.warn('[IVS_VIEWER][ERROR_RECONNECT]', { message, fatal });
        setError(null);
        if (fatal) {
          joinedRef.current = false;
          lastJoinedSessionIdRef.current = null;
          setJoined(false);
          setConnectionState('disconnected');
        }
        return;
      }

      console.error('[IVS_VIEWER][ERROR]', payload);
      setError(message);
      if (fatal) {
        setConnectionState('disconnected');
      }
    });

    const unsubBroadcastState = client.on('broadcastStateChanged', (event) => {
      const state = String((event?.payload as any)?.state || '');
      if (state !== 'DISCONNECTED') return;
      if (joinInFlightRef.current || leaveInFlightRef.current) {
        devLog('[IVS_VIEWER][STAGE_DISCONNECTED_IGNORED]', {
          streamId,
          joinInFlight: joinInFlightRef.current,
          leaveInFlight: leaveInFlightRef.current,
        });
        return;
      }
      if (!joinedRef.current && !hasReceivedVideoRef.current) return;
      // Recoverable Stage drop (browser publisher ICE). Keep credentials and
      // the native TextureView; do not tell LiveStreamScreen the live ended.
      console.warn('[IVS_VIEWER][STAGE_DISCONNECTED]', { streamId });
      joinedRef.current = false;
      lastJoinedSessionIdRef.current = null;
      setJoined(false);
      setError(null);
      setConnectionState('disconnected');
    });

    const unsubSurfaceReady = client.on('surfaceReady', (event) => {
      const payload = event.payload as any;
      setSurfaceReady(!!payload.ready);
    });

    const unsubFirstFrame = client.on('firstFrame', (event) => {
      const payload = event.payload as any;
      const key = payload.streamKey || 'unknown';
      const dedupeKey = `ff:${key}`;
      if (seenStreamKeysRef.current.has(dedupeKey)) return;
      seenStreamKeysRef.current.add(dedupeKey);
      markFirstFrame(key);
      setFirstFrameSeen(true);
    });

    // Cleanup subscriptions on unmount
    return () => {
      unsubParticipantJoined();
      unsubParticipantUpdated();
      unsubParticipantLeft();
      unsubNetworkQuality();
      unsubRemoteVideoAdded();
      unsubRemoteVideoRemoved();
      unsubError();
      unsubBroadcastState();
      unsubSurfaceReady();
      unsubFirstFrame();
    };
  }, [
    client,
    enabled,
    streamId,
    markFirstFrame,
    removeParticipantStreams,
    removeStream,
    updateParticipantMuted,
    updateParticipantCameraDisabled,
    updateParticipantRole,
    upsertStream,
  ]);

  // Auto-join on mount if enabled
  useEffect(() => {
    if (!enabled || !autoJoin || connectionState !== 'idle') return;
    void joinStream();
  }, [enabled, autoJoin, connectionState, joinStream]);

  // Drive high-level connection state from actual media reception.
  // "connected" means: we have observed at least one remote video track.
  useEffect(() => {
    if (!enabled) return;

    if (remoteVideoTracks > 0) {
      if (!hasReceivedVideoRef.current) {
        hasReceivedVideoRef.current = true;
      }
      reconnectAttemptsRef.current = 0;
      if (reconnectExhausted) {
        setReconnectExhausted(false);
      }
      // Stale track counts can survive a native DISCONNECTED. Reconnect
      // owns that state until joinStream succeeds again.
      if (connectionState === 'disconnected') {
        return;
      }
      if (connectionState !== 'connected') {
        setConnectionState('connected');
      }
    }
    // NOTE: We do NOT treat "no video yet" as "disconnected"
    // The viewer stays in "connecting" state until video arrives or an error occurs.
    // This prevents premature disconnection before the host joins or sends video.
  }, [enabled, remoteVideoTracks, connectionState, reconnectExhausted]);

  useEffect(() => {
    if (!__DEV__ || connectionState !== 'connected') return;
    devLog('[IVS_VIEWER][MEDIA_STATE]', {
      connectionState,
      remoteParticipants: remoteParticipants.length,
      remoteVideoTracks,
    });
  }, [connectionState, remoteParticipants.length, remoteVideoTracks]);

  useEffect(() => {
    if (lastSurfaceReadyRef.current !== surfaceReady) {
      devLog('[IVS_VIEWER][SURFACE_STATE]', { ready: surfaceReady });
      lastSurfaceReadyRef.current = surfaceReady;
    }
  }, [surfaceReady]);

  // Auto-reconnect for transient drops. Dead sessions (host ended) set error
  // and reconnectExhausted so the watch UI can leave; everything else retries.
  useEffect(() => {
    if (!enabled || !autoJoin) return;
    if (connectionState !== 'disconnected') return;
    if (isDeadSessionError(error)) return;
    if (reconnectExhausted) return;

    const nextAttempt = reconnectAttemptsRef.current + 1;
    if (nextAttempt > VIEWER_RECONNECT_MAX_ATTEMPTS) {
      console.warn('[IVS_VIEWER][RECONNECT_ABORTED]', { streamId, attempts: reconnectAttemptsRef.current });
      setReconnectExhausted(true);
      return;
    }

    const delayMs = 1000 * nextAttempt;
    devLog('[IVS_VIEWER][RECONNECT_SCHEDULED]', { streamId, attempt: nextAttempt, delayMs });
    const timer = setTimeout(() => {
      reconnectAttemptsRef.current = nextAttempt;
      forceRejoinRef.current = true;
      devLog('[IVS_VIEWER][RECONNECT_ATTEMPT]', { streamId, attempt: reconnectAttemptsRef.current });
      void joinStreamRef.current();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [autoJoin, connectionState, enabled, error, reconnectExhausted, streamId]);

  // Re-join with a fresh viewer token before the 60-minute IVS token expires.
  useEffect(() => {
    if (!enabled || !autoJoin) return;
    if (viewerTransport !== 'realtime') return;
    if (!token) return;
    const timer = setTimeout(() => {
      devLog('[IVS_VIEWER][TOKEN_REFRESH_REJOIN]', { streamId });
      tokenRefreshRef.current = true;
      forceRejoinRef.current = true;
      joinedRef.current = false;
      lastJoinedSessionIdRef.current = null;
      void joinStreamRef.current();
    }, VIEWER_TOKEN_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [autoJoin, enabled, streamId, token, viewerTransport]);

  const canRender = surfaceReady && remoteVideoAdded && visibleStreams.length > 0;

  return {
    connectionState,
    networkQuality,
    remoteParticipants,
    joinStream,
    leaveStream,
    error,
    reconnectExhausted,
    stageArn,
    token,
    remoteVideoTracks,
    isReceivingVideo: remoteVideoTracks > 0,
    surfaceReady,
    firstFrameSeen,
    canRender,
    visibleStreams,
    overflowStreams,
    markSurfaceReady,
    viewerTransport,
  };
}
