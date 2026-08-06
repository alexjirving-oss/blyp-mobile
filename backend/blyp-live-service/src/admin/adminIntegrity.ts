/**
 * P2 integrity / growth helpers: fraud gift signals, strikes/appeals, promote queue,
 * dating desk (privacy-scoped). Honest empty/degraded when stores missing.
 */
import { randomBytes } from 'crypto';
import { getEconomyInfra } from '../economy/infra';
import { logger } from '../config/logger';
import { writeAdminAudit } from './adminService';
import { getFirestore, listFirestoreReports } from './firestoreAdmin';

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  try {
    return new Date(v as any).toISOString();
  } catch {
    return null;
  }
}

/** Rapid gift / circular gift heuristics from gift_events (no device graph in this service). */
export async function getFraudGiftSignals(input?: {
  hours?: number;
  minGifts?: number;
  limit?: number;
}): Promise<{
  generatedAt: string;
  windowHours: number;
  rapidPairs: Array<{
    senderUserId: string;
    receiverUserId: string;
    giftCount: number;
    coinSpent: number;
  }>;
  circularHints: Array<{
    userA: string;
    userB: string;
    aToB: number;
    bToA: number;
  }>;
  topSenders: Array<{ userId: string; giftCount: number; coinSpent: number }>;
  deviceReuse: { available: false; detail: string };
  degraded?: boolean;
  detail?: string;
  note: string;
}> {
  const hours = Math.max(1, Math.min(168, Number(input?.hours) || 24));
  const minGifts = Math.max(2, Math.min(100, Number(input?.minGifts) || 8));
  const limit = Math.max(1, Math.min(50, Number(input?.limit) || 25));
  const note =
    'Signals from gift_events only. Device/IP multi-account graph is not in live-service — shown as unavailable.';

  try {
    const { db } = getEconomyInfra();
    const rapidRs = await db.raw(
      `
      SELECT sender_user_id, receiver_user_id,
             COUNT(*)::int AS gift_count,
             COALESCE(SUM(coin_cost::numeric), 0)::bigint AS coin_spent
      FROM gift_events
      WHERE created_at >= NOW() - (? || ' hours')::interval
        AND sender_user_id <> receiver_user_id
      GROUP BY sender_user_id, receiver_user_id
      HAVING COUNT(*) >= ?
      ORDER BY gift_count DESC, coin_spent DESC
      LIMIT ?
      `,
      [String(hours), minGifts, limit],
    );
    const rapidPairs = (((rapidRs as any)?.rows || []) as Array<any>).map((r) => ({
      senderUserId: asString(r.sender_user_id),
      receiverUserId: asString(r.receiver_user_id),
      giftCount: Number(r.gift_count || 0),
      coinSpent: Number(r.coin_spent || 0),
    }));

    // Reciprocal gifting within window (A→B and B→A both active).
    const circRs = await db.raw(
      `
      WITH pairs AS (
        SELECT sender_user_id AS a, receiver_user_id AS b, COUNT(*)::int AS n
        FROM gift_events
        WHERE created_at >= NOW() - (? || ' hours')::interval
          AND sender_user_id <> receiver_user_id
        GROUP BY sender_user_id, receiver_user_id
        HAVING COUNT(*) >= 3
      )
      SELECT p1.a AS user_a, p1.b AS user_b, p1.n AS a_to_b, p2.n AS b_to_a
      FROM pairs p1
      JOIN pairs p2 ON p1.a = p2.b AND p1.b = p2.a AND p1.a < p1.b
      ORDER BY (p1.n + p2.n) DESC
      LIMIT ?
      `,
      [String(hours), limit],
    );
    const circularHints = (((circRs as any)?.rows || []) as Array<any>).map((r) => ({
      userA: asString(r.user_a),
      userB: asString(r.user_b),
      aToB: Number(r.a_to_b || 0),
      bToA: Number(r.b_to_a || 0),
    }));

    const topRs = await db.raw(
      `
      SELECT sender_user_id,
             COUNT(*)::int AS gift_count,
             COALESCE(SUM(coin_cost::numeric), 0)::bigint AS coin_spent
      FROM gift_events
      WHERE created_at >= NOW() - (? || ' hours')::interval
      GROUP BY sender_user_id
      ORDER BY gift_count DESC
      LIMIT ?
      `,
      [String(hours), limit],
    );
    const topSenders = (((topRs as any)?.rows || []) as Array<any>).map((r) => ({
      userId: asString(r.sender_user_id),
      giftCount: Number(r.gift_count || 0),
      coinSpent: Number(r.coin_spent || 0),
    }));

    return {
      generatedAt: new Date().toISOString(),
      windowHours: hours,
      rapidPairs,
      circularHints,
      topSenders,
      deviceReuse: {
        available: false,
        detail: 'not_in_live_service',
      },
      note,
    };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[admin] getFraudGiftSignals failed');
    return {
      generatedAt: new Date().toISOString(),
      windowHours: hours,
      rapidPairs: [],
      circularHints: [],
      topSenders: [],
      deviceReuse: { available: false, detail: 'not_in_live_service' },
      degraded: true,
      detail: e?.message || String(e),
      note,
    };
  }
}

