/**
 * IVS Host Session Hook
 * 
 * React hook for managing IVS streaming session from host perspective.
 * Uses LiveStreamingClient abstraction for unified multi-platform support.
 * Handles host lifecycle, local media state, token fetching, and participants tracking.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  LiveStreamingClient,
  StreamParticipant,
  NetworkQuality,
  HostSessionParams,
} from '../../../streaming/LiveStreamingClient';
import { getIVSNativeClient } from '../../../streaming/IVSNativeClient';
import { startHostLive, endHostLive, startBattleStageLive, joinBattleStageLive } from '../../../api/ivsLiveApi';

export type IVSConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

export type BattleSessionConfig = {
  battleId: string;
  role: 'creator' | 'opponent';
  /** For the opponent: the creator's existing stage session id to join. */
  sessionId?: string;
};

type UseIVSHostSessionArgs = {
  enabled: boolean;
  streamId?: string;
  title?: string;
  /** When present, this is a co-host battle (both participants publish to one stage). */
  battle?: BattleSessionConfig;
  /** Fired after a battle stage is created/joined with the resolved session info. */
  onBattleStarted?: (info: { battleId: string; role: 'creator' | 'opponent'; sessionId: string; stageArn: string }) => void;
};

type UseIVSHostSessionResult = {
  connectionState: IVSConnectionState;
  participants: StreamParticipant[];
  networkQuality: NetworkQuality;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  hasLocalVideoTrack: boolean;
  hasLocalAudioTrack: boolean;
  startStreaming: (cameraPosition?: 'front' | 'back', attemptId?: string) => Promise<string>;
  stopStreaming: () => Promise<void>;
  setMicEnabled: (enabled: boolean) => Promise<void>;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  switchCamera: () => Promise<void>;
  error: string | null;
  streamId: string | null;
  streamIdRef: React.MutableRefObject<string | null>;
  sessionId: string | null;
  enabled: boolean;
};

