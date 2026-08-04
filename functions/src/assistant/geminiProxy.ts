/**
 * geminiProxy — authenticated AI relay for the mobile client (P7.4).
 *
 * Keeps provider API keys server-side. Client still posts Gemini-shaped
 * generateContent bodies; responses stay Gemini-shaped so parsers are unchanged.
 *
 * Primary: OpenAI (OPENAI_API_KEY / BLYP_OPENAI_API_KEY)
 * Backup:  Gemini when OpenAI is missing or fails
 *
 * POST (Bearer Firebase ID token)
 *   ?model=<allowlisted gemini model>  (used only for Gemini backup path)
 *   body: { contents, generationConfig, ... }
 */

import * as functions from 'firebase-functions';
import fetch from 'node-fetch';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { applyCors } from '../http/cors';
import {
  callOpenAiAsGemini,
  hasOpenAiFallback,
} from './openaiFallback';
import { getSubscriptionState, ensureTrialIfMissing } from './entitlement';

initFirebaseAdmin();

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const ALLOWED_MODELS = new Set([
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro-latest',
]);
const DEFAULT_MODEL = 'gemini-flash-latest';

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 120;

function resolveModel(raw: unknown): string {
  const m = String(raw || '').replace(/^models\//, '').trim();
  return ALLOWED_MODELS.has(m) ? m : DEFAULT_MODEL;
}

async function checkRateLimit(uid: string): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection('geminiProxyUsage').doc(uid);
  const now = Date.now();
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = (snap.data() as any) || {};
      const windowStart = Number(d.windowStart || 0);
      const count = Number(d.count || 0);
      if (now - windowStart > RATE_WINDOW_MS) {
        tx.set(ref, { windowStart: now, count: 1 }, { merge: true });
        return true;
      }
      if (count >= RATE_MAX) return false;
      tx.set(ref, { count: count + 1 }, { merge: true });
      return true;
    });
  } catch {
    return true;
  }
}

async function callGemini(
  body: object,
  model: string,
  geminiKey: string,
): Promise<{ status: number; body: string }> {
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${geminiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal as any,
      body: JSON.stringify(body),
    }).finally(() => clearTimeout(timer));
    const text = await upstream.text();
    return { status: upstream.status, body: text };
  } catch (e: any) {
    console.warn('[geminiProxy] Gemini request error', e?.message || String(e));
    return {
      status: 502,
      body: JSON.stringify({ error: { message: 'gemini_upstream_error' } }),
    };
  }
}

export const geminiProxy = functions
  .runWith({
    memory: '512MB',
    timeoutSeconds: 60,
    // Injected from Secret Manager when set via `firebase functions:secrets:set`.
    secrets: ['OPENAI_API_KEY'],
  })
  .https.onRequest(async (req, res) => {
    applyCors(req, res, { methods: 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: { message: 'method_not_allowed' } });
      return;
    }

    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    let uid = '';
    try {
      if (!idToken) throw new Error('missing-token');
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      res.status(401).json({ error: { message: 'unauthenticated' } });
      return;
    }

    // Premium / active-trial gate (server-authoritative). Missing docs get the
    // same 30-day trial bootstrap the mobile client expects so AI doesn't look
    // "disappeared" for brand-new accounts.
    let sub = await getSubscriptionState(uid);
    if (!sub.active) {
      sub = await ensureTrialIfMissing(uid);
    }
    if (!sub.active) {
      res.status(402).json({ error: { message: 'subscription_required' } });
      return;
    }

    const allowed = await checkRateLimit(uid);
    if (!allowed) {
      res.status(429).json({ error: { message: 'rate_limited' } });
      return;
    }

    const geminiKey = process.env.GEMINI_API_KEY || process.env.BLYP_GEMINI_API_KEY || '';
    const body = (req.body && typeof req.body === 'object') ? { ...req.body } : {};
    const model = resolveModel(req.query.model ?? (body as any).model);
    delete (body as any).model;
    if (!Array.isArray((body as any).contents) || (body as any).contents.length === 0) {
      res.status(400).json({ error: { message: 'missing_contents' } });
      return;
    }

    const send = (status: number, payload: string, provider: string) => {
      res.status(status);
      res.set('Content-Type', 'application/json');
      res.set('X-Blyp-AI-Provider', provider);
      res.send(payload);
    };

    // --- Primary: OpenAI ---
    if (hasOpenAiFallback()) {
      const primary = await callOpenAiAsGemini(body as any);
      if (primary.status >= 200 && primary.status < 300) {
        send(200, primary.body, 'openai');
        return;
      }
      console.warn('[geminiProxy] OpenAI primary failed; trying Gemini backup', {
        uid,
        status: primary.status,
        snippet: String(primary.body || '').slice(0, 160),
      });

      if (geminiKey) {
        const backup = await callGemini(body, model, geminiKey);
        if (backup.status >= 200 && backup.status < 300) {
          send(backup.status, backup.body, 'gemini');
          return;
        }
        // Prefer returning OpenAI's error (billing/quota) when both fail.
        send(primary.status || backup.status, primary.body || backup.body, 'openai');
        return;
      }

      send(primary.status, primary.body, 'openai');
      return;
    }

    // --- No OpenAI key: Gemini only ---
    if (!geminiKey) {
      res.status(503).json({ error: { message: 'ai_unavailable' } });
      return;
    }

    const gemini = await callGemini(body, model, geminiKey);
    send(gemini.status, gemini.body, 'gemini');
  });