export async function listPromotions(input?: {
  status?: string;
  limit?: number;
}): Promise<{
  items: Array<{
    promotionId: string;
    userId: string;
    promotionType: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    coinCost: number;
    createdAt: string | null;
  }>;
  total: number;
  degraded?: boolean;
  detail?: string;
}> {
  const limit = Math.max(1, Math.min(100, Number(input?.limit) || 50));
  const status = asString(input?.status || '').trim().toLowerCase();
  try {
    const { db } = getEconomyInfra();
    const where = status && status !== 'all' ? 'WHERE LOWER(status) = ?' : '';
    const params: unknown[] = status && status !== 'all' ? [status, limit] : [limit];
    const countParams: unknown[] = status && status !== 'all' ? [status] : [];
    const countRs = await db.raw(
      `SELECT COUNT(*)::bigint AS n FROM promotions ${where}`,
      countParams,
    );
    const listRs = await db.raw(
      `
      SELECT promotion_id, user_id, promotion_type, status, starts_at, ends_at, coin_cost, created_at
      FROM promotions
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
      `,
      params,
    );
    const items = (((listRs as any)?.rows || []) as Array<any>).map((r) => ({
      promotionId: asString(r.promotion_id),
      userId: asString(r.user_id),
      promotionType: asString(r.promotion_type),
      status: asString(r.status),
      startsAt: toIso(r.starts_at),
      endsAt: toIso(r.ends_at),
      coinCost: Number(r.coin_cost || 0),
      createdAt: toIso(r.created_at),
    }));
    return { items, total: Number((countRs as any)?.rows?.[0]?.n || 0) };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[admin] listPromotions failed');
    return { items: [], total: 0, degraded: true, detail: e?.message || String(e) };
  }
}

