import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import { useAuth } from '../hooks/useCommon';
import { theme as blypTheme } from '../styles/blypTheme';
import {
  answerCall,
  declineCall,
  endCall,
  mintLiveKitToken,
  subscribeToCall,
} from '../services/callService';
import { playBlypNotify, stopBlypNotify } from '../services/notifySound';
import { cancelIncomingCallNative } from '../services/incomingCallNative';

const T = blypTheme.colors;
const TEAL = T.primary || '#FF2D55';
const CHROME = '#0A0A0C';

const RING_TIMEOUT_MS = 45_000;

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function PulseRings({ active }) {
  const a1 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      a1.setValue(0);
      return undefined;
    }
    // Single soft pulse — dual loops were burning frames on mid-range phones.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a1, {
          toValue: 1,
          duration: 1600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(a1, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, a1]);

  if (!active) return null;

  return (
    <View style={styles.pulseHost} pointerEvents="none">
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pulseRing,
          {
            opacity: a1.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }),
            transform: [
              {
                scale: a1.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

/**
 * LiveKit room wrapper — isolated so missing native modules don't crash the screen.
 * Audio session is configured for voice communication BEFORE connect (louder/clearer).
 */
function LiveKitAudioRoom({ url, token, muted, speakerOn, onConnected, onDisconnected, onError }) {
  const [RoomComp, setRoomComp] = useState(null);
  const [ready, setReady] = useState(false);
  const [AudioPresets, setAudioPresets] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line global-require
        const lk = require('@livekit/react-native');
        // eslint-disable-next-line global-require
        const client = require('livekit-client');
        const AudioSession = lk.AudioSession;
        const presets = lk.AndroidAudioTypePresets || {};

        // Order matters: configure → start → then connect room.
        try {
          await AudioSession?.configureAudio?.({
            android: {
              preferredOutputList: speakerOn
                ? ['speaker', 'bluetooth', 'headset', 'earpiece']
                : ['earpiece', 'bluetooth', 'headset', 'speaker'],
              audioTypeOptions: presets.communication || {
                manageAudioFocus: true,
                audioMode: 'inCommunication',
                audioFocusMode: 'gain',
                audioStreamType: 'voiceCall',
                audioAttributesUsageType: 'voiceCommunication',
                audioAttributesContentType: 'speech',
              },
            },
            ios: {
              defaultOutput: speakerOn ? 'speaker' : 'earpiece',
            },
          });
        } catch {
          // ignore
        }
        try {
          await AudioSession?.startAudioSession?.();
        } catch {
          // ignore
        }
        try {
          await AudioSession?.setDefaultRemoteAudioTrackVolume?.(1.0);
        } catch {
          // ignore
        }
        if (!cancelled) {
          setAudioPresets(client?.AudioPresets || null);
          setRoomComp(() => lk.LiveKitRoom);
          setReady(true);
        }
      } catch (e) {
        if (!cancelled) onError?.(e);
      }
    })();
    return () => {
      cancelled = true;
      try {
        // eslint-disable-next-line global-require
        const lk = require('@livekit/react-native');
        lk.AudioSession?.stopAudioSession?.();
      } catch {
        // ignore
      }
    };
    // Only boot once per mount; speaker changes handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onError]);

  useEffect(() => {
    if (!ready) return;
    try {
      // eslint-disable-next-line global-require
      const lk = require('@livekit/react-native');
      const AudioSession = lk.AudioSession;
      const out = speakerOn ? 'speaker' : 'earpiece';
      AudioSession?.selectAudioOutput?.(out).catch?.(() => {});
      AudioSession?.configureAudio?.({
        android: {
          preferredOutputList: speakerOn
            ? ['speaker', 'bluetooth', 'headset', 'earpiece']
            : ['earpiece', 'bluetooth', 'headset', 'speaker'],
        },
        ios: { defaultOutput: out },
      }).catch?.(() => {});
    } catch {
      // ignore
    }
  }, [ready, speakerOn]);

  if (!ready || !RoomComp || !url || !token) return null;

  const publishDefaults = AudioPresets?.speech
    ? { audioPreset: AudioPresets.speech, dtx: true, red: true }
    : AudioPresets?.music
      ? { audioPreset: AudioPresets.music, dtx: true, red: true }
      : undefined;

  return (
    <RoomComp
      serverUrl={url}
      token={token}
      connect
      audio={!muted}
      video={false}
      options={{
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // voiceIsolation is expensive on mid-range Androids and caused lag.
        },
        ...(publishDefaults ? { publishDefaults } : {}),
      }}
      onConnected={() => onConnected?.()}
      onDisconnected={() => onDisconnected?.()}
      onError={(e) => onError?.(e)}
    />
  );
}

