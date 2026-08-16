/**
 * Daily treasure chest — verified accounts only.
 *
 * Credits the live-service wallet via ledger_entries (same path as daily streak).
 * Idempotent: one base + one bonus claim per UTC day (unique idempotency keys).
 *
 * Does NOT touch IAP catalog / Play Billing.
 */

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from './infra';
import { EconomyError } from './economyErrors';
import { getTreasureChestAmounts } from './treasureChestConfig';
import {
  baseIdempotencyKey,
  bonusIdempotencyKey,
  buildTreasurePeek,
  findQualifyingVideoPost,
  isUserVerified,
  utcDay,
  type TreasurePeekShape,
  type TreasurePostLike,
} from './treasureChestLogic';
import { getFirestore, listFirestoreUserPosts } from '../admin/firestoreAdmin';
import { logger } from '../config/logger';

const ENTRY_BASE = 'TREASURE_CHEST';
const ENTRY_BONUS = 'TREASURE_CHEST_BONUS';

async function loadAdminMetadata(userId: string): Promise<Record<string, unknown> | null> {
  const { db } = getEconomyInfra();
  const rs = await db.raw(
    `
    SELECT metadata
    FROM user_admin_state
    WHERE user_id = ?
    LIMIT 1
    `,
    [userId]
  );
  const row = (rs as any)?.rows?.[0];
  if (!row?.metadata) return null;
  if (typeof row.metadata === 'object') return row.metadata as Record<string, unknown>;
  if (typeof row.metadata === 'string') {
    try {
      return JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

async function loadFirestoreUser(userId: string): Promise<Record<string, unknown> | null> {
  const fs = getFirestore();
  if (!fs) return null;
  try {
    const snap = await fs.collection('users').doc(userId).get();
    if (!snap.exists) return null;
    return (snap.data() || {}) as Record<string, unknown>;
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e), userId }, '[treasure] firestore user read failed');
    return null;
  }
}

async function assertVerified(userId: string): Promise<void> {
  const [adminMetadata, firestoreUser] = await Promise.all([
    loadAdminMetadata(userId),
    loadFirestoreUser(userId),
  ]);
  if (!isUserVerified({ adminMetadata, firestoreUser })) {
    throw new EconomyError('RESTRICTED', 403, 'Verified accounts only', {
      reason: 'not_verified',
    });
  }
}

async function loadRecentPosts(userId: string): Promise<TreasurePostLike[]> {
  const posts = await listFirestoreUserPosts(userId);
  if (!posts) return [];
  return posts.map((p) => ({
    postId: p.postId,
    videoUrl: p.videoUrl,
    mediaUrl: p.mediaUrl,
    postType: p.postType,
    createdAt: p.createdAt,
    isHidden: p.isHidden === true,
  }));
}

async function enqueueGrantNotification(opts: {
  userId: string;
  kind: 'base' | 'bonus';
  coins: number;
  day: string;
}): Promise<void> {
  try {
    const { enqueueTreasureChestGrantNotification } = await import('../admin/firestoreAdmin');
    await enqueueTreasureChestGrantNotification({
      userId: opts.userId,
      coins: opts.coins,
      kind: opts.kind,
      day: opts.day,
    });
  } catch (e: any) {
    logger.warn(
      { err: e?.message || String(e), userId: opts.userId },
      '[treasure] grant notification enqueue failed'
    );
  }
}

async function mirrorClaimDay(userId: string, day: string, field: 'lastBaseClaimDay' | 'lastBonusClaimDay'): Promise<void> {
  const fs = getFirestore();
  if (!fs) return;
  try {
    await fs.collection('treasureChest').doc(userId).set(
      {
        [field]: day,
        updatedAt: Date.now(),
        verifiedEligible: true,
      },
      { merge: true }
    );
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e), userId }, '[treasure] mirror claim day failed');
  }
}

export type TreasureChestPeek = TreasurePeekShape & { ok: true };

export type TreasureChestClaim = {
  ok: true;
  alreadyClaimed: boolean;
  reward: number;
  kind: 'base' | 'bonus';
  day: string;
  balanceCoins: number;
  bonusEligible?: boolean;
  bonusCoins?: number;
};

export async function peekTreasureChest(userId: string): Promise<TreasureChestPeek> {
  const amounts = getTreasureChestAmounts();
  const today = utcDay(Date.now());
  const { db } = getEconomyInfra();

  const [adminMetadata, firestoreUser, baseRow, bonusRow, posts] = await Promise.all([
    loadAdminMetadata(userId),
    loadFirestoreUser(userId),
    db('ledger_entries').where({ idempotency_key: baseIdempotencyKey(userId, today) }).first(),
    db('ledger_entries').where({ idempotency_key: bonusIdempotencyKey(userId, today) }).first(),
    amounts.enabled ? loadRecentPosts(userId) : Promise.resolve([] as TreasurePostLike[]),
  ]);

  const verified = isUserVerified({ adminMetadata, firestoreUser });
  const baseClaimedToday = !!baseRow;
  const bonusClaimedToday = !!bonusRow;
  const hasVideoPostToday = !!findQualifyingVideoPost(posts, today, null);

  return {
    ok: true,
    ...buildTreasurePeek({
      enabled: amounts.enabled,
      verified,
      day: today,
      baseCoins: amounts.baseCoins,
      bonusCoins: amounts.bonusCoins,
      baseClaimedToday,
      bonusClaimedToday,
      hasVideoPostToday,
    }),
  };
}