export async function listDatingDesk(input?: { limit?: number }): Promise<{
  available: boolean;
  prefsSample: Array<{
    userId: string;
    enabled: boolean | null;
    lookingFor: string | null;
    updatedAt: string | null;
  }>;
  datingReports: Array<{
    reportId: string;
    targetId: string;
    reporterId: string;
    reasonCode: string;
    status: string;
    surface: string | null;
    createdAt: string | null;
  }>;
  detail?: string;
  note: string;
}> {
  const limit = Math.max(1, Math.min(100, Number(input?.limit) || 40));
  const note =
    'Privacy-scoped: prefs show id/enabled/lookingFor only (no photos/bios). Reports filtered by dating surface/reason.';

  const reportsOut = await listFirestoreReports({ status: 'open', limit: 100 });
  const datingReports = (reportsOut.reports || [])
    .filter((r) => {
      const surface = String(r.surface || '').toLowerCase();
      const reason = String(r.reasonCode || '').toLowerCase();
      return (
        surface.includes('dating') ||
        reason.includes('dating') ||
        reason === 'dating_harassment'
      );
    })
    .slice(0, limit)
    .map((r) => ({
      reportId: r.reportId,
      targetId: r.targetId,
      reporterId: r.reporterId,
      reasonCode: r.reasonCode,
      status: r.status,
      surface: r.surface,
      createdAt: r.createdAt,
    }));

  const fs = getFirestore();
  if (!fs) {
    return {
      available: false,
      prefsSample: [],
      datingReports,
      detail: 'firestore_unavailable',
      note,
    };
  }

  try {
    let snap;
    try {
      snap = await fs.collection('datingPrefs').orderBy('updatedAt', 'desc').limit(limit).get();
    } catch {
      snap = await fs.collection('datingPrefs').limit(limit).get();
    }
    const prefsSample = snap.docs.map((d) => {
      const data = d.data() || {};
      const looking =
        data.lookingFor != null
          ? String(data.lookingFor)
          : data.intent != null
            ? String(data.intent)
            : null;
      let updatedAt: string | null = null;
      const u = data.updatedAt;
      if (u?.toDate) updatedAt = u.toDate().toISOString();
      else if (typeof u === 'number') updatedAt = new Date(u).toISOString();
      else if (typeof u === 'string') updatedAt = u;
      return {
        userId: d.id,
        enabled: typeof data.enabled === 'boolean' ? data.enabled : data.optIn === true ? true : null,
        lookingFor: looking,
        updatedAt,
      };
    });
    return { available: true, prefsSample, datingReports, note };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[admin] listDatingDesk failed');
    return {
      available: false,
      prefsSample: [],
      datingReports,
      detail: e?.message || String(e),
      note,
    };
  }
}

export async function getUserStrikeSummary(userId: string): Promise<{
  userId: string;
  activeCount: number;
  strikes: Array<{
    strikeId: string;
    reason: string;
    surface: string | null;
    relatedReportId: string | null;
    actorUserId: string;
    active: boolean;
    createdAt: string | null;
  }>;
  degraded?: boolean;
  detail?: string;
}> {
  try {
    const { db } = getEconomyInfra();
    const rs = await db.raw(
      `
      SELECT strike_id, reason, surface, related_report_id, actor_user_id, active, created_at
      FROM user_strikes
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [userId],
    );
    const strikes = (((rs as any)?.rows || []) as Array<any>).map((r) => ({
      strikeId: asString(r.strike_id),
      reason: asString(r.reason),
      surface: r.surface != null ? asString(r.surface) : null,
      relatedReportId: r.related_report_id != null ? asString(r.related_report_id) : null,
      actorUserId: asString(r.actor_user_id),
      active: Boolean(r.active),
      createdAt: toIso(r.created_at),
    }));
    return {
      userId,
      activeCount: strikes.filter((s) => s.active).length,
      strikes,
    };
  } catch (e: any) {
    return {
      userId,
      activeCount: 0,
      strikes: [],
      degraded: true,
      detail: e?.message || String(e),
    };
  }
}

export async function addUserStrike(input: {
  actorUserId: string;
  userId: string;
  reason: string;
  surface?: string | null;
  relatedReportId?: string | null;
}): Promise<{ strikeId: string; activeCount: number }> {
  const { db } = getEconomyInfra();
  const strikeId = `stk_${randomBytes(8).toString('hex')}`;
  await db.raw(
    `INSERT INTO user_strikes (strike_id, user_id, reason, surface, related_report_id, actor_user_id, active)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [
      strikeId,
      input.userId,
      input.reason,
      input.surface || null,
      input.relatedReportId || null,
      input.actorUserId,
    ],
  );
  // Mirror count into metadata for User 360 glance.
  await db.raw(
    `
    INSERT INTO user_admin_state (user_id, metadata, updated_at)
    VALUES (?, jsonb_build_object('strikeCount', 1), CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) DO UPDATE SET
      metadata = COALESCE(user_admin_state.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'strikeCount',
          COALESCE((user_admin_state.metadata->>'strikeCount')::int, 0) + 1
        ),
      updated_at = CURRENT_TIMESTAMP
    `,
    [input.userId],
  );
  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'user_strike_add',
    targetType: 'user',
    targetId: input.userId,
    metadata: { strikeId, reason: input.reason, surface: input.surface || null },
  });
  const summary = await getUserStrikeSummary(input.userId);
  return { strikeId, activeCount: summary.activeCount };
}