const CallScreen = ({ route, navigation }) => {
  const insets = useSafeAreaInsets();
  const { uid } = useAuth();
  const params = route?.params || {};
  const callId = String(params.callId || '');
  const initialRole = params.role === 'callee' ? 'callee' : 'caller';
  const autoAnswer = !!params.autoAnswer;
  const peerName = String(
    params.peerName || params.otherName || params.calleeName || params.callerName || 'Blyp user',
  );
  const peerAvatar = params.peerAvatar || params.otherAvatar || null;

  const [call, setCall] = useState(null);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [mediaState, setMediaState] = useState('idle'); // idle | connecting | connected | error
  const [mediaError, setMediaError] = useState('');
  const [tokenInfo, setTokenInfo] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const endingRef = useRef(false);
  const answeredRef = useRef(false);
  const ringSoundRef = useRef(null);

  const status = String(call?.status || (initialRole === 'caller' ? 'ringing' : 'ringing'));
  const isIncoming =
    initialRole === 'callee' && status === 'ringing' && !answeredRef.current;
  const isRinging = status === 'ringing';

  // Ringtone ownership:
  // - Callee: native IncomingCallForegroundService already ringing from FCM /
  //   Firestore wake. Do NOT cancel+restart JS audio (that killed the ring and
  //   made background calls feel silent/buggy).
  // - Caller: JS play → 2s gap → play.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isRinging) {
        await stopBlypNotify(ringSoundRef.current);
        ringSoundRef.current = null;
        try {
          await cancelIncomingCallNative(callId);
        } catch {
          // ignore
        }
        return;
      }
      if (initialRole === 'callee') {
        // Leave native FG ringtone alone while incoming.
        return;
      }
      try {
        await stopBlypNotify(ringSoundRef.current);
        const sound = await playBlypNotify({ looping: true, volume: 1 });
        if (cancelled) {
          await stopBlypNotify(sound);
          return;
        }
        ringSoundRef.current = sound;
      } catch (e) {
        console.warn('[CallScreen] ringtone failed', e?.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
      stopBlypNotify(ringSoundRef.current);
      ringSoundRef.current = null;
    };
  }, [isRinging, callId, initialRole]);

  const displayName = useMemo(() => {
    if (call?.callerId === uid) return call?.calleeName || peerName;
    if (call?.calleeId === uid) return call?.callerName || peerName;
    return peerName;
  }, [call, peerName, uid]);

  useEffect(() => {
    if (!callId) return undefined;
    return subscribeToCall(
      callId,
      (next) => setCall(next),
      (err) => console.warn('[CallScreen] subscribe failed', err?.message || String(err)),
    );
  }, [callId]);

  // Auto-miss if unanswered
  useEffect(() => {
    if (!callId || status !== 'ringing' || initialRole !== 'caller') return undefined;
    const t = setTimeout(async () => {
      if (endingRef.current) return;
      endingRef.current = true;
      try {
        await endCall(callId, uid, { asMissed: true });
      } catch {
        // ignore
      }
      try {
        navigation.goBack();
      } catch {
        // ignore
      }
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [callId, status, initialRole, uid, navigation]);

  // Peer ended / declined / missed → leave
  useEffect(() => {
    if (!call) return;
    const s = String(call.status || '');
    if (s === 'ended' || s === 'declined' || s === 'missed') {
      if (endingRef.current) return;
      endingRef.current = true;
      const leave = setTimeout(() => {
        try {
          navigation.goBack();
        } catch {
          // ignore
        }
      }, 600);
      return () => clearTimeout(leave);
    }
    return undefined;
  }, [call, navigation]);

  // Connect LiveKit only after the call is active. Connecting during "ringing"
  // (old caller path) fought the ringtone audio session and made the phone UI
  // feel unusably laggy.
  useEffect(() => {
    let cancelled = false;
    const shouldConnect = !!callId && status === 'active';
    if (!shouldConnect) return undefined;
    if (tokenInfo) return undefined;

    (async () => {
      setMediaState('connecting');
      const minted = await mintLiveKitToken(callId);
      if (cancelled) return;
      if (!minted.ok) {
        setMediaState('error');
        setMediaError(
          minted.reason === 'livekit-not-configured'
            ? 'Calls are not configured on the server yet'
            : minted.reason === 'mic-denied'
              ? 'Microphone permission required'
              : `Could not connect (${minted.reason})`,
        );
        return;
      }
      setTokenInfo(minted);
    })();

    return () => {
      cancelled = true;
    };
  }, [callId, status, tokenInfo]);

  // Duration timer while active
  useEffect(() => {
    if (status !== 'active') return undefined;
    const started =
      call?.answeredAtMs ||
      (call?.answeredAt?.toMillis ? call.answeredAt.toMillis() : Date.now());
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, call]);

  const stopAllRinging = useCallback(async () => {
    await stopBlypNotify(ringSoundRef.current);
    ringSoundRef.current = null;
    try {
      await cancelIncomingCallNative(callId);
    } catch {
      // ignore
    }
  }, [callId]);

  const handleHangUp = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    await stopAllRinging();
    try {
      const asMissed = status === 'ringing' && initialRole === 'caller';
      await endCall(callId, uid, { asMissed });
    } catch {
      // ignore
    }
    try {
      navigation.goBack();
    } catch {
      // ignore
    }
  }, [callId, uid, status, initialRole, navigation, stopAllRinging]);

  const handleDecline = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    await stopAllRinging();
    try {
      await declineCall(callId, uid);
    } catch {
      // ignore
    }
    try {
      navigation.goBack();
    } catch {
      // ignore
    }
  }, [callId, uid, navigation, stopAllRinging]);

  const handleAccept = useCallback(async () => {
    answeredRef.current = true;
    await stopAllRinging();
    setMediaState('connecting');
    const res = await answerCall(callId, uid);
    if (!res.ok) {
      setMediaState('error');
      setMediaError(res.reason === 'mic-denied' ? 'Microphone permission required' : 'Could not answer');
      answeredRef.current = false;
    }
  }, [callId, uid, stopAllRinging]);

  // Messenger-style: Answer on the notification opens Call with autoAnswer.
  useEffect(() => {
    if (!autoAnswer) return undefined;
    if (initialRole !== 'callee') return undefined;
    if (answeredRef.current) return undefined;
    if (status !== 'ringing') return undefined;
    if (!uid || !callId) return undefined;
    const t = setTimeout(() => {
      handleAccept().catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [autoAnswer, initialRole, status, uid, callId, handleAccept]);

  const statusLabel = useMemo(() => {
    if (mediaState === 'error') return mediaError || 'Connection error';
    if (status === 'active') return formatDuration(elapsed);
    if (status === 'ringing' && initialRole === 'caller') return 'Calling…';
    if (isIncoming) return 'Incoming audio call';
    if (mediaState === 'connecting') return 'Connecting…';
    if (status === 'declined') return 'Declined';
    if (status === 'missed') return 'Missed';
    if (status === 'ended') return 'Call ended';
    return 'Phone';
  }, [status, elapsed, initialRole, isIncoming, mediaState, mediaError]);

  if (!callId) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Text style={styles.status}>Missing call</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.roundBtn}>
          <Icon name="close" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.bloom} pointerEvents="none" />
      {tokenInfo?.url && tokenInfo?.token ? (
        <LiveKitAudioRoom
          url={tokenInfo.url}
          token={tokenInfo.token}
          muted={muted}
          speakerOn={speakerOn}
          onConnected={() => setMediaState('connected')}
          onDisconnected={() => {
            if (!endingRef.current && status === 'active') {
              handleHangUp();
            }
          }}
          onError={(e) => {
            setMediaState('error');
            setMediaError(e?.message || 'Audio failed — rebuild may be required');
          }}
        />
      ) : null}

      <View style={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 36 }]}>
        <View style={styles.topMeta}>
          <Text style={styles.brandMark}>blyp</Text>
          <Text style={styles.topHint}>Audio call</Text>
        </View>

        <View style={styles.peerBlock}>
          <View style={styles.avatarWrap}>
            <PulseRings active={isRinging} />
            {peerAvatar ? (
              <Image source={{ uri: peerAvatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Icon name="person" size={52} color={TEAL} />
              </View>
            )}
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={styles.statusRow}>
            {isRinging ? <View style={styles.statusPip} /> : null}
            <Text style={[styles.status, mediaState === 'error' && styles.statusError]}>{statusLabel}</Text>
          </View>
          {mediaState === 'connecting' ? (
            <ActivityIndicator color={TEAL} style={{ marginTop: 18 }} />
          ) : null}
        </View>

        {isIncoming ? (
          <View style={styles.actionsColumn}>
            <View style={styles.actions}>
              <View style={styles.actionWithLabel}>
                <TouchableOpacity
                  style={[styles.roundBtn, styles.decline]}
                  onPress={handleDecline}
                  accessibilityLabel="Decline call"
                >
                  <Icon name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Decline</Text>
              </View>
              <View style={styles.actionWithLabel}>
                <TouchableOpacity
                  style={[styles.roundBtn, styles.accept]}
                  onPress={handleAccept}
                  accessibilityLabel="Accept call"
                >
                  <Icon name="call" size={28} color={CHROME} />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Accept</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.actionsColumn}>
            <View style={styles.actions}>
              <View style={styles.actionWithLabel}>
                <TouchableOpacity
                  style={[styles.roundBtn, styles.secondary, muted && styles.secondaryActive]}
                  onPress={() => setMuted((m) => !m)}
                  accessibilityLabel={muted ? 'Unmute' : 'Mute'}
                >
                  <Icon name={muted ? 'mic-off' : 'mic'} size={24} color={muted ? CHROME : '#fff'} />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>{muted ? 'Unmute' : 'Mute'}</Text>
              </View>
              <View style={styles.actionWithLabel}>
                <TouchableOpacity
                  style={[styles.roundBtn, styles.hangup]}
                  onPress={handleHangUp}
                  accessibilityLabel="End call"
                >
                  <Icon name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>End</Text>
              </View>
              <View style={styles.actionWithLabel}>
                <TouchableOpacity
                  style={[styles.roundBtn, styles.secondary, speakerOn && styles.secondaryActive]}
                  onPress={() => setSpeakerOn((s) => !s)}
                  accessibilityLabel={speakerOn ? 'Speaker on' : 'Speaker off'}
                >
                  <Icon
                    name={speakerOn ? 'volume-high' : 'volume-low'}
                    size={24}
                    color={speakerOn ? CHROME : '#fff'}
                  />
                </TouchableOpacity>
                <Text style={styles.actionLabel}>Speaker</Text>
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CHROME,
  },
  bloom: {
    position: 'absolute',
    top: '12%',
    alignSelf: 'center',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(255, 45, 85, 0.10)',
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  topMeta: {
    alignItems: 'center',
  },
  brandMark: {
    color: TEAL,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'lowercase',
  },
  topHint: {
    marginTop: 4,
    color: T.textSecondary || '#9CA3AF',
    fontSize: 13,
    fontWeight: '500',
  },
  peerBlock: {
    alignItems: 'center',
  },
  avatarWrap: {
    width: 148,
    height: 148,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  pulseHost: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 2,
    borderColor: TEAL,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: 'rgba(255, 45, 85, 0.35)',
  },
  avatarPlaceholder: {
    backgroundColor: '#141418',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 10,
    paddingHorizontal: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusPip: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TEAL,
  },
  status: {
    color: T.textSecondary || '#9CA3AF',
    fontSize: 16,
    fontWeight: '500',
  },
  statusError: {
    color: '#F87171',
  },
  actionsColumn: {
    paddingBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: 36,
  },
  actionWithLabel: {
    alignItems: 'center',
    gap: 10,
  },
  actionLabel: {
    color: T.textSecondary || '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  roundBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangup: {
    backgroundColor: '#EF4444',
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  decline: {
    backgroundColor: '#EF4444',
  },
  accept: {
    backgroundColor: TEAL,
  },
  secondary: {
    backgroundColor: '#1A1A1E',
  },
  secondaryActive: {
    backgroundColor: TEAL,
  },
});

export default CallScreen;
