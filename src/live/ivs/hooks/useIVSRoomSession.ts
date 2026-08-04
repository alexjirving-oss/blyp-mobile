/**
 * IVS Room Session Hook
 *
 * Drives a hostless, open-seat group video room on top of a SHARED IVS
 * real-time stage. Every participant subscribes to everyone else; a participant
 * who claims a seat ALSO publishes their own camera/mic (no host approval).
 *
 * Two modes over one native client (a singleton, single-session):
 *   - 'viewer'    -> subscribe-only (joinAsViewer). You see the grid immediately.
 *   - 'publisher' -> publish + subscribe (startHostSession with a PUBLISH token),
 *                    exactly the battle co-host pattern, generalised to N seats.
 *
 * Capacity is authoritative on the backend: claimSeat() may resolve { full: true }
 * (HTTP 409 ROOM_FULL), in which case the caller stays a viewer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LiveStreamingClient,
  NetworkQuality,
  StreamParticipant,
  HostSessionParams,
  ViewerSessionParams,
} from '../../../streaming/LiveStreamingClient';
import { getIVSNativeClient } from '../../../streaming/IVSNativeClient';
import {
  joinRoomAsPublisher,
  joinRoomAsViewer,
  leaveRoom as apiLeaveRoom,
  roomHeartbeat,
} from '../../../api/ivsLiveApi';

export type RoomConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected';
export type RoomMode = 'idle' | 'viewer' | 'publisher';

const HEARTBEAT_INTERVAL_MS = 20_000;

type UseIVSRoomSessionArgs = {
  roomId: string;
  enabled: boolean;
  displayName?: string;
};

export type UseIVSRoomSessionResult = {
  connectionState: RoomConnectionState;
  mode: RoomMode;
  participants: StreamParticipant[];
  networkQuality: NetworkQuality;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  hasLocalVideoTrack: boolean;
  slotIndex: number | null;
  stageArn: string | null;
  sessionId: string | null;
  error: string | null;
  roomFull: boolean;
  /** Claim an open seat and start publishing. Resolves { full } when the room is full. */
  claimSeat: () => Promise<{ ok: boolean; full?: boolean; slotIndex?: number }>;
  /** Stop publishing, free the seat, and drop back to viewer. */
  releaseSeat: () => Promise<void>;
  setMicEnabled: (enabled: boolean) => Promise<void>;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  switchCamera: () => Promise<void>;
};