export async function listAppeals(input?: {
  status?: string;
  limit?: number;
}): Promise<{
  items: Array<{
    appealId: string;
    userId: string;
    strikeId: string | null;
    status: string;
    statement: string;
    resolutionNote: string | null;
    resolvedByUserId: string | null;
    resolvedAt: string | null;
    createdAt: string | null;
  }>;
  total: number;
  degraded?: boolean;
  detail?: string;
}> {
  const limit = Math.max(1, Math.min(100, Number(input?.limit) || 50));
  const status = asString(input?.status || 'open').trim().toLowerCase();
  try {
    const { db } = getEconomyInfra();
    const where = status && status !== 'all' ? 'WHERE LOWER(status) = ?' : '';
    const params: unknown[] = status && status !== 'all' ? [status, limit] : [limit];
    const countParams: unknown[] = status && status !== 'all' ? [status] : [];
    const countRs = await db.raw(
      `SELECT COUNT(*)::bigint AS n FROM user_appeals ${where}`,
      countParams,
    );
    const listRs = await db.raw(
      `
      SELECT appeal_id, user_id, strike_id, status, statement, resolution_note,
             resolved_by_user_id, resolved_at, created_at
      FROM user_appeals
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
      `,
      params,
    );
    const items = (((listRs as any)?.rows || []) as Array<any>).map((r) => ({
      appealId: asString(r.appeal_id),
      userId: asString(r.user_id),
      strikeId: r.strike_id != null ? asString(r.strike_id) : null,
      status: asString(r.status),
      statement: asString(r.statement),
      resolutionNote: r.resolution_note != null ? asString(r.resolution_note) : null,
      resolvedByUserId: r.resolved_by_user_id != null ? asString(r.resolved_by_user_id) : null,
      resolvedAt: toIso(r.resolved_at),
      createdAt: toIso(r.created_at),
    }));
    return { items, total: Number((countRs as any)?.rows?.[0]?.n || 0) };
  } catch (e: any) {
    return { items: [], total: 0, degraded: true, detail: e?.message || String(e) };
  }
}

export async function createAppeal(input: {
  actorUserId: string;
  userId: string;
  statement: string;
  strikeId?: string | null;
}): Promise<{ appealId: string }> {
  const { db } = getEconomyInfra();
  const appealId = `apl_${randomBytes(8).toString('hex')}`;
  await db.raw(
    `INSERT INTO user_appeals (appeal_id, user_id, strike_id, status, statement)
     VALUES (?, ?, ?, 'open', ?)`,
    [appealId, input.userId, input.strikeId || null, input.statement],
  );
  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'user_appeal_create',
    targetType: 'user',
    targetId: input.userId,
    metadata: { appealId, strikeId: input.strikeId || null },
  });
  return { appealId };
}

export async function resolveAppeal(input: {
  actorUserId: string;
  appealId: string;
  status: 'upheld' | 'overturned' | 'dismissed';
  note?: string | null;
}): Promise<{ ok: boolean; detail?: string }> {
  const { db } = getEconomyInfra();
  const rs = await db.raw(`SELECT appeal_id, user_id, strike_id, status FROM user_appeals WHERE appeal_id = ? LIMIT 1`, [
    input.appealId,
  ]);
  const row = (rs as any)?.rows?.[0];
  if (!row) return { ok: false, detail: 'not_found' };

  await db.raw(
    `UPDATE user_appeals
     SET status = ?, resolution_note = ?, resolved_by_user_id = ?, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE appeal_id = ?`,
    [input.status, input.note || null, input.actorUserId, input.appealId],
  );

  if (input.status === 'overturned' && row.strike_id) {
    await db.raw(`UPDATE user_strikes SET active = false WHERE strike_id = ?`, [row.strike_id]);
  }

  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'user_appeal_resolve',
    targetType: 'appeal',
    targetId: input.appealId,
    metadata: {
      status: input.status,
      note: input.note || null,
      userId: row.user_id,
      strikeId: row.strike_id || null,
    },
  });
  return { ok: true };
}
