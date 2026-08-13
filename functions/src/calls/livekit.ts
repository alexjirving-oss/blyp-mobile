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
import { sendToUser } from '../notifications/sender';
import { getPushNotificationDecision } from '../notifications/userNotificationPreferences';

initFirebaseAdmin();

function livekitConfig() {
  const url = String(process.env.LIVEKIT_URL || functions.config()?.livekit?.url || '').trim();
  const apiKey = String(process.env.LIVEKIT_API_KEY || functions.config()?.livekit?.api_key || '').trim();
  const apiSecret = String(
    process.env.LIVEKIT_API_SECRET || functions.config()?.livekit?.api_secret || '',
  ).trim();
  return { url, apiKey, apiSecret };
}

async function mintForIdentity(identity: string, roomName: string) {
  const { url, apiKey, apiSecret } = livekitConfig();
  if (!url || !apiKey || !apiSecret) return null;
  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: '2h',
    name: identity,
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return { token: await at.toJwt(), url, room: roomName };
}

async function pushIncomingCall(opts: {
  calleeId: string;
  callId: string;
  callerId: string;
  callerName: string;
  conversationId?: string;
  livekitUrl?: string;
  livekitToken?: string;
}) {
  const payload = {
    title: 'Incoming call',
    body: `${opts.callerName} is calling…`,
    collapseKey: `call:${opts.callId}`,
    data: {
      type: 'incoming_call',
      callId: opts.callId,
      callerId: opts.callerId,
      callerName: opts.callerName,
      conversationId: String(opts.conversationId || ''),
      ...(opts.livekitUrl ? { livekitUrl: opts.livekitUrl } : {}),
      ...(opts.livekitToken ? { livekitToken: opts.livekitToken } : {}),
    },
  };

  // Direct FCM must honor the same prefs as the outbox dispatcher (master /
  // category / per-person). Do not enqueue when prefs deny — retries must not
  // resurrect a muted call alert.
  try {
    const db = admin.firestore();
    const decision = await getPushNotificationDecision(db, {
      userId: opts.calleeId,
      type: 'call',
      data: payload.data,
    });
    if (!decision.allowed) {
      console.info(
        '[calls] incoming call suppressed',
        decision.reason,
        opts.calleeId.slice(0, 8),
      );
      return;
    }
  } catch (prefErr: any) {
    console.warn(
      '[calls] preference check failed; refusing call push',
      prefErr?.message || String(prefErr),
    );
    return;
  }

  try {
    const sent = await sendToUser(opts.calleeId, payload);
    if (sent.deviceCount === 0 || sent.successCount === 0) {
      await enqueueNotification({
        userId: opts.calleeId,
        type: 'call',
        title: payload.title,
        body: payload.body,
        dedupeKey: `call:${opts.callId}:${opts.calleeId}`,
        collapseKey: payload.collapseKey,
        data: payload.data,
      });
    }
  } catch (e: any) {
    console.warn('[calls] FCM failed; enqueue fallback', e?.message || String(e));
    try {
      await enqueueNotification({
        userId: opts.calleeId,
        type: 'call',
        title: payload.title,
        body: payload.body,
        dedupeKey: `call:${opts.callId}:${opts.calleeId}`,
        collapseKey: payload.collapseKey,
        data: payload.data,
      });
    } catch (e2: any) {
      console.warn('[calls] enqueue failed', e2?.message || String(e2));
    }
  }
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
    console.error('[mintLiveKitToken] LIVEKIT_* missing', {
      hasUrl: Boolean(url),
      hasKey: Boolean(apiKey),
      hasSecret: Boolean(apiSecret),
    });
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
    const minted = await mintForIdentity(uid, roomName);
    if (!minted) {
      res.status(503).json({ ok: false, reason: 'livekit-not-configured' });
      return;
    }

    const notifyCallee = req.body?.notifyCallee === true;
    if (notifyCallee) {
      const calleeId = String(call.calleeId || '').trim();
      if (calleeId && calleeId !== uid) {
        const calleeMint = await mintForIdentity(calleeId, roomName);
        void pushIncomingCall({
          calleeId,
          callId,
          callerId: String(call.callerId || uid),
          callerName: String(call.callerName || '').trim() || 'Someone',
          conversationId: String(call.conversationId || ''),
          livekitUrl: calleeMint?.url,
          livekitToken: calleeMint?.token,
        });
      }
    }

    res.status(200).json({
      ok: true,
      token: minted.token,
      url: minted.url,
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
    const roomName = String(call.livekitRoom || callId);
    const calleeMint = await mintForIdentity(calleeId, roomName);
    await pushIncomingCall({
      calleeId,
      callId,
      callerId,
      callerName,
      conversationId: String(call.conversationId || ''),
      livekitUrl: calleeMint?.url,
      livekitToken: calleeMint?.token,
    });
    return null;
  });
