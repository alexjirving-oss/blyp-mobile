/**
 * Shared Blyp notify sting — same asset for push, in-app messages, and call ringtone.
 * Call ringing uses play → 2s silence → play (never seamless isLooping).
 */

import { Audio } from 'expo-av';

const BLYP_NOTIFY = require('../../assets/sounds/blyp_notify.wav');

/** Silence between ringtone plays while a call is ringing. */
export const RING_GAP_MS = 2000;

let sharedModeReady = false;

async function ensureAudioMode() {
  if (sharedModeReady) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    sharedModeReady = true;
  } catch {
    // Best-effort — still try to play.
  }
}

/**
 * @param {{ looping?: boolean, volume?: number, gapMs?: number }} [opts]
 * @returns {Promise<import('expo-av').Audio.Sound | null>}
 */
export async function playBlypNotify({ looping = false, volume = 1, gapMs = RING_GAP_MS } = {}) {
  try {
    await ensureAudioMode();
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
  if (!sound) return;
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
}

export const BLYP_NOTIFY_ASSET = BLYP_NOTIFY;

export default { playBlypNotify, stopBlypNotify, BLYP_NOTIFY_ASSET, RING_GAP_MS };
