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

/** Same post-join burst calls/Grid 9 use after WebRTC snaps Fold to the earpiece. */
const GUEST_SPEAKER_BURST_MS = [400, 1200, 2800, 5000];
let guestSpeakerBurstToken = 0;
const guestSpeakerTimers = [];

function clearGuestSpeakerBurst() {
  guestSpeakerBurstToken += 1;
  while (guestSpeakerTimers.length) {
    clearTimeout(guestSpeakerTimers.pop());
  }
}

async function applyIosGuestSpeaker(speakerOn) {
  if (Platform.OS !== 'ios') return;
  try {
    const { Audio, InterruptionModeAndroid, InterruptionModeIOS } = require('expo-av');
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: !speakerOn,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });
  } catch (e) {
    console.warn('[BlypAudio] iOS guest speaker failed', e?.message || String(e));
  }
}

async function pinGuestSpeakerOnce(token) {
  await applyCallSpeaker();
  if (token !== guestSpeakerBurstToken) return;
  await applyIosGuestSpeaker(true);
}

/**
 * Guest-live Speaker button — same outputs as CallScreen.
 * Does not run on join; caller toggles it. Burst keeps Fold on loudspeaker
 * after IVS publish snaps the receiver.
 */
export async function applyGuestLiveSpeaker(speakerOn) {
  clearGuestSpeakerBurst();
  const token = guestSpeakerBurstToken;
  if (!speakerOn) {
    await applyCallEarpiece();
    if (token !== guestSpeakerBurstToken) return;
    await applyIosGuestSpeaker(false);
    return;
  }
  await pinGuestSpeakerOnce(token);
  if (token !== guestSpeakerBurstToken) return;
  GUEST_SPEAKER_BURST_MS.forEach((ms) => {
    guestSpeakerTimers.push(
      setTimeout(() => {
        if (token !== guestSpeakerBurstToken) return;
        void pinGuestSpeakerOnce(token);
      }, ms),
    );
  });
}

/** Leave guest: drop call routing so watch uses media loudspeaker again. */
export async function releaseGuestLiveSpeaker() {
  clearGuestSpeakerBurst();
  await applyMediaSpeaker();
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
  applyGuestLiveSpeaker,
  releaseGuestLiveSpeaker,
  snapshotAudioRoute,
  playGiftCinemaUri,
  stopGiftCinema,
};

