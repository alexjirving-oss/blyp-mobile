/**
 * IVS Viewer Session Hook
 * 
 * React hook for managing IVS streaming session from viewer perspective.
 * Viewers join as Real-Time stage participants (subscribe-only, no publish).
 * This provides low-latency viewing by receiving live video/audio from the stage.
 * 
 * Handles viewer lifecycle, token fetching, participant tracking, and network quality monitoring.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  LiveStreamingClient,
  NetworkQuality,
  ViewerSessionParams,
  StreamParticipant,
} from '../../../streaming/LiveStreamingClient';
import { getIVSNativeClient } from '../../../streaming/IVSNativeClient';
import { joinLiveRealtime, joinLiveMass } from '../../../api/ivsLiveApi';
import { useIVSMultiGuestRegistry, StreamEntry } from './useIVSMultiGuestRegistry';
import { MAX_STAGE_PUBLISHERS } from '../multiGuestLayout';

export type IVSConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected';
export type IVSViewerTransport = 'realtime' | 'playback';

type UseIVSViewerSessionArgs = {
  streamId: string;
  enabled: boolean;
  autoJoin?: boolean;
  /** Prefer HLS/IVS Player playback when the backend provides a playbackUrl. */
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
  stageArn?: string;
  token?: string;
  viewerTransport: IVSViewerTransport;
};

