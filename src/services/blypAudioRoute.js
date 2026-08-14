/**
 * Call / live audio route helpers. For You must not import this for playback.
 */

import { NativeModules, Platform } from 'react-native';

const Native = NativeModules?.BlypAudioRoute;

export async function applyMediaSpeaker() {
  if (Platform.OS !== 'android' || !Native?.applyMediaSpeaker) return null;
  try {
    return await Native.applyMediaSpeaker();
  } catch (e) {
    console.warn('[BlypAudio] idle route failed', e?.message || String(e));
    return null;
  }
}

/**
 * Play cinema gift MP4 soundtrack under live with voice-comm attrs
 * (no MODE_NORMAL yank, never blyp_notify).
 */
export async function playGiftCinemaUri(uri, volume = 1) {
  if (Platform.OS !== 'android' || !Native?.playGiftCinemaUri) return false;
  const u = typeof uri === 'string' ? uri.trim() : '';
  if (!u) return false;
  try {
    return !!(await Native.playGiftCinemaUri(u, volume));
  } catch (e) {
    console.warn('[BlypAudio] gift cinema uri failed', e?.message || String(e));
    return false;
  }
}

export async function stopGiftCinema() {
  if (Platform.OS !== 'android' || !Native?.stopGiftCinema) return false;
  try {
    return !!(await Native.stopGiftCinema());
  } catch (e) {
    console.warn('[BlypAudio] stop gift cinema failed', e?.message || String(e));
    return false;
  }
}

export async function applyCallSpeaker() {
  if (Platform.OS !== 'android' || !Native?.applyCallSpeaker) return null;
  try {
    return await Native.applyCallSpeaker();
  } catch (e) {
    console.warn('[BlypAudio] call speaker failed', e?.message || String(e));
    return null;
  }
}

export async function applyCallEarpiece() {
  if (Platform.OS !== 'android' || !Native?.applyCallEarpiece) return null;
  try {
    return await Native.applyCallEarpiece();
  } catch (e) {
    console.warn('[BlypAudio] call earpiece failed', e?.message || String(e));
    return null;
  }
}

export async function snapshotAudioRoute() {
  if (Platform.OS !== 'android' || !Native?.snapshot) return null;
  try {
    return await Native.snapshot();
  } catch {
    return null;
  }
}

export default {
  applyMediaSpeaker,
  applyCallSpeaker,
  applyCallEarpiece,
  snapshotAudioRoute,
  playGiftCinemaUri,
  stopGiftCinema,
};