export function useIVSHostSession(args: UseIVSHostSessionArgs): UseIVSHostSessionResult {
  const { enabled, streamId: externalStreamId, title, battle, onBattleStarted } = args;
  const battleRef = useRef(battle);
  battleRef.current = battle;
  const onBattleStartedRef = useRef(onBattleStarted);
  onBattleStartedRef.current = onBattleStarted;

  const [connectionState, setConnectionState] = useState<IVSConnectionState>('idle');
  const [participants, setParticipants] = useState<StreamParticipant[]>([]);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>(NetworkQuality.UNKNOWN);
  const [isMicEnabled, setIsMicEnabledState] = useState(true);
  const [isCameraEnabled, setIsCameraEnabledState] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(externalStreamId || null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hasLocalVideoTrack, setHasLocalVideoTrack] = useState(false);
  const [hasLocalAudioTrack, setHasLocalAudioTrack] = useState(false);
  
  // Use ref for immediate access to streamId (state updates are async)
  const streamIdRef = useRef<string | null>(externalStreamId || null);
  const sessionIdRef = useRef<string | null>(null);
  const startedRef = useRef<boolean>(false);

  const client: LiveStreamingClient = getIVSNativeClient();

  const resetHostSessionState = useCallback(() => {
    setConnectionState('idle');
    setStreamId(null);
    streamIdRef.current = null;
    setSessionId(null);
    sessionIdRef.current = null;
    startedRef.current = false;
  }, []);

  const generateClientSessionId = (attemptId?: string): string => {
    if (attemptId && typeof attemptId === 'string' && attemptId.length > 0) {
      return attemptId;
    }
    const randomUUID = (global as any)?.crypto?.randomUUID?.();
    if (randomUUID && typeof randomUUID === 'string') {
      return randomUUID;
    }
    return `client-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  };

  // Fetch token and start native broadcast
  const startStreaming = useCallback(async (cameraPosition: 'front' | 'back' = 'front', attemptId?: string): Promise<string> => {
    console.log('[TRACE][HOST] startStreaming ENTER');
    console.log('[LIVE][IVS_START_STREAMING] calling native startHostSession');
    if (startedRef.current) {
      const msg = 'IVS host session already started';
      console.warn('[TRACE][HOST] ABORT:', msg);
      throw new Error(msg);
    }
    if (!enabled) {
      const msg = 'IVS host session not enabled';
      console.error('[TRACE][HOST] ABORT:', msg);
      setError(msg);
      resetHostSessionState();
      throw new Error(msg);
    }
    
    startedRef.current = true;
    console.log('[ASSERT][HOST] startStreaming invoked — native MUST be called next');

    console.log('[TRACE][HOST] guards passed');

    try {
      setConnectionState('connecting');
      setError(null);

      console.log('[LIVE][IVS_HOST_START_REQUEST]', { streamId: streamIdRef.current, title });

      // 1. Fetch participant token from backend. For battles, both participants
      // publish to ONE shared stage: the creator creates it, the opponent joins it.
      const battleCfg = battleRef.current;
      console.log('[TRACE][HOST] calling backend start', { battle: battleCfg?.role });
      let response;
      try {
        if (battleCfg && battleCfg.role === 'creator') {
          response = await startBattleStageLive(battleCfg.battleId, title || 'Battle');
        } else if (battleCfg && battleCfg.role === 'opponent') {
          if (!battleCfg.sessionId) throw new Error('Battle session not ready yet');
          const joined = await joinBattleStageLive(battleCfg.sessionId, battleCfg.battleId);
          response = { sessionId: joined.sessionId, streamId: joined.sessionId, stageArn: joined.stageArn, token: joined.token };
        } else {
          response = await startHostLive(title || 'Live Stream', attemptId);
        }
      } catch (e) {
        console.error('[TRACE][HOST] backend start FAILED', e);
        throw e;
      }
      console.log('[TRACE][HOST] backend start RESOLVED', response);

      // 2. Validate response has required fields (stageArn/token only)
      const hasStageArn = typeof response.stageArn === 'string' && response.stageArn.length > 0;
      const hasToken = typeof response.token === 'string' && response.token.length > 0;

      if (!hasStageArn || !hasToken) {
        console.error('[IVS_HOST][START_ERROR_MISSING_FIELDS]', {
          sessionId: response.sessionId,
          stageArn: response.stageArn,
          hasToken,
          raw: response,
        });
        const msg = 'IVS host start failed: missing stageArn/token from backend';
        setError(msg);
        resetHostSessionState();
        throw new Error(msg);
      }

      const backendSessionId = response.sessionId || (response as any)?.session?.sessionId || response.streamId;
      const effectiveSessionId = backendSessionId || generateClientSessionId(attemptId);

      console.log('[HOST][SESSION_CREATED]', {
        sessionId: effectiveSessionId,
        backendSessionId,
        stageArn: response.stageArn,
        tokenLength: response.token.length,
      });

      // 3. Determine effective streamId for Real-Time (use backend sessionId when present)
      streamIdRef.current = effectiveSessionId;
      setStreamId(effectiveSessionId);
      setSessionId(effectiveSessionId);
      sessionIdRef.current = effectiveSessionId;

      // 4. Start host session via LiveStreamingClient
      const hostParams: HostSessionParams = {
        stageArn: response.stageArn,
        token: response.token,
        sessionId: effectiveSessionId,
        cameraPosition,
      };

      console.log('[TRACE][HOST] NATIVE_CALL_READY', {
        sessionId: effectiveSessionId,
        stageArnPresent: !!response.stageArn,
        tokenLen: response.token?.length || 0,
      });

      console.log('[IVS_HOST][STARTING_NATIVE_SESSION]', {
        stageArn: response.stageArn,
        tokenLength: response.token.length,
      });

      console.log('[TRACE][HOST] calling native startHostSession');
      await client.startHostSession(hostParams);
      console.log('[TRACE][HOST] native startHostSession INVOKED');

      // Best-effort: ensure local media is actually enabled.
      // Some native implementations default mic to muted/disabled until explicitly enabled.
      try {
        await client.setCameraEnabled(true);
        setIsCameraEnabledState(true);
      } catch (mediaErr) {
        console.warn('[IVS_HOST][SET_CAMERA_POST_START_FAILED]', mediaErr);
      }

      try {
        await client.setMicEnabled(true);
        setIsMicEnabledState(true);
        console.log('[IVS_HOST][MIC_ENABLED_POST_START]');
      } catch (mediaErr) {
        console.warn('[IVS_HOST][SET_MIC_POST_START_FAILED]', mediaErr);
      }

      // NOTE: Do NOT set connectionState to 'connected' here.
      // The hook will wait for the native 'localJoined' event to confirm the session truly joined.
      // connectionState stays 'connecting' until that event fires.
      console.log('[IVS_HOST][BROADCAST_SESSION_STARTED]', { sessionId: effectiveSessionId });

      // Battle attendance + status mirror: tell the app this participant turned up.
      if (battleCfg) {
        try {
          onBattleStartedRef.current?.({
            battleId: battleCfg.battleId,
            role: battleCfg.role,
            sessionId: effectiveSessionId,
            stageArn: response.stageArn,
          });
        } catch (cbErr) {
          console.warn('[IVS_HOST][BATTLE_STARTED_CB_FAILED]', cbErr);
        }
      }

      setTimeout(() => {
        if (!sessionIdRef.current) {
          console.error('[ASSERT][HOST] IVS native start did NOT occur');
        }
      }, 3000);

      console.log('[TRACE][HOST] startStreaming EXIT');
      return effectiveSessionId;
    } catch (err) {
      console.error('[IVS_HOST][START_ERROR]', err);
      const msg = err instanceof Error ? err.message : 'Failed to start streaming';
      setError(msg);
      resetHostSessionState();
      throw err instanceof Error ? err : new Error(msg);
    }
  }, [client, enabled, resetHostSessionState, title]);

  // Stop streaming and disconnect
  const stopStreaming = useCallback(async () => {
    try {
      console.log('[IVS_HOST][STOP_STREAMING]', { streamId: streamIdRef.current });
      
      // 1. Notify backend that session is ending
      if (streamIdRef.current) {
        console.log('[IVS_HOST][CALLING_END_HOST_LIVE]', { sessionId: streamIdRef.current });
        try {
          await endHostLive(streamIdRef.current);
          console.log('[IVS_HOST][END_HOST_LIVE_SUCCESS]');
        } catch (backendErr) {
          console.warn('[IVS_HOST][END_HOST_LIVE_ERROR]', backendErr);
          // Continue with local cleanup even if backend call fails
        }
      }
      
      // 2. Stop native broadcast session
      await client.stopHostSession();
      
      resetHostSessionState();
      console.log('[IVS_HOST][STREAMING_STOPPED]');
    } catch (err) {
      console.error('[IVS_HOST][STOP_ERROR]', err);
      setError(err instanceof Error ? err.message : 'Failed to stop streaming');
      setConnectionState('disconnected');
    }
  }, [client, resetHostSessionState]);

  // Media control callbacks
  const setMicEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        await client.setMicEnabled(enabled);
        setIsMicEnabledState(enabled);
      } catch (err) {
        console.error('[IVS_HOST][SET_MIC_ERROR]', err);
        throw err;
      }
    },
    [client]
  );

  const setCameraEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        await client.setCameraEnabled(enabled);
        setIsCameraEnabledState(enabled);
      } catch (err) {
        console.error('[IVS_HOST][SET_CAMERA_ERROR]', err);
        throw err;
      }
    },
    [client]
  );

  const switchCamera = useCallback(async () => {
    try {
      await client.switchCamera();
    } catch (err) {
      console.error('[IVS_HOST][SWITCH_CAMERA_ERROR]', err);
      throw err;
    }
  }, [client]);

  // Listen to LiveStreamingClient events
  useEffect(() => {
    if (!enabled) return;

    // Local participant joined – this is the TRUE "connected" signal from native
    const unsubLocalJoined = client.on('localJoined', (event) => {
      console.log('[IVS_HOST][LOCAL_JOINED]', event.payload);
      // Transition to "connected" only when we receive native confirmation that the local
      // participant successfully joined the stage.
      setConnectionState('connected');
      setError(null);
      if (event.type === 'localJoined') {
        console.log('[LIVE][IVS_HOST_SESSION_CONNECTED]', {
          backend: 'ivs',
          connectionState: 'connected',
          participantId: event.payload.participantId,
          role: event.payload.role,
        });
      }
    });

    // Local participant left – transition back to idle/disconnected
    const unsubLocalLeft = client.on('localLeft', (event) => {
      console.log('[IVS_HOST][LOCAL_LEFT]', event.payload);
      setConnectionState('disconnected');
      setParticipants([]);
      if (event.type === 'localLeft') {
        console.log('[LIVE][IVS_HOST_SESSION_DISCONNECTED]', {
          backend: 'ivs',
          connectionState: 'disconnected',
          reason: event.payload.reason,
        });
      }
    });

    // Remote participant joined
    const unsubRemoteJoined = client.on('remoteParticipantJoined', (event) => {
      console.log('[IVS_HOST][REMOTE_JOINED]', event.payload);
      // Update participants list
      setParticipants(client.getParticipants());
    });

    // Remote participant updated
    const unsubRemoteUpdated = client.on('remoteParticipantUpdated', (event) => {
      console.log('[IVS_HOST][REMOTE_UPDATED]', event.payload);
      // Update participants list
      setParticipants(client.getParticipants());
    });

    // Remote participant left
    const unsubRemoteLeft = client.on('remoteParticipantLeft', (event) => {
      console.log('[IVS_HOST][REMOTE_LEFT]', event.payload);
      // Update participants list
      setParticipants(client.getParticipants());
    });

    // Network quality updated
    const unsubNetworkQuality = client.on('networkQualityUpdated', (event) => {
      console.log('[IVS_HOST][NETWORK_QUALITY]', event.payload);
      const payload = event.payload as any;
      setNetworkQuality(payload.quality);
    });

    // Local media availability (camera/mic)
    const unsubLocalMedia = client.on('localMediaState', (event) => {
      const payload = event.payload as any;
      const videoEnabled = !!payload.videoEnabled;
      const audioEnabled = !!payload.audioEnabled;
      setHasLocalVideoTrack(videoEnabled);
      setHasLocalAudioTrack(audioEnabled);
      console.log('[IVS_HOST][MEDIA_STATE]', {
        connectionState,
        hasLocalVideoTrack: videoEnabled,
        hasLocalAudioTrack: audioEnabled,
      });
    });

    // Error event
    const unsubError = client.on('error', (event) => {
      console.error('[IVS_HOST][ERROR]', event.payload);
      const payload = event.payload as any;
      setError(payload.message);
      if (payload.fatal) {
        setConnectionState('disconnected');
      }
    });

    // Cleanup subscriptions on unmount
    return () => {
      unsubLocalJoined();
      unsubLocalLeft();
      unsubRemoteJoined();
      unsubRemoteUpdated();
      unsubRemoteLeft();
      unsubNetworkQuality();
      unsubLocalMedia();
      unsubError();
    };
  }, [enabled, client]);

  useEffect(() => {
    if (connectionState === 'connected') {
      console.log('[IVS_HOST][MEDIA_STATE_CONNECTED]', {
        connectionState,
        hasLocalVideoTrack,
        hasLocalAudioTrack,
      });
    }
  }, [connectionState, hasLocalAudioTrack, hasLocalVideoTrack]);

  return {
    connectionState,
    participants,
    networkQuality,
    isMicEnabled,
    isCameraEnabled,
    startStreaming,
    stopStreaming,
    setMicEnabled,
    setCameraEnabled,
    switchCamera,
    error,
    streamId: streamIdRef.current,
    sessionId,
    streamIdRef,
    hasLocalVideoTrack,
    hasLocalAudioTrack,
    enabled,
  };
}