export function useIVSViewerSession(args: UseIVSViewerSessionArgs): UseIVSViewerSessionResult {
  const { streamId, enabled, autoJoin = true, preferPlayback = true, displayName } = args;
  const [connectionState, setConnectionState] = useState<IVSConnectionState>('idle');
  const [viewerTransport, setViewerTransport] = useState<IVSViewerTransport>('realtime');
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>(NetworkQuality.UNKNOWN);
  const [remoteParticipants, setRemoteParticipants] = useState<StreamParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);
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
  const joinedRef = useRef<boolean>(false);
  const lastJoinedSessionIdRef = useRef<string | null>(null);
  const lastSurfaceReadyRef = useRef<boolean>(false);
  const joinRequestedRef = useRef<boolean>(false);
  const lastStreamIdRef = useRef<string | null>(null);
  const participantMetaRef = useRef<Map<string, { isMuted: boolean; role?: string }>>(new Map());

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
    console.log('[ASSERT][VIEWER] joinStream called', {
      joined: joinedRef.current,
      inFlight: joinInFlightRef.current,
      surfaceReady,
    });
    joinRequestedRef.current = true;
    if (!surfaceReady) {
      console.log('[IVS_VIEWER][JOIN_ALLOWED_NO_SURFACE]', { streamId });
    }
    if (!enabled) {
      setError('Viewer session not enabled');
      return;
    }

    // Guard against duplicate joins
    if (joinInFlightRef.current) {
      console.log('[IVS_VIEWER][JOIN_SKIPPED] Already joining', {
        inFlight: joinInFlightRef.current,
        joined: joinedRef.current,
      });
      return;
    }

    if (joinedRef.current && lastJoinedSessionIdRef.current === streamId) {
      console.log('[VIEWER] already joined same session — skip');
      return;
    }

    joinInFlightRef.current = true;
    try {
      hasReceivedVideoRef.current = false;
      reconnectAttemptsRef.current = 0;
      setConnectionState('connecting');
      setError(null);
      remoteVideoCountsRef.current = new Map();
      setRemoteVideoTracks(0);
      setRemoteVideoAdded(false);
      setFirstFrameSeen(false);
      seenStreamKeysRef.current = new Set();
      participantMetaRef.current = new Map();
      resetRegistry();

      console.log('[VIEWER][JOIN_REQUEST]', { sessionId: streamId });
      console.log('[IVS_VIEWER][JOIN_STREAM]', { streamId, preferPlayback });

      let usedPlayback = false;

      if (preferPlayback) {
        try {
          const mass = await joinLiveMass(streamId);
          if (mass?.mode === 'playback' && mass.playbackUrl) {
            console.log('[IVS_VIEWER][JOIN_PLAYBACK]', { streamId, playbackUrlLength: mass.playbackUrl.length });
            await client.joinAsViewerPlayback({
              sessionId: streamId,
              playbackUrl: mass.playbackUrl,
            });
            setViewerTransport('playback');
            usedPlayback = true;
            markJoined();
            setConnectionState('connected');
            setRemoteVideoAdded(true);
            setFirstFrameSeen(true);
            console.log('[IVS_VIEWER][JOIN_PLAYBACK_COMPLETED]', { streamId });
          }
        } catch (massErr) {
          console.warn('[IVS_VIEWER][JOIN_PLAYBACK_FALLBACK]', massErr);
        }
      }

      if (usedPlayback) {
        return;
      }

      setViewerTransport('realtime');

      // 1. Fetch viewer participant token from backend (stage subscriber)
      const response = await joinLiveRealtime(streamId, displayName);

      console.log('[IVS_VIEWER][TOKEN_RECEIVED]', {
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
      markJoined();
      console.log('[IVS_VIEWER][JOIN_COMPLETED]', { streamId });
      console.log('[IVS_VIEWER][STAGE_JOIN_SUCCESS]', {
        sessionId: streamId,
        stageArn: response.stageArn,
      });
    } catch (err) {
      console.error('[IVS_VIEWER][JOIN_ERROR]', err);
      setError(err instanceof Error ? err.message : 'Failed to join stream');
      setConnectionState('disconnected');
      setStageArn(undefined);
      setToken(undefined);
    } finally {
      joinInFlightRef.current = false;
    }
  }, [client, displayName, enabled, markJoined, preferPlayback, resetRegistry, streamId, surfaceReady]);

  // Leave stream
  const leaveStream = useCallback(async () => {
    try {
      console.log('[IVS_VIEWER][LEAVE_STREAM]', { streamId });
      
      await client.leaveAsViewer();
      
      setConnectionState('idle');
      setViewerTransport('realtime');
      hasReceivedVideoRef.current = false;
      reconnectAttemptsRef.current = 0;
      resetRegistry();
      setRemoteVideoAdded(false);
      setFirstFrameSeen(false);
      joinedRef.current = false;
      setJoined(false);
      lastJoinedSessionIdRef.current = null;
      console.log('[IVS_VIEWER][LEFT]');
    } catch (err) {
      console.error('[IVS_VIEWER][LEAVE_ERROR]', err);
      setError(err instanceof Error ? err.message : 'Failed to leave stream');
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
      console.log('[VIEWER] reset joined state on stream change', {
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
      console.log('[IVS_VIEWER][REMOTE_PARTICIPANT_JOINED]', event.payload);
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
      console.log('[IVS_VIEWER][REMOTE_PARTICIPANT_UPDATED]', event.payload);
      setRemoteParticipants((prev) =>
        prev.map((p) => {
          const payload = event.payload as any;
          if (payload.participantId && payload.isMuted !== undefined) {
            participantMetaRef.current.set(payload.participantId, {
              isMuted: payload.isMuted,
              role: participantMetaRef.current.get(payload.participantId)?.role,
            });
            updateParticipantMuted(payload.participantId, payload.isMuted);
          }
          if (payload.participantId && payload.isCameraDisabled !== undefined) {
            updateParticipantCameraDisabled(payload.participantId, !!payload.isCameraDisabled);
          }
          if (payload.participantId && payload.role) {
            const existing = participantMetaRef.current.get(payload.participantId);
            participantMetaRef.current.set(payload.participantId, {
              isMuted: existing?.isMuted ?? false,
              role: payload.role,
            });
            updateParticipantRole(payload.participantId, payload.role);
          }
          if (p.participantId !== payload.participantId) return p;
          return {
            ...p,
            isMuted: payload.isMuted ?? p.isMuted,
            isCameraDisabled: payload.isCameraDisabled ?? p.isCameraDisabled,
          };
        })
      );
    });

    // Remote participant left
    const unsubParticipantLeft = client.on('remoteParticipantLeft', (event) => {
      console.log('[IVS_VIEWER][REMOTE_PARTICIPANT_LEFT]', event.payload);
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

    // Network quality updated
    const unsubNetworkQuality = client.on('networkQualityUpdated', (event) => {
      console.log('[IVS_VIEWER][NETWORK_QUALITY]', event.payload);
      const payload = event.payload as any;
      setNetworkQuality(payload.quality);
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
        const isHost = participantMeta?.role === 'host' || payload.role === 'host' || payload.slotIndex === 0;
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
        console.log('[IVS_VIEWER][REMOTE_VIDEO_ADDED]', { total, participantId: payload.participantId });
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
        console.log('[IVS_VIEWER][REMOTE_VIDEO_REMOVED]', { total, participantId: payload.participantId });
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

      console.error('[IVS_VIEWER][ERROR]', payload);
      setError(message);
      if (fatal) {
        setConnectionState('disconnected');
      }
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
      unsubSurfaceReady();
      unsubFirstFrame();
    };
  }, [
    client,
    enabled,
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
      if (connectionState !== 'connected') {
        setConnectionState('connected');
      }
    }
    // NOTE: We do NOT treat "no video yet" as "disconnected"
    // The viewer stays in "connecting" state until video arrives or an error occurs.
    // This prevents premature disconnection before the host joins or sends video.
  }, [enabled, remoteVideoTracks, connectionState]);

  useEffect(() => {
    if (connectionState === 'connected') {
      console.log('[IVS_VIEWER][MEDIA_STATE]', {
        connectionState,
        remoteParticipants: remoteParticipants.length,
        remoteVideoTracks,
      });
    }
  }, [connectionState, remoteParticipants.length, remoteVideoTracks]);

  useEffect(() => {
    if (lastSurfaceReadyRef.current !== surfaceReady) {
      console.log('[IVS_VIEWER][SURFACE_STATE]', { ready: surfaceReady });
      lastSurfaceReadyRef.current = surfaceReady;
    }
  }, [surfaceReady]);

  // Auto-reconnect for transient drops when autoJoin is enabled and no fatal error is present
  useEffect(() => {
    if (!enabled || !autoJoin) return;
    if (connectionState !== 'disconnected') return;
    if (error) return;

    const nextAttempt = reconnectAttemptsRef.current + 1;
    if (nextAttempt > 3) {
      console.warn('[IVS_VIEWER][RECONNECT_ABORTED]', { streamId, attempts: reconnectAttemptsRef.current });
      return;
    }

    const delayMs = 1000 * nextAttempt;
    console.log('[IVS_VIEWER][RECONNECT_SCHEDULED]', { streamId, attempt: nextAttempt, delayMs });
    const timer = setTimeout(() => {
      reconnectAttemptsRef.current = nextAttempt;
      console.log('[IVS_VIEWER][RECONNECT_ATTEMPT]', { streamId, attempt: reconnectAttemptsRef.current });
      void joinStream();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [autoJoin, connectionState, enabled, error, joinStream, streamId]);

  const canRender = surfaceReady && remoteVideoAdded && visibleStreams.length > 0;

  return {
    connectionState,
    networkQuality,
    remoteParticipants,
    joinStream,
    leaveStream,
    error,
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
