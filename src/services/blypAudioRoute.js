/**
 * Call-only Android audio mode/route. For You must not import this.
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
};
