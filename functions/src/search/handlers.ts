/**
 * HTTPS entry points for Blyp search.
 *
 *  - blypSearch      : run a blended, cached search (anonymous allowed; the Charter
 *                      says anyone can search). Hides all supplier keys server-side.
 *  - blypSearchEvent : the app reports clicks + in-app page snapshots, which feed
 *                      the corpus that becomes Blyp's own index.
 */

import * as functions from 'firebase-functions';
import { applyCors } from '../http/cors';
import { runBlypSearch } from './orchestrator';
import { logSearchEvent } from '../platform/substrate';
import { hashSession, queryHash, canonicalUrl, fingerprint, sha256 } from '../platform/util';
import { checkRateLimit, callerKey, SEARCH_RATE_LIMIT } from '../platform/rateLimit';

/** Best-effort client IP behind the Cloud Functions proxy. */
function clientIp(req: functions.https.Request): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length) return String(fwd[0]).trim();
  return req.ip || undefined;
}

export const blypSearch = functions
  .runWith({
    memory: '512MB',
    timeoutSeconds: 30,
    // Same OpenAI secret as geminiProxy — search answers use gpt-4o.
    secrets: ['OPENAI_API_KEY'],
  })
  .https.onRequest(async (req, res) => {
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
      const query = String(body.query || '').trim();
      if (!query) {
        res.status(400).json({ error: 'query is required' });
        return;
      }

      // Abuse guard (not a product cap): generous burst limit per caller.
      const rl = await checkRateLimit(callerKey(clientIp(req), body.session), SEARCH_RATE_LIMIT);
      if (!rl.allowed) {
        res.set('Retry-After', String(rl.retryAfterSec));
        res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfterSec });
        return;
      }

      const geo = body.geo && typeof body.geo === 'object' ? body.geo : undefined;
      const response = await runBlypSearch({ query, session: body.session, geo });
      res.status(200).json(response);
    } catch (e) {
      console.error('[blypSearch] error', (e as Error)?.message);
      res.status(500).json({ error: 'search_failed' });
    }
  });

export const blypSearchEvent = functions.https.onRequest(async (req, res) => {
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

    // Abuse guard: events are even more bursty than searches, so allow a wider window.
    const rl = await checkRateLimit(callerKey(clientIp(req), body.session), { windowMs: 10_000, max: 120 });
    if (!rl.allowed) {
      res.set('Retry-After', String(rl.retryAfterSec));
      res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfterSec });
      return;
    }

    const type = body.type === 'snapshot' ? 'snapshot' : 'click';
    const sessionHash = hashSession(body.session || 'anon');
    const country = body.country ? String(body.country) : undefined;
    const qh = body.query ? queryHash(String(body.query), country) : undefined;

    if (type === 'click') {
      await logSearchEvent({
        type: 'click',
        queryHash: qh,
        sessionHash,
        url: body.url ? canonicalUrl(String(body.url)) : undefined,
        position: typeof body.position === 'number' ? body.position : undefined,
        provider: body.provider ? String(body.provider) : undefined,
      });
    } else {
      const url = canonicalUrl(String(body.url || ''));
      const excerpt = String(body.excerpt || '').slice(0, 1200); // visible-text excerpt only
      await logSearchEvent({
        type: 'snapshot',
        queryHash: qh,
        sessionHash,
        url,
        snapshot: {
          url,
          canonicalUrl: url,
          title: body.title ? String(body.title).slice(0, 300) : undefined,
          description: body.description ? String(body.description).slice(0, 600) : undefined,
          excerpt,
          contentHash: sha256(`${body.title || ''}\n${excerpt}`),
          fingerprint: fingerprint(`${body.title || ''} ${excerpt}`),
        },
      });
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[blypSearchEvent] error', (e as Error)?.message);
    res.status(500).json({ error: 'event_failed' });
  }
});
