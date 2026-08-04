/**
 * LiveKit audio-call token mint + incoming-call push.
 *
 * Env (Functions):
 *   LIVEKIT_URL          e.g. wss://xxx.livekit.cloud
 *   LIVEKIT_API_KEY
 *   LIVEKIT_API_SECRET
 */

import * as functions from 'firebase-functions';
import { AccessToken } from 'livekit-server-sdk';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { applyCors } from '../http/cors';
import { enqueueNotification } from '../notifications/outbox';

initFirebaseAdmin();

function livekitConfig() {
  const url = String(process.env.LIVEKIT_URL || functions.config()?.livekit?.url || '').trim();
  const apiKey = String(process.env.LIVEKIT_API_KEY || functions.config()?.livekit?.api_key || '').trim();
  const apiSecret = String(
    process.env.LIVEKIT_API_SECRET || functions.config()?.livekit?.api_secret || '',
  ).trim();
  return { url, apiKey, apiSecret };
}

async function verifyBearerUid(req: functions.https.Request): Promise<string | null> {
  const authHeader = String(req.get('Authorization') || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!idToken) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return String(decoded?.uid || '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * POST /mintLiveKitToken
 * body: { callId }
 * auth: Bearer Firebase ID token
 */
export const mintLiveKitToken = functions.https.onRequest(async (req, res) => {
  applyCors(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method-not-allowed' });
    return;
  }

  const uid = await verifyBearerUid(req);
  if (!uid) {
    res.status(401).json({ ok: false, reason: 'unauthenticated' });
    return;
  }

  const { url, apiKey, apiSecret } = livekitConfig();
  if (!url || !apiKey || !apiSecret) {
    res.status(503).json({ ok: false, reason: 'livekit-not-configured' });
    return;
  }

  const callId = String(req.body?.callId || '').trim();
  if (!callId) {
    res.status(400).json({ ok: false, reason: 'missing-callId' });
    return;
  }

  try {
    const snap = await admin.firestore().collection('calls').doc(callId).get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, reason: 'call-not-found' });
      return;
    }
    const call = snap.data() || {};
    const participants: string[] = Array.isArray(call.participants)
      ? call.participants.map((p: any) => String(p))
      : [];
    if (!participants.includes(uid)) {
      res.status(403).json({ ok: false, reason: 'not-participant' });
      return;
    }
    const status = String(call.status || '');
    if (status === 'ended' || status === 'declined' || status === 'missed') {
      res.status(409).json({ ok: false, reason: 'call-closed' });
      return;
    }

    const roomName = String(call.livekitRoom || callId);
    const at = new AccessToken(apiKey, apiSecret, {
      identity: uid,
      ttl: '2h',
      name: uid,
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();

    res.status(200).json({
      ok: true,
      token,
      url,
      room: roomName,
      identity: uid,
    });
  } catch (e: any) {
    console.error('[mintLiveKitToken]', e?.message || String(e));
    res.status(500).json({ ok: false, reason: 'mint-failed' });
  }
});

/**
 * When a call doc is created with status=ringing, push the callee.
 */
export const onCallCreate = functions.firestore
  .document('calls/{callId}')
  .onCreate(async (snap, context) => {
    initFirebaseAdmin();
    const call = (snap.data() as any) || {};
    const callId = String(context.params.callId || snap.id || '');
    const status = String(call.status || '');
    if (status !== 'ringing') return null;

    const callerId = String(call.callerId || '').trim();
    const calleeId = String(call.calleeId || '').trim();
    if (!callId || !callerId || !calleeId || callerId === calleeId) return null;

    const callerName = String(call.callerName || '').trim() || 'Someone';

    try {
      await enqueueNotification({
        userId: calleeId,
        type: 'call',
        title: 'Incoming call',
        body: `${callerName} is calling…`,
        dedupeKey: `call:${callId}:${calleeId}`,
        collapseKey: `call:${callId}`,
        data: {
          type: 'incoming_call',
          callId,
          callerId,
          callerName,
          conversationId: String(call.conversationId || ''),
        },
      });
    } catch (e: any) {
      console.warn('[onCallCreate] enqueue failed', e?.message || String(e));
    }
    return null;
  });
