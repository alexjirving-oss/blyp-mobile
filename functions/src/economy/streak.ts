/**
 * Server-authoritative daily streak engine.
 *
 * The orphaned client `BlypCoinService.claimDailyReward` is prod-gated off because
 * a client must never mint its own coins. This moves the authority to the server:
 *
 *  - "Already claimed today" is enforced by the REAL ledger idempotency key
 *    `daily:<uid>:<UTC-day>`, so a replayed/concurrent claim can NEVER double-pay.
 *  - Coins are credited via processLedgerTransaction (the same audited path as
 *    purchases/subscriptions), THEN the streak cache is updated — so we can never
 *    advance a streak without having actually paid for it.
 *  - A daily sweep enqueues a "keep your N-day streak alive" reminder through the
 *    notification spine (delivers once the app registers a push token).
 *
 * Reward matches the established model: base 10 + min(streak*2, 50).
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { applyCors } from '../http/cors';
import { processLedgerTransaction } from './ledger';
import { enqueueNotification } from '../notifications/outbox';

initFirebaseAdmin();

const STREAKS_COL = 'streaks';
const BASE_REWARD = 10;
const MAX_BONUS = 50;

function utcDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map((n) => parseInt(n, 10));
  const ms = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  return utcDay(ms);
}

function rewardFor(streak: number): number {
  return BASE_REWARD + Math.min(streak * 2, MAX_BONUS);
}

interface StreakState {
  lastClaimDate: string | null;
  streak: number;
}

async function readStreak(uid: string): Promise<StreakState> {
  const db = admin.firestore();
  const snap = await db.collection(STREAKS_COL).doc(uid).get();
  if (!snap.exists) return { lastClaimDate: null, streak: 0 };
  const d = snap.data() as any;
  return { lastClaimDate: d?.lastClaimDate || null, streak: Number(d?.streak || 0) };
}

export const blypClaimDailyReward = functions
  .runWith({ memory: '256MB', timeoutSeconds: 30 })
  .https.onRequest(async (req, res) => {
    applyCors(req, res, { methods: 'GET, POST, OPTIONS' });
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    // Auth
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

    const now = Date.now();
    const today = utcDay(now);
    const prior = await readStreak(uid);
    const claimedToday = prior.lastClaimDate === today;

    // GET = peek (no mutation): tell the app the current streak + whether claimable.
    if (req.method === 'GET') {
      res.status(200).json({
        ok: true,
        streak: prior.streak,
        claimedToday,
        claimableReward: claimedToday ? 0 : rewardFor(prior.lastClaimDate === addDays(today, -1) ? prior.streak + 1 : 1),
      });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, reason: 'method' });
      return;
    }

    // Compute the streak this claim would yield.
    let newStreak: number;
    if (prior.lastClaimDate === addDays(today, -1)) newStreak = prior.streak + 1; // consecutive day
    else if (prior.lastClaimDate === today) newStreak = prior.streak; // cache says claimed; ledger decides
    else newStreak = 1; // reset
    const reward = rewardFor(newStreak);

    try {
      // The ledger key is the authority for "one claim per UTC day".
      const credit = await processLedgerTransaction({
        userId: uid,
        kind: 'earning',
        asset: 'coin',
        amount: reward,
        direction: 'credit',
        idempotencyKey: `daily:${uid}:${today}`,
        metadata: { source: 'daily_streak', streak: newStreak, day: today },
        createdBy: 'system',
      });

      if (credit.existing) {
        // Already claimed today — no double-pay.
        res.status(200).json({
          ok: true,
          alreadyClaimed: true,
          streak: prior.streak,
          reward: 0,
          balanceCoins: credit.newBalanceCoins,
        });
        return;
      }

      // First claim today: persist the streak cache (derived; ledger remains truth).
      await admin
        .firestore()
        .collection(STREAKS_COL)
        .doc(uid)
        .set({ lastClaimDate: today, streak: newStreak, updatedAt: now }, { merge: true });

      res.status(200).json({
        ok: true,
        alreadyClaimed: false,
        streak: newStreak,
        reward,
        balanceCoins: credit.newBalanceCoins,
      });
    } catch (e: any) {
      console.error('[blypClaimDailyReward] error', e?.message || String(e));
      res.status(500).json({ ok: false, reason: 'error' });
    }
  });

/**
 * Daily reminder sweep — nudges users with a live streak who haven't claimed today.
 * Enqueues through the notification spine (delivers when a device token exists).
 */
export const streakReminderSweep = functions
  .runWith({ memory: '256MB', timeoutSeconds: 120 })
  .pubsub.schedule('every day 18:00')
  .onRun(async () => {
    initFirebaseAdmin();
    const db = admin.firestore();
    const today = utcDay(Date.now());

    const snap = await db.collection(STREAKS_COL).where('streak', '>=', 1).limit(2000).get();
    let enqueued = 0;
    for (const d of snap.docs) {
      const data = d.data() as any;
      if (data?.lastClaimDate === today) continue; // already claimed today
      const streak = Number(data?.streak || 0);
      if (streak < 1) continue;
      // eslint-disable-next-line no-await-in-loop
      const created = await enqueueNotification({
        userId: d.id,
        type: 'streak',
        title: `Keep your ${streak}-day streak alive`,
        body: "Claim today's reward before midnight",
        dedupeKey: `streak:${d.id}:${today}`,
        collapseKey: 'streak',
        data: { type: 'streak' },
      }).catch(() => false);
      if (created) enqueued += 1;
    }
    console.log(`[streakReminderSweep] enqueued ${enqueued} streak reminders`);
    return null;
  });
