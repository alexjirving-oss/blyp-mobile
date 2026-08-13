/**
 * Audio call orchestration — Firestore signaling + LiveKit token mint.
 */

import { Audio } from 'expo-av';
import { PermissionsAndroid, Platform } from 'react-native';
import { firestore as db } from '../config/firebase';
import { messengerExtrasService } from './messaging/messengerExtrasService';

const FUNCTIONS_BASE = (
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ||
  'https://us-central1-blyp-master.cloudfunctions.net'
).replace(/\/+$/, '');

const MINT_TIMEOUT_MS = 8_000;

const mintInflight = new Map();
const mintResults = new Map();

/** Resolved mint for this call, if the HTTP already finished. Survives React effect cleanup. */
export function peekMintResult(callId) {
  const id = String(callId || '').trim();
  return id ? mintResults.get(id) || null : null;
}

export function clearMintCache(callId) {
  const id = String(callId || '').trim();
  if (!id) {
    mintInflight.clear();
    mintResults.clear();
    return;
  }
  mintInflight.delete(id);
  mintResults.delete(id);
}

async function firebaseIdToken() {
  try {
    // eslint-disable-next-line global-require
    const cfg = require('../config/firebase');
    const user = cfg?.auth?.currentUser;
    if (user && typeof user.getIdToken === 'function') return await user.getIdToken();
  } catch (e) {
    console.warn('[call] could not get Firebase ID token', e?.message || String(e));
  }
  return null;
}

export async function ensureMicPermission() {
  try {
    if (Platform.OS === 'android') {
      const already = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (already) return true;
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (granted === PermissionsAndroid.RESULTS.GRANTED) return true;
    }
    const current = await Audio.getPermissionsAsync();
    if (current?.granted) return true;
    const next = await Audio.requestPermissionsAsync();
    return !!next?.granted;
  } catch {
    return false;
  }
}

function withTimeout(promise, ms, reason) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason }), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function mintLiveKitToken(callId, { notifyCallee = false } = {}) {
  const id = String(callId || '').trim();
  if (!id) return { ok: false, reason: 'missing-callId' };
  const cached = mintResults.get(id);
  if (cached?.ok && cached.token && cached.url) return cached;
  const existing = mintInflight.get(id);
  if (existing) return existing;

  const work = (async () => {
    const token = await firebaseIdToken();
    if (!token) return { ok: false, reason: 'unauthenticated' };
    const request = (async () => {
      try {
        const resp = await fetch(`${FUNCTIONS_BASE}/mintLiveKitToken`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ callId: id, notifyCallee: !!notifyCallee }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data?.ok && data?.token && data?.url) {
          return {
            ok: true,
            token: String(data.token),
            url: String(data.url),
            room: String(data.room || id),
            identity: String(data.identity || ''),
          };
        }
        return { ok: false, reason: data?.reason || `http-${resp.status}` };
      } catch (e) {
        return { ok: false, reason: String(e?.message || 'mint-failed') };
      }
    })();
    return withTimeout(request, MINT_TIMEOUT_MS, 'mint-timeout');
  })();

  mintInflight.set(id, work);
  try {
    const result = await work;
    if (result?.ok) mintResults.set(id, result);
    return result;
  } finally {
    mintInflight.delete(id);
  }
}

function pauseSpotifyForCall(reason) {
  try {
    // Soft-fail: never block call setup if Spotify is unreachable / unlinked.
    // eslint-disable-next-line global-require
    const { pauseSpotifyForBlypAudio } = require('./spotifyAudioCoordinator');
    pauseSpotifyForBlypAudio(reason).catch(() => {});
  } catch {
    /* ignore */
  }
}

export async function startCall({
  callerId,
  calleeId,
  conversationId,
  callerName,
  calleeName,
}) {
  const micOk = await ensureMicPermission();
  if (!micOk) return { ok: false, reason: 'mic-denied' };

  pauseSpotifyForCall('call_start');

  const created = await messengerExtrasService.createCall(db, {
    callerId,
    calleeId,
    conversationId,
    callerName,
    calleeName,
  });
  // Wake callee from this already-open HTTP (when functions are deployed) and
  // join LiveKit while ringing so Accept is publish-only.
  const mintPromise = mintLiveKitToken(created.id, { notifyCallee: true });
  try {
    // eslint-disable-next-line global-require
    const { prepareCallMedia } = require('./callMediaSession');
    prepareCallMedia(created.id, { role: 'caller', mintPromise }).catch(() => {});
  } catch {
    // ignore
  }
  return { ok: true, callId: created.id, livekitRoom: created.livekitRoom };
}

export async function answerCall(callId, uid, { skipMint = false } = {}) {
  const micOk = await ensureMicPermission();
  if (!micOk) {
    return { ok: false, reason: 'mic-denied' };
  }
  pauseSpotifyForCall('call_answer');
  await messengerExtrasService.updateCallStatus(db, callId, 'active', {
    answeredBy: uid,
  });
  if (skipMint) {
    return { ok: true, mint: peekMintResult(callId) || { ok: true, skipped: true } };
  }
  const minted = await mintLiveKitToken(callId);
  return { ok: true, mint: minted };
}

export async function declineCall(callId, uid) {
  await messengerExtrasService.updateCallStatus(db, callId, 'declined', {
    endedBy: uid,
  });
  return { ok: true };
}

export async function endCall(callId, uid, { asMissed = false } = {}) {
  await messengerExtrasService.updateCallStatus(
    db,
    callId,
    asMissed ? 'missed' : 'ended',
    { endedBy: uid },
  );
  return { ok: true };
}

export function subscribeToCall(callId, onCall, onError) {
  return messengerExtrasService.subscribeToCall(db, callId, onCall, onError);
}

export function subscribeToIncomingCalls(uid, onIncoming, onError) {
  return messengerExtrasService.subscribeToIncomingCalls(db, uid, onIncoming, onError);
}

export default {
  ensureMicPermission,
  mintLiveKitToken,
  peekMintResult,
  clearMintCache,
  startCall,
  answerCall,
  declineCall,
  endCall,
  subscribeToCall,
  subscribeToIncomingCalls,
};
