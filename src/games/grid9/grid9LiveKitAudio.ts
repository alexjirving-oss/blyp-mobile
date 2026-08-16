/**
 * Grid 9 LiveKit loudspeaker pin. Local to src/games/grid9 — does not edit
 * frozen LIVE / IVS files.
 *
 * Samsung Fold (and some other OEMs) put MODE_IN_COMMUNICATION on the
 * earpiece/receiver when the first publisher's WebRTC peer connects. LIVE
 * repairs that with MODE_IN_COMMUNICATION + builtin SPEAKER + speakerphoneOn
 * and a post-join burst. Grid 9 copies that via BlypAudioRoute.applyCallSpeaker
 * (already in the app) plus LiveKit speaker-first AudioSession config.
 */
import { Platform } from 'react-native';

/** Same post-join burst LIVE uses after guest WebRTC connect (Fold OEM snap). */
export const GRID9_LOUDSPEAKER_REASSERT_MS = [400, 1200, 2800, 5000] as const;
export const GRID9_LOUDSPEAKER_WATCHDOG_MS = 2000;

let guardToken = 0;
let liveKitAudioActive = false;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
const burstTimers: ReturnType<typeof setTimeout>[] = [];

export function isGrid9LiveKitAudioActive(): boolean {
  return liveKitAudioActive;
}

export function grid9LiveKitAudioConfig(presets?: {
  communication?: Record<string, unknown>;
}): {
  android: {
    preferredOutputList: string[];
    audioTypeOptions: Record<string, unknown>;
  };
  ios: { defaultOutput: 'speaker' };
} {
  return {
    android: {
      preferredOutputList: ['speaker', 'bluetooth', 'headset', 'earpiece'],
      audioTypeOptions: presets?.communication || {
        manageAudioFocus: true,
        audioMode: 'inCommunication',
        audioFocusMode: 'gain',
        audioStreamType: 'voiceCall',
        audioAttributesUsageType: 'voiceCommunication',
        audioAttributesContentType: 'speech',
      },
    },
    ios: { defaultOutput: 'speaker' },
  };
}

function clearGuardTimers(): void {
  while (burstTimers.length) {
    const id = burstTimers.pop();
    if (id != null) clearTimeout(id);
  }
  if (watchdogTimer != null) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

async function applyNativeCallSpeaker(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    // Existing RN module: MODE_IN_COMMUNICATION + setCommunicationDevice(SPEAKER)
    // + setSpeakerphoneOn(true). Same pin LIVE uses; not an IVS file.
    // eslint-disable-next-line global-require
    const { applyCallSpeaker } = require('../../services/blypAudioRoute');
    await applyCallSpeaker();
  } catch {
    /* soft */
  }
}

async function applyIosPlayAndRecordSpeaker(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    // eslint-disable-next-line global-require
    const { Audio, InterruptionModeAndroid, InterruptionModeIOS } = require('expo-av');
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });
  } catch {
    /* soft */
  }
}

function liveKitModule(lk?: any): any {
  if (lk?.AudioSession) return lk;
  try {
    // eslint-disable-next-line global-require
    return require('@livekit/react-native');
  } catch {
    return lk || null;
  }
}

async function selectLiveKitSpeaker(lk?: any): Promise<void> {
  try {
    const session = liveKitModule(lk)?.AudioSession;
    await session?.selectAudioOutput?.('speaker');
    await session?.setAppleAudioConfiguration?.({
      audioCategory: 'playAndRecord',
      audioCategoryOptions: ['allowBluetooth', 'defaultToSpeaker'],
    });
  } catch {
    /* soft */
  }
}

/** Pin loudspeaker on every human seat (first joiner and later joiners). */
export async function forceGrid9Loudspeaker(lk?: any): Promise<void> {
  await applyNativeCallSpeaker();
  await applyIosPlayAndRecordSpeaker();
  await selectLiveKitSpeaker(lk);
}

export async function configureGrid9LiveKitAudio(lk: any): Promise<void> {
  const AudioSession = lk?.AudioSession;
  const presets = lk?.AndroidAudioTypePresets || {};
  try {
    await AudioSession?.configureAudio?.(grid9LiveKitAudioConfig(presets));
  } catch {
    /* soft */
  }
  try {
    await AudioSession?.startAudioSession?.();
  } catch {
    /* soft */
  }
  try {
    await AudioSession?.setDefaultRemoteAudioTrackVolume?.(1.0);
  } catch {
    /* soft */
  }
  await forceGrid9Loudspeaker(lk);
}

export function startGrid9LoudspeakerGuard(lk?: any): void {
  clearGuardTimers();
  liveKitAudioActive = true;
  const token = ++guardToken;
  void forceGrid9Loudspeaker(lk);
  for (const ms of GRID9_LOUDSPEAKER_REASSERT_MS) {
    burstTimers.push(
      setTimeout(() => {
        if (token !== guardToken || !liveKitAudioActive) return;
        void forceGrid9Loudspeaker(lk);
      }, ms),
    );
  }
  watchdogTimer = setInterval(() => {
    if (token !== guardToken || !liveKitAudioActive) return;
    void forceGrid9Loudspeaker(lk);
  }, GRID9_LOUDSPEAKER_WATCHDOG_MS);
}

/** Restart the Fold post-join burst (remote peer connect snaps earpiece). */
export function burstGrid9Loudspeaker(lk?: any): void {
  if (!liveKitAudioActive) return;
  startGrid9LoudspeakerGuard(lk);
}

export function reassertGrid9Loudspeaker(lk?: any): void {
  if (!liveKitAudioActive) return;
  void forceGrid9Loudspeaker(lk);
}

export async function stopGrid9LoudspeakerGuard(lk?: any): Promise<void> {
  guardToken += 1;
  clearGuardTimers();
  liveKitAudioActive = false;
  try {
    lk?.AudioSession?.stopAudioSession?.();
  } catch {
    /* soft */
  }
  if (Platform.OS !== 'android') return;
  try {
    // eslint-disable-next-line global-require
    const { applyMediaSpeaker } = require('../../services/blypAudioRoute');
    await applyMediaSpeaker();
  } catch {
    /* soft */
  }
}
