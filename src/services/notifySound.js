/**
 * Shared Blyp notify sting — same asset for push, in-app messages, and call ringtone.
 * Incoming calls pass { looping: true } so it repeats until answered/declined.
 */

import { Audio } from 'expo-av';

const BLYP_NOTIFY = require('../../assets/sounds/blyp_notify.wav');

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
 * @param {{ looping?: boolean, volume?: number }} [opts]
 * @returns {Promise<import('expo-av').Audio.Sound | null>}
 */
export async function playBlypNotify({ looping = false, volume = 1 } = {}) {
  try {
    await ensureAudioMode();
    const { sound } = await Audio.Sound.createAsync(
      BLYP_NOTIFY,
      {
        shouldPlay: true,
        isLooping: !!looping,
        volume: typeof volume === 'number' ? volume : 1,
      },
    );
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

export default { playBlypNotify, stopBlypNotify, BLYP_NOTIFY_ASSET };