export function useIVSRoomSession(args: UseIVSRoomSessionArgs): UseIVSRoomSessionResult {
  const { roomId, enabled, displayName } = args;

  const [connectionState, setConnectionState] = useState<RoomConnectionState>('idle');
  const [mode, setMode] = useState<RoomMode>('idle');
  const [participants, setParticipants] = useState<StreamParticipant[]>([]);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>(NetworkQuality.UNKNOWN);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [hasLocalVideoTrack, setHasLocalVideoTrack] = useState(false);
  const [slotIndex, setSlotIndex] = useState<number | null>(null);
  const [stageArn, setStageArn] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomFull, setRoomFull] = useState(false);

  const client: LiveStreamingClient = getIVSNativeClient();
  const modeRef = useRef<RoomMode>('idle');
  modeRef.current = mode;
  const transitionRef = useRef(false);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshParticipants = useCallback(() => {
    try {
      setParticipants(client.getParticipants().filter((p) => !p.isLocal));
    } catch {
      // ignore
    }
  }, [client]);

  // ---- Heartbeat (keeps our presence/seat alive on the backend) -----------
  const startHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) return;
    const tick = () => {
      roomHeartbeat(roomId).catch(() => {});
    };
    tick();
    heartbeatTimerRef.current = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  }, [roomId]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  // ---- Viewer join (default on entering a room) ---------------------------
  const joinAsViewer = useCallback(async () => {
    if (!enabled || !roomId) return;
    try {
      setConnectionState('connecting');
      setError(null);
      const res = await joinRoomAsViewer(roomId, displayName);
      setStageArn(res.stageArn);
      setSessionId(res.sessionId);
      const params: ViewerSessionParams = {
        sessionId: res.sessionId,
        stageArn: res.stageArn,
        token: res.token,
      };
      await client.joinAsViewer(params);
      setMode('viewer');
      setConnectionState('connected');
      startHeartbeat();
      refreshParticipants();
    } catch (err) {
      console.error('[IVS_ROOM][VIEWER_JOIN_ERROR]', err);
      setError(err instanceof Error ? err.message : 'Failed to join room');
      setConnectionState('disconnected');
    }
  }, [client, displayName, enabled, refreshParticipants, roomId, startHeartbeat]);

  // ---- Claim seat -> become a publisher -----------------------------------
  const claimSeat = useCallback(async (): Promise<{ ok: boolean; full?: boolean; slotIndex?: number }> => {
    if (!enabled || !roomId) return { ok: false };
    if (transitionRef.current) return { ok: false };
    if (modeRef.current === 'publisher') return { ok: true, slotIndex: slotIndex ?? undefined };

    transitionRef.current = true;
    setRoomFull(false);
    try {
      // Authoritative seat claim + PUBLISH token. Throws code ROOM_FULL when full.
      const res = await joinRoomAsPublisher(roomId, displayName);

      // Tear down the viewer session before opening the publisher session: the
      // native client holds a single stage connection at a time.
      if (modeRef.current === 'viewer') {
        try { await client.leaveAsViewer(); } catch { /* ignore */ }
      }

      setStageArn(res.stageArn);
      setSessionId(res.sessionId);
      setSlotIndex(res.slotIndex);

      const params: HostSessionParams = {
        sessionId: res.sessionId,
        stageArn: res.stageArn,
        token: res.token,
        cameraPosition: 'front',
      };
      await client.startHostSession(params);

      // Best-effort: ensure local media is actually live.
      try { await client.setCameraEnabled(true); setIsCameraEnabled(true); } catch { /* ignore */ }
      try { await client.setMicEnabled(true); setIsMicEnabled(true); } catch { /* ignore */ }

      setMode('publisher');
      setConnectionState('connected');
      startHeartbeat();
      refreshParticipants();
      return { ok: true, slotIndex: res.slotIndex };
    } catch (err: any) {
      if (err?.code === 'ROOM_FULL') {
        setRoomFull(true);
        // Make sure we're at least watching.
        if (modeRef.current !== 'viewer') {
          await joinAsViewer();
        }
        return { ok: false, full: true };
      }
      console.error('[IVS_ROOM][CLAIM_SEAT_ERROR]', err);
      setError(err instanceof Error ? err.message : 'Failed to claim seat');
      return { ok: false };
    } finally {
      transitionRef.current = false;
    }
  }, [client, displayName, enabled, joinAsViewer, refreshParticipants, roomId, slotIndex, startHeartbeat]);

  // ---- Release seat -> back to viewer -------------------------------------
  const releaseSeat = useCallback(async () => {
    if (transitionRef.current) return;
    transitionRef.current = true;
    try {
      if (modeRef.current === 'publisher') {
        try { await client.stopHostSession(); } catch { /* ignore */ }
      }
      await apiLeaveRoom(roomId).catch(() => {});
      setSlotIndex(null);
      setMode('idle');
      // Re-subscribe as a viewer so the user keeps seeing the room.
      await joinAsViewer();
    } finally {
      transitionRef.current = false;
    }
  }, [client, joinAsViewer, roomId]);

  // ---- Media controls -----------------------------------------------------
  const setMicEnabled = useCallback(async (en: boolean) => {
    try { await client.setMicEnabled(en); setIsMicEnabled(en); } catch (e) { console.warn('[IVS_ROOM][MIC]', e); }
  }, [client]);

  const setCameraEnabled = useCallback(async (en: boolean) => {
    try { await client.setCameraEnabled(en); setIsCameraEnabled(en); } catch (e) { console.warn('[IVS_ROOM][CAM]', e); }
  }, [client]);

  const switchCamera = useCallback(async () => {
    try { await client.switchCamera(); } catch (e) { console.warn('[IVS_ROOM][SWITCH]', e); }
  }, [client]);

  // ---- Native event wiring ------------------------------------------------
  useEffect(() => {
    if (!enabled) return;

    const unsubs = [
      client.on('remoteParticipantJoined', refreshParticipants),
      client.on('remoteParticipantUpdated', refreshParticipants),
      client.on('remoteParticipantLeft', refreshParticipants),
      client.on('localJoined', () => {
        setConnectionState('connected');
        setError(null);
      }),
      client.on('networkQualityUpdated', (event) => {
        const payload = event.payload as any;
        setNetworkQuality(payload.quality);
      }),
      client.on('localMediaState', (event) => {
        const payload = event.payload as any;
        setHasLocalVideoTrack(!!payload.videoEnabled);
      }),
      client.on('error', (event) => {
        const payload = event.payload as any;
        setError(payload?.message || 'Streaming error');
        if (payload?.fatal) setConnectionState('disconnected');
      }),
    ];

    return () => { unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } }); };
  }, [client, enabled, refreshParticipants]);

  // ---- Auto-join as viewer on mount; full teardown on unmount -------------
  useEffect(() => {
    if (!enabled || !roomId) return;
    if (connectionState === 'idle') {
      void joinAsViewer();
    }
    return () => {
      stopHeartbeat();
      // Fire-and-forget cleanup: free any seat and drop the native session.
      (async () => {
        try {
          if (modeRef.current === 'publisher') {
            try { await client.stopHostSession(); } catch { /* ignore */ }
          } else {
            try { await client.leaveAsViewer(); } catch { /* ignore */ }
          }
        } finally {
          apiLeaveRoom(roomId).catch(() => {});
        }
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, roomId]);

  return {
    connectionState,
    mode,
    participants,
    networkQuality,
    isMicEnabled,
    isCameraEnabled,
    hasLocalVideoTrack,
    slotIndex,
    stageArn,
    sessionId,
    error,
    roomFull,
    claimSeat,
    releaseSeat,
    setMicEnabled,
    setCameraEnabled,
    switchCamera,
  };
}
