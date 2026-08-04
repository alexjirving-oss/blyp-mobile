/**
 * blypAssistantCompose — the "Blyp it" endpoint.
 *
 * POST { command? , recipient?, gist?, tone? }  (Bearer Firebase ID token)
 *   -> 200 { ok, draftId, recipientName, messages[], imageUrl, channels[], tone }
 *
 * Order of operations is deliberate (cheapest gate first, never auto-send):
 *   1. authenticate (Firebase ID token; uid == Cognito sub)
 *   2. premium gate (server-side entitlements/{uid}; fails CLOSED)
 *   3. rate limit (cost control)
 *   4. draft text + moderate (refuse unsafe)
 *   5. generate image (best-effort; text-only fallback)
 *   6. persist a durable DRAFT and return it for in-app preview/confirm
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { applyCors } from '../http/cors';
import { getSubscriptionState } from './entitlement';
import { draftMessage } from './gemini';
import { generateAndStoreImage } from './imageGen';
import {
  ASSISTANT_COLLECTIONS,
  AssistantDraftDoc,
  DRAFT_TTL_MS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
} from './types';

initFirebaseAdmin();

async function checkRateLimit(uid: string): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection(ASSISTANT_COLLECTIONS.usage).doc(uid);
  const now = Date.now();
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = (snap.data() as any) || {};
      const windowStart = Number(d.windowStart || 0);
      const count = Number(d.count || 0);
      if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
        tx.set(ref, { windowStart: now, count: 1 }, { merge: true });
        return true;
      }
      if (count >= RATE_LIMIT_MAX) return false;
      tx.set(ref, { count: count + 1 }, { merge: true });
      return true;
    });
  } catch {
    return true; // never block a paying user on a counter hiccup
  }
}

export const blypAssistantCompose = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    applyCors(req, res, { methods: 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, reason: 'method' });
      return;
    }

    // 1) Auth
    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    let uid = '';
    try {
      if (!idToken) throw new Error('missing-token');
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      res.status(401).json({ ok: false, reason: 'unauthenticated' });
      return;
    }

    // 2) Premium gate (server-authoritative, fails closed)
    const sub = await getSubscriptionState(uid);
    if (!sub.active) {
      res.status(402).json({ ok: false, reason: 'subscription_required' });
      return;
    }

    // 3) Rate limit
    const allowed = await checkRateLimit(uid);
    if (!allowed) {
      res.status(429).json({ ok: false, reason: 'rate_limited' });
      return;
    }

    // 4) Draft + moderate
    const body = req.body || {};
    const input = {
      command: typeof body.command === 'string' ? body.command : undefined,
      recipient: typeof body.recipient === 'string' ? body.recipient : undefined,
      gist: typeof body.gist === 'string' ? body.gist : undefined,
      tone: typeof body.tone === 'string' ? body.tone : undefined,
    };
    if (!input.command && !input.gist) {
      res.status(400).json({ ok: false, reason: 'empty_request' });
      return;
    }

    const draft = await draftMessage(input);
    if (!draft) {
      res.status(503).json({ ok: false, reason: 'ai_unavailable' });
      return;
    }
    if (!draft.safe) {
      res.status(422).json({ ok: false, reason: 'unsafe', detail: draft.refusalReason || 'Request declined.' });
      return;
    }
    if (draft.messages.length === 0) {
      res.status(503).json({ ok: false, reason: 'no_draft' });
      return;
    }

    // 5+6) Persist draft, then attach best-effort image.
    const db = admin.firestore();
    const now = Date.now();
    const ref = db.collection(ASSISTANT_COLLECTIONS.drafts).doc();
    const docData: AssistantDraftDoc = {
      uid,
      recipientHint: draft.recipientName || input.recipient || '',
      messages: draft.messages,
      imagePrompt: draft.imagePrompt,
      imageUrl: null,
      channels: ['dm', 'share'],
      tone: input.tone || 'friendly',
      status: 'draft',
      createdAt: now,
      expiresAt: now + DRAFT_TTL_MS,
    };
    await ref.set(docData as any);

    let imageUrl: string | null = null;
    if (draft.imagePrompt) {
      imageUrl = await generateAndStoreImage(uid, ref.id, draft.imagePrompt);
      if (imageUrl) await ref.update({ imageUrl });
    }

    res.status(200).json({
      ok: true,
      draftId: ref.id,
      recipientName: docData.recipientHint,
      messages: docData.messages,
      imageUrl,
      channels: docData.channels,
      tone: docData.tone,
    });
  });