async function creditTreasure(
  trx: Knex.Transaction,
  opts: {
    userId: string;
    amount: number;
    entryType: typeof ENTRY_BASE | typeof ENTRY_BONUS;
    idempotencyKey: string;
    day: string;
    metadata: Record<string, unknown>;
  }
): Promise<{ alreadyClaimed: boolean; reward: number; balanceCoins: number }> {
  await trx('wallets').insert({ user_id: opts.userId }).onConflict('user_id').ignore();
  const wallet = await trx('wallets').where({ user_id: opts.userId }).forUpdate().first();
  if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

  const existing = await trx('ledger_entries').where({ idempotency_key: opts.idempotencyKey }).first();
  if (existing) {
    return {
      alreadyClaimed: true,
      reward: 0,
      balanceCoins: Number(wallet.coin_balance),
    };
  }

  const before = BigInt(wallet.coin_balance);
  const after = before + BigInt(opts.amount);
  await trx('ledger_entries').insert({
    ledger_id: randomUUID(),
    user_id: opts.userId,
    entry_type: opts.entryType,
    currency: 'COIN',
    amount: opts.amount.toString(),
    status: 'POSTED',
    reference_type: opts.entryType,
    reference_id: opts.day,
    idempotency_key: opts.idempotencyKey,
    metadata: opts.metadata,
  });
  await trx('wallets').where({ user_id: opts.userId }).update({
    coin_balance: after.toString(),
    updated_at: trx.fn.now(),
  });

  return {
    alreadyClaimed: false,
    reward: opts.amount,
    balanceCoins: Number(after),
  };
}

/** Claim today's base chest. Idempotent; verified-only. */
export async function claimTreasureChestBase(userId: string): Promise<TreasureChestClaim> {
  const amounts = getTreasureChestAmounts();
  if (!amounts.enabled) {
    throw new EconomyError('RESTRICTED', 403, 'Treasure chest disabled', { reason: 'disabled' });
  }
  await assertVerified(userId);

  const today = utcDay(Date.now());
  const idempotencyKey = baseIdempotencyKey(userId, today);
  const { db } = getEconomyInfra();

  const result = await db.transaction(async (trx) =>
    creditTreasure(trx, {
      userId,
      amount: amounts.baseCoins,
      entryType: ENTRY_BASE,
      idempotencyKey,
      day: today,
      metadata: {
        source: 'treasure_chest',
        kind: 'base',
        day: today,
        coins: amounts.baseCoins,
      },
    })
  );

  if (!result.alreadyClaimed) {
    await Promise.all([
      enqueueGrantNotification({
        userId,
        kind: 'base',
        coins: result.reward,
        day: today,
      }),
      mirrorClaimDay(userId, today, 'lastBaseClaimDay'),
    ]);
  }

  return {
    ok: true,
    alreadyClaimed: result.alreadyClaimed,
    reward: result.reward,
    kind: 'base',
    day: today,
    balanceCoins: result.balanceCoins,
    bonusEligible: false,
    bonusCoins: amounts.bonusCoins,
  };
}

/**
 * Claim same-day video-post bonus. Requires base claim first + a video post
 * created on this UTC day (optionally identified by postId).
 */
export async function claimTreasureChestBonus(
  userId: string,
  input?: { postId?: string }
): Promise<TreasureChestClaim> {
  const amounts = getTreasureChestAmounts();
  if (!amounts.enabled) {
    throw new EconomyError('RESTRICTED', 403, 'Treasure chest disabled', { reason: 'disabled' });
  }
  await assertVerified(userId);

  const today = utcDay(Date.now());
  const { db } = getEconomyInfra();

  const baseExisting = await db('ledger_entries')
    .where({ idempotency_key: baseIdempotencyKey(userId, today) })
    .first();
  if (!baseExisting) {
    throw new EconomyError('INVALID_STATE', 409, 'Claim the daily chest before the bonus', {
      reason: 'base_required',
    });
  }

  const posts = await loadRecentPosts(userId);
  const match = findQualifyingVideoPost(posts, today, input?.postId || null);
  if (!match) {
    throw new EconomyError('INVALID_STATE', 409, 'Post a new video today to unlock the bonus', {
      reason: 'video_post_required',
      day: today,
    });
  }

  const idempotencyKey = bonusIdempotencyKey(userId, today);
  const result = await db.transaction(async (trx) =>
    creditTreasure(trx, {
      userId,
      amount: amounts.bonusCoins,
      entryType: ENTRY_BONUS,
      idempotencyKey,
      day: today,
      metadata: {
        source: 'treasure_chest',
        kind: 'bonus',
        day: today,
        coins: amounts.bonusCoins,
        postId: match.postId || null,
      },
    })
  );

  if (!result.alreadyClaimed) {
    await Promise.all([
      enqueueGrantNotification({
        userId,
        kind: 'bonus',
        coins: result.reward,
        day: today,
      }),
      mirrorClaimDay(userId, today, 'lastBonusClaimDay'),
    ]);
  }

  return {
    ok: true,
    alreadyClaimed: result.alreadyClaimed,
    reward: result.reward,
    kind: 'bonus',
    day: today,
    balanceCoins: result.balanceCoins,
  };
}
