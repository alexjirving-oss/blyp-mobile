import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View as RNView } from 'react-native';
import {
  fetchGrid9LiveKitToken,
  type Grid9LiveKitCreds,
} from './grid9LiveKitToken';
import { requestCameraAndAudioPermission } from '../../utils/permissions';
import {
  burstGrid9Loudspeaker,
  configureGrid9LiveKitAudio,
  startGrid9LoudspeakerGuard,
  stopGrid9LoudspeakerGuard,
} from './grid9LiveKitAudio';
import { Text, View } from './nw';

/**
 * Grid9-local LiveKit room: combatants publish camera+mic; spotlight renders
 * the selected participant video. Fail-soft — never null-crash the arena.
 *
 * Default path attempts permissions + publish when `publish` is true (join/start).
 */
export function Grid9LiveKitSession({
  matchId,
  enabled,
  publish,
  spotlightParticipantId,
  onStatus,
}: {
  matchId: string | null;
  enabled: boolean;
  publish: boolean;
  spotlightParticipantId: string | null;
  onStatus?: (status: string) => void;
}) {
  const [creds, setCreds] = useState<Grid9LiveKitCreds | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mods, setMods] = useState<{
    LiveKitRoom: React.ComponentType<any>;
    VideoTrack: React.ComponentType<any>;
    useTracks: (sources?: any, opts?: any) => any[];
    TrackSource: any;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !matchId) {
      setCreds(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let allowedToPublish = false;
        if (publish) {
          onStatus?.('requesting-permission');
          allowedToPublish = await requestCameraAndAudioPermission();
          if (!allowedToPublish) {
            if (!cancelled) {
              setPermissionDenied(true);
              onStatus?.('permission-denied');
            }
          } else if (!cancelled) {
            setPermissionDenied(false);
          }
        }
        const next = await fetchGrid9LiveKitToken(matchId);
        if (cancelled) return;
        if (!next) {
          setCreds(null);
          onStatus?.('unavailable');
          return;
        }
        setCreds(next);
        if (publish && !allowedToPublish) {
          onStatus?.('permission-denied');
        } else {
          onStatus?.('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'LiveKit failed');
          onStatus?.('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, matchId, publish, onStatus]);

  useEffect(() => {
    if (!creds) {
      setMods(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line global-require
        const lk = require('@livekit/react-native');
        // eslint-disable-next-line global-require
        const client = require('livekit-client');
        await configureGrid9LiveKitAudio(lk);
        if (cancelled) {
          await stopGrid9LoudspeakerGuard(lk);
          return;
        }
        startGrid9LoudspeakerGuard(lk);
        setMods({
          LiveKitRoom: lk.LiveKitRoom,
          VideoTrack: lk.VideoTrack,
          useTracks: lk.useTracks,
          TrackSource: client?.Track?.Source || null,
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'LiveKit module missing');
          onStatus?.('module-missing');
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        // eslint-disable-next-line global-require
        const lk = require('@livekit/react-native');
        void stopGrid9LoudspeakerGuard(lk);
      } catch {
        void stopGrid9LoudspeakerGuard();
      }
    };
  }, [creds, onStatus]);

  if (permissionDenied && publish) {
    return (
      <View className="absolute inset-0 items-center justify-center bg-blyp-ink/80 px-4">
        <Text className="text-center text-[11px] font-black uppercase tracking-[2px] text-blyp-primary">
          Camera / mic needed
        </Text>
        <Text className="mt-1 text-center text-[10px] font-semibold text-blyp-muted">
          Allow permissions to appear on the spotlight stage.
        </Text>
      </View>
    );
  }

  if (!creds || !mods || error) {
    return null;
  }

  const Room = mods.LiveKitRoom;
  const shouldPublish = Boolean(publish && creds.canPublish && !permissionDenied);
  return (
    <RNView style={StyleSheet.absoluteFill} pointerEvents="none">
      <Room
        serverUrl={creds.url}
        token={creds.token}
        connect
        audio={shouldPublish}
        video={shouldPublish}
        options={{ adaptiveStream: true, dynacast: true, autoSubscribe: true }}
        onConnected={() => burstGrid9Loudspeaker()}
        onError={() => onStatus?.('room-error')}
      >
        <Grid9LiveKitSpotlightVideo
          spotlightParticipantId={spotlightParticipantId}
          VideoTrack={mods.VideoTrack}
          useTracks={mods.useTracks}
          TrackSource={mods.TrackSource}
        />
      </Room>
    </RNView>
  );
}

function Grid9LiveKitSpotlightVideo({
  spotlightParticipantId,
  VideoTrack,
  useTracks,
  TrackSource,
}: {
  spotlightParticipantId: string | null;
  VideoTrack: React.ComponentType<any>;
  useTracks: (sources?: any, opts?: any) => any[];
  TrackSource: any;
}) {
  // useTracks([Track.Source.Camera]) — object `{ sources }` is invalid API.
  const cameraSource = TrackSource?.Camera ?? 'camera';
  const tracks = useTracks([cameraSource], { onlySubscribed: false });
  const track = useMemo(() => {
    if (!spotlightParticipantId || !Array.isArray(tracks)) return null;
    return (
      tracks.find((item: any) => {
        const identity = String(item?.participant?.identity || '').trim();
        const name = String(item?.participant?.name || '').trim();
        return (
          Boolean(item?.publication) &&
          (identity === spotlightParticipantId || name === spotlightParticipantId)
        );
      }) ?? null
    );
  }, [spotlightParticipantId, tracks]);

  if (!track) return null;
  return (
    <RNView style={StyleSheet.absoluteFill}>
      <VideoTrack trackRef={track} style={StyleSheet.absoluteFill} objectFit="cover" />
    </RNView>
  );
}
