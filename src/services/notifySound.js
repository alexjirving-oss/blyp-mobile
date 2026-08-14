/**
 * Shared Blyp notify sting — same asset for push, in-app messages, and call ringtone.
 * Call ringing uses play → 2s silence → play (never seamless isLooping).
 *
 * Chat / notify beeps MUST use media loudspeaker routing — never voice-call / earpiece.
 * expo-av merges partial setAudioModeAsync with the prior mode, so we always set a full
 * playback profile (especially allowsRecordingIOS: false + playThroughEarpieceAndroid: false).
 */

import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { applyMediaSpeaker } from './blypAudioRoute';
import { isLiveAudioSessionActive, isLiveStagePublishing } from './livePublishAudioGuard';

const BLYP_NOTIFY = require('../../assets/sounds/blyp_notify.wav');

/** Silence between ringtone plays while a call is ringing. */
export const RING_GAP_MS = 2000;

let ringModeActive = false;
/** 'media' | 'ring' | null — skip redundant setAudioModeAsync (kills ExoPlayer audio). */
let appliedAudioProfile = null;

export function invalidateMediaPlaybackAudioMode() {
  appliedAudioProfile = null;
}

/**
 * For You / post-call reclaim. expo-av MODE_NORMAL is not enough: Samsung
 * keeps TYPE_BUILTIN_EARPIECE after clearCommunicationDevice(). Native
 * applyMediaSpeaker pins builtin SPEAKER and displaces VOICE_COMMUNICATION.
 */
export async function reclaimMediaPlaybackRoute() {
  // Never steal IVS Stage/Player route while any live path is active.
  if (isLiveAudioSessionActive() || isLiveStagePublishing()) {
    return null;
  }
  invalidateMediaPlaybackAudioMode();
  await ensureMediaPlaybackAudioMode({ background: false });
  return applyMediaSpeaker();
}

/**
 * Force media / loudspeaker playback (not PlayAndRecord / MODE_IN_COMMUNICATION).
 * Safe to call before any UI sting; does not enable mic recording.
 *
 * @param {{ background?: boolean }} [opts]
 */
export async function ensureMediaPlaybackAudioMode({ background = false } = {}) {
  // Never steal IVS VIDEO_CHAT / call-volume / Stage playback while live is open.
  // playThroughEarpieceAndroid:false → AudioManager.MODE_NORMAL (Fold quiet stage).
  if (isLiveAudioSessionActive() || isLiveStagePublishing()) {
    return;
  }
  const profile = background ? 'ring' : 'media';
  if (appliedAudioProfile === profile) {
    return;
  }
  try {
    await Audio.setAudioModeAsync({
      // iOS: true → AVAudioSession PlayAndRecord → earpiece. Always false for UI sounds.
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      // Only stay active in background for looping call ringtone.
      // Leaving this true after a message sting made feed video keep
      // playing audio after the user left the app.
      staysActiveInBackground: !!background,
      shouldDuckAndroid: true,
      // Android: true → MODE_IN_COMMUNICATION / earpiece.
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    });
    ringModeActive = !!background;
    appliedAudioProfile = profile;
  } catch {
    // Best-effort — still try to play.
  }
}

async function setNotifyAudioMode({ background = false } = {}) {
  await ensureMediaPlaybackAudioMode({ background });
}

/**
 * @param {{ looping?: boolean, volume?: number, gapMs?: number }} [opts]
 * @returns {Promise<import('expo-av').Audio.Sound | null>}
 */
export async function playBlypNotify({ looping = false, volume = 1, gapMs = RING_GAP_MS } = {}) {
  try {
    // Always re-assert media routing — recording / LiveKit / prior sessions can leave
    // the process in voice-call mode which routes expo-av to the earpiece.
    await setNotifyAudioMode({ background: !!looping });
    const { sound } = await Audio.Sound.createAsync(
      BLYP_NOTIFY,
      {
        shouldPlay: true,
        // Never use seamless isLooping for calls — gap pattern below.
        isLooping: false,
        volume: typeof volume === 'number' ? volume : 1,
      },
    );

    if (looping) {
      const gap = Math.max(0, Number(gapMs) || RING_GAP_MS);
      let replayTimer = null;
      let stopped = false;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (stopped || !status?.isLoaded) return;
        if (status.didJustFinish) {
          if (replayTimer) clearTimeout(replayTimer);
          replayTimer = setTimeout(() => {
            if (stopped) return;
            sound.replayAsync().catch(() => {
              sound.setPositionAsync(0).then(() => sound.playAsync()).catch(() => {});
            });
          }, gap);
        }
      });

      // Attach stop hooks so cleanup clears the gap timer.
      sound.__blypRingCleanup = () => {
        stopped = true;
        if (replayTimer) {
          clearTimeout(replayTimer);
          replayTimer = null;
        }
        try {
          sound.setOnPlaybackStatusUpdate(null);
        } catch {
          // ignore
        }
      };
    }

    return sound;
  } catch (e) {
    console.warn('[notifySound] play failed', e?.message || String(e));
    return null;
  }
}

/** Stop and unload a sound instance (safe no-op). */
export async function stopBlypNotify(sound) {
  if (!sound) {
    if (ringModeActive) {
      await setNotifyAudioMode({ background: false });
    }
    return;
  }
  try {
    if (typeof sound.__blypRingCleanup === 'function') {
      sound.__blypRingCleanup();
    }
  } catch {
    // ignore
  }
  try {
    await sound.stopAsync();
  } catch {
    // ignore
  }
  try {
    await sound.unloadAsync();
  } catch {
    // ignore
  }
  // Restore foreground-only media mode so feed video cannot keep playing on Home.
  await setNotifyAudioMode({ background: false });
  await applyMediaSpeaker();
}

export const BLYP_NOTIFY_ASSET = BLYP_NOTIFY;

export default {
  playBlypNotify,
  stopBlypNotify,
  ensureMediaPlaybackAudioMode,
  invalidateMediaPlaybackAudioMode,
  reclaimMediaPlaybackRoute,
  BLYP_NOTIFY_ASSET,
  RING_GAP_MS,
};
