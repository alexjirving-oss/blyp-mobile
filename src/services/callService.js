/**
 * Audio call orchestration — Firestore signaling + LiveKit token mint.
 */

import { Audio } from 'expo-av';
import { firestore as db } from '../config/firebase';
import { messengerExtrasService } from './messaging/messengerExtrasService';

const FUNCTIONS_BASE = (
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ||
  'https://us-central1-blyp-master.cloudfunctions.net'
).replace(/\/+$/, '');

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
    const current = await Audio.getPermissionsAsync();
    if (current?.granted) return true;
    const next = await Audio.requestPermissionsAsync();
    return !!next?.granted;
  } catch {
    return false;
  }
}

export async function mintLiveKitToken(callId) {
  const token = await firebaseIdToken();
  if (!token) return { ok: false, reason: 'unauthenticated' };
  try {
    const resp = await fetch(`${FUNCTIONS_BASE}/mintLiveKitToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ callId }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data?.ok && data?.token && data?.url) {
      return {
        ok: true,
        token: String(data.token),
        url: String(data.url),
        room: String(data.room || callId),
        identity: String(data.identity || ''),
      };
    }
    return { ok: false, reason: data?.reason || `http-${resp.status}` };
  } catch (e) {
    return { ok: false, reason: String(e?.message || 'mint-failed') };
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

  const created = await messengerExtrasService.createCall(db, {
    callerId,
    calleeId,
    conversationId,
    callerName,
    calleeName,
  });
  return { ok: true, callId: created.id, livekitRoom: created.livekitRoom };
}

export async function answerCall(callId, uid) {
  const micPromise = ensureMicPermission();
  // Mint in parallel with mic + status write so Answer→audio is ~1s, not serial.
  const mintPromise = mintLiveKitToken(callId);
  const micOk = await micPromise;
  if (!micOk) {
    return { ok: false, reason: 'mic-denied' };
  }
  await messengerExtrasService.updateCallStatus(db, callId, 'active', {
    answeredBy: uid,
  });
  const minted = await mintPromise;
  if (!minted.ok) {
    return { ok: true, mint: minted };
  }
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
  startCall,
  answerCall,
  declineCall,
  endCall,
  subscribeToCall,
  subscribeToIncomingCalls,
};
