/**
 * Shared outgoing-call entry for Home phone strip + Messenger recents.
 * Uses the existing Firestore + LiveKit + CallScreen pipeline — no second stack.
 */

import { Alert } from 'react-native';
import { startCall } from './callService';

export function peerFromCallDoc(call, uid) {
  const participants = Array.isArray(call?.participants)
    ? call.participants
    : Array.isArray(call?.participantIds)
      ? call.participantIds
      : [];
  const isOutgoing = call?.callerId === uid;
  const otherId =
    participants.find((id) => id && id !== uid) ||
    (isOutgoing ? call?.calleeId : call?.callerId) ||
    null;
  const status = String(call?.status || '').toLowerCase();
  const createdAtMs =
    call?.createdAtMs ||
    (typeof call?.createdAt?.toMillis === 'function' ? call.createdAt.toMillis() : 0);
  return {
    id: otherId ? String(otherId) : null,
    displayName: isOutgoing
      ? String(call?.calleeName || 'Blyp user')
      : String(call?.callerName || 'Blyp user'),
    conversationId: call?.conversationId || null,
    status,
    isOutgoing,
    isMissed: status === 'missed',
    isDeclined: status === 'declined',
    createdAtMs: Number(createdAtMs) || 0,
  };
}

export function recentCallPeers(calls, uid, limit = 8) {
  const seen = new Set();
  const out = [];
  for (const call of Array.isArray(calls) ? calls : []) {
    const peer = peerFromCallDoc(call, uid);
    if (!peer.id || seen.has(peer.id)) continue;
    seen.add(peer.id);
    out.push({ ...peer, callId: call?.id || null });
    if (out.length >= limit) break;
  }
  return out;
}

export async function placeOutgoingCall({
  navigation,
  uid,
  myName,
  peerId,
  peerName,
  peerAvatar,
  conversationId,
}) {
  const calleeId = String(peerId || '').trim();
  const callerId = String(uid || '').trim();
  if (!callerId || !calleeId || callerId === calleeId) {
    return { ok: false, reason: 'invalid-peer' };
  }
  try {
    const res = await startCall({
      callerId,
      calleeId,
      conversationId: conversationId || null,
      callerName: myName || 'Someone',
      calleeName: peerName || 'Blyp user',
    });
    if (!res.ok) {
      Alert.alert(
        'Call',
        res.reason === 'mic-denied'
          ? 'Microphone permission is required for calls.'
          : 'Could not start call.',
      );
      return res;
    }
    navigation?.navigate?.('Call', {
      callId: res.callId,
      role: 'caller',
      peerName: peerName || 'Blyp user',
      peerAvatar: peerAvatar || null,
    });
    return res;
  } catch (e) {
    Alert.alert('Call', e?.message || 'Could not start call.');
    return { ok: false, reason: String(e?.message || 'start-failed') };
  }
}

export function openMessengerCalls(navigation) {
  navigation?.navigate?.('Messenger', { tab: 'calls' });
}
