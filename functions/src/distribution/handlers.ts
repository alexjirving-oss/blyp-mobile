/**
 * HTTPS entry point for post interaction signals (the fuel for earn-your-reach).
 *
 *  - blypPostEvent : the app reports batched impressions/likes/shares/saves/watch
 *                    events. These are aggregated by the scheduled blypReachSweep
 *                    into each post's transparent Blyp Score and wave. PII firewall:
 *                    we store a hashed session, never the raw user id.
 */

import * as functions from 'firebase-functions';
import { applyCors } from '../http/cors';
import { logPostEvents } from '../platform/substrate';
import { hashSession } from '../platform/util';
import { ImpressionEventDoc } from '../platform/types';

const VALID_TYPES = new Set<ImpressionEventDoc['type']>([
  'impression',
  'like',
  'comment',
  'share',
  'save',
  'watch',
]);

const MAX_EVENTS = 100;

export const blypPostEvent = functions.https.onRequest(async (req, res) => {
  applyCors(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = req.body || {};
    const sessionHash = hashSession(body.session || 'anon');
    const raw = Array.isArray(body.events) ? body.events : [];
    const events = raw
      .slice(0, MAX_EVENTS)
      .map((e: any) => {
        const type = VALID_TYPES.has(e?.type) ? (e.type as ImpressionEventDoc['type']) : null;
        const postId = e?.postId ? String(e.postId) : '';
        if (!type || !postId) return null;
        const out: Omit<ImpressionEventDoc, 'schemaVersion' | 'ts' | 'retentionExpiresAt'> & { ts?: number } = {
          type,
          postId,
          sessionHash,
          ownerId: e?.ownerId ? String(e.ownerId) : undefined,
          dwellMs: typeof e?.dwellMs === 'number' && e.dwellMs > 0 ? Math.min(e.dwellMs, 3_600_000) : undefined,
          completion:
            typeof e?.completion === 'number' ? Math.max(0, Math.min(1, e.completion)) : undefined,
        };
        return out;
      })
      .filter(Boolean) as Array<
      Omit<ImpressionEventDoc, 'schemaVersion' | 'ts' | 'retentionExpiresAt'> & { ts?: number }
    >;

    await logPostEvents(events);
    res.status(200).json({ ok: true, accepted: events.length });
  } catch (e) {
    console.error('[blypPostEvent] error', (e as Error)?.message);
    res.status(500).json({ error: 'event_failed' });
  }
});
