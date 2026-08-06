/**
 * Read-only admin economy helpers (wallet, ledger explorer, IAP purchase desk).
 * Never invents balances — returns degraded/empty when Postgres is unavailable.
 */
import { getEconomyInfra } from '../economy/infra';
import { getWallet } from '../economy/economyService';
import { decodeCursor, encodeCursor } from '../economy/cursor';
import { logger } from '../config/logger';

export type AdminLedgerItem = {
  ledgerId: string;
  userId: string;
  entryType: string;
  currency: string;
  amount: number;
  status: string;
  referenceType: string | null;
  referenceId: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

const ENTRY_TYPE_ALIASES: Record<string, string[]> = {
  credit: ['ADMIN_CREDIT', 'SUBSCRIPTION_COINS', 'DAILY_REWARD', 'BONUS_COIN'],
  debit: ['GIFT_SPEND', 'PROMOTE_SPEND', 'LIVE_GAME_ENTRY', 'BATTLE_DEPOSIT', 'WITHDRAWAL_RESERVE'],
  gift: ['GIFT_SPEND', 'GIFT_EARN', 'BATTLE_GIFT_PLEDGE', 'BATTLE_GIFT_PLEDGE_REFUND'],
  purchase: ['COIN_PURCHASE'],
  admin: ['ADMIN_CREDIT'],
  iap: ['COIN_PURCHASE'],
};

function resolveEntryTypes(raw?: string): string[] | null {
  const t = String(raw || '').trim();
  if (!t) return null;
  if (t.includes(',')) {
    return t.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  }
  const alias = ENTRY_TYPE_ALIASES[t.toLowerCase()];
  if (alias) return alias;
  return [t.toUpperCase()];
}

export async function adminGetWallet(userId: string): Promise<{
  available: boolean;
  userId: string;
  coinBalance?: number;
  bonusCoinBalance?: number;
  gemAvailable?: number;
  gemPending?: number;
  detail?: string;
}> {
  try {
    const wallet = await getWallet(userId);
    return { available: true, userId, ...wallet };
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e), userId }, '[admin] adminGetWallet failed');
    return {
      available: false,
      userId,
      detail: e?.message || String(e),
    };
  }
}

export async function adminListLedger(input: {
  userId?: string;
  ledgerId?: string;
  referenceId?: string;
  entryType?: string;
  cursor?: string;
  limit?: number;
}): Promise<{
  items: AdminLedgerItem[];
  nextCursor: string | null;
  degraded?: boolean;
  detail?: string;
}> {
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
  const userId = String(input.userId || '').trim();
  const ledgerId = String(input.ledgerId || '').trim();
  const referenceId = String(input.referenceId || '').trim();
  const entryTypes = resolveEntryTypes(input.entryType);

  // Require at least one selective filter to avoid full-table scans from the console.
  if (!userId && !ledgerId && !referenceId && !entryTypes) {
    return {
      items: [],
      nextCursor: null,
      detail: 'require_filter:userId|ledgerId|referenceId|entryType',
    };
  }

  try {
    const { db } = getEconomyInfra();
    const cursor = decodeCursor(input.cursor);

    const q = db('ledger_entries')
      .select({
        ledgerId: 'ledger_id',
        userId: 'user_id',
        entryType: 'entry_type',
        currency: 'currency',
        amount: 'amount',
        status: 'status',
        referenceType: 'reference_type',
        referenceId: 'reference_id',
        idempotencyKey: 'idempotency_key',
        createdAt: 'created_at',
        metadata: 'metadata',
      })
      .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'ledger_id', order: 'desc' }])
      .limit(limit);

    if (ledgerId) q.where({ ledger_id: ledgerId });
    if (userId) q.andWhere({ user_id: userId });
    if (referenceId) q.andWhere({ reference_id: referenceId });
    if (entryTypes && entryTypes.length === 1) q.andWhere({ entry_type: entryTypes[0] });
    if (entryTypes && entryTypes.length > 1) q.whereIn('entry_type', entryTypes);
    if (cursor) {
      q.andWhereRaw('(created_at, ledger_id) < (?, ?)', [cursor.createdAt, cursor.ledgerId]);
    }

    const rows = await q;
    const items: AdminLedgerItem[] = rows.map((r: any) => ({
      ledgerId: String(r.ledgerId),
      userId: String(r.userId),
      entryType: String(r.entryType),
      currency: String(r.currency),
      amount: Number(r.amount),
      status: String(r.status || 'POSTED'),
      referenceType: r.referenceType != null ? String(r.referenceType) : null,
      referenceId: r.referenceId != null ? String(r.referenceId) : null,
      idempotencyKey: r.idempotencyKey != null ? String(r.idempotencyKey) : null,
      createdAt: new Date(r.createdAt).toISOString(),
      metadata: (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, unknown>,
    }));

    const nextCursor =
      rows.length === limit
        ? encodeCursor({
            createdAt: new Date(rows[rows.length - 1].createdAt).toISOString(),
            ledgerId: String(rows[rows.length - 1].ledgerId),
          })
        : null;

    return { items, nextCursor };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[admin] adminListLedger failed');
    return {
      items: [],
      nextCursor: null,
      degraded: true,
      detail: e?.message || String(e),
    };
  }
}

export async function adminListIapPurchases(input: {
  userId?: string;
  platform?: string;
  sku?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}): Promise<{
  items: Array<AdminLedgerItem & { platform?: string; sku?: string; storeTransactionId?: string; anomalyHints: string[] }>;
  nextCursor: string | null;
  source: string;
  note: string;
  degraded?: boolean;
  detail?: string;
}> {
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
  const userId = String(input.userId || '').trim();
  const platform = String(input.platform || '').trim().toUpperCase();
  const sku = String(input.sku || '').trim();
  const q = String(input.q || '').trim();

  try {
    const { db } = getEconomyInfra();
    const cursor = decodeCursor(input.cursor);

    let query = db('ledger_entries')
      .select({
        ledgerId: 'ledger_id',
        userId: 'user_id',
        entryType: 'entry_type',
        currency: 'currency',
        amount: 'amount',
        status: 'status',
        referenceType: 'reference_type',
        referenceId: 'reference_id',
        idempotencyKey: 'idempotency_key',
        createdAt: 'created_at',
        metadata: 'metadata',
      })
      .where({ entry_type: 'COIN_PURCHASE' })
      .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'ledger_id', order: 'desc' }])
      .limit(limit);

    if (userId) query = query.andWhere({ user_id: userId });
    if (platform) query = query.andWhereRaw("UPPER(COALESCE(metadata->>'platform', '')) = ?", [platform]);
    if (sku) query = query.andWhereRaw("COALESCE(metadata->>'sku', '') = ?", [sku]);
    if (q) {
      const like = `%${q}%`;
      query = query.andWhereRaw(
        `(ledger_id ILIKE ? OR user_id ILIKE ? OR COALESCE(metadata->>'storeTransactionId','') ILIKE ? OR COALESCE(metadata->>'purchaseToken','') ILIKE ? OR COALESCE(metadata->>'sku','') ILIKE ?)`,
        [like, like, like, like, like],
      );
    }
    if (cursor) {
      query = query.andWhereRaw('(created_at, ledger_id) < (?, ?)', [cursor.createdAt, cursor.ledgerId]);
    }

    const rows = await query;
    const items = rows.map((r: any) => {
      const metadata = (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, unknown>;
      const anomalyHints: string[] = [];
      // Receipt anomalies are not stored as separate rows; surface soft hints only.
      if (!metadata.storeTransactionId && !metadata.purchaseToken) {
        anomalyHints.push('missing_store_ids');
      }
      if (Number(r.amount) <= 0) {
        anomalyHints.push('non_positive_grant');
      }
      return {
        ledgerId: String(r.ledgerId),
        userId: String(r.userId),
        entryType: String(r.entryType),
        currency: String(r.currency),
        amount: Number(r.amount),
        status: String(r.status || 'POSTED'),
        referenceType: r.referenceType != null ? String(r.referenceType) : null,
        referenceId: r.referenceId != null ? String(r.referenceId) : null,
        idempotencyKey: r.idempotencyKey != null ? String(r.idempotencyKey) : null,
        createdAt: new Date(r.createdAt).toISOString(),
        metadata,
        platform: metadata.platform != null ? String(metadata.platform) : undefined,
        sku: metadata.sku != null ? String(metadata.sku) : undefined,
        storeTransactionId:
          metadata.storeTransactionId != null ? String(metadata.storeTransactionId) : undefined,
        anomalyHints,
      };
    });

    const nextCursor =
      rows.length === limit
        ? encodeCursor({
            createdAt: new Date(rows[rows.length - 1].createdAt).toISOString(),
            ledgerId: String(rows[rows.length - 1].ledgerId),
          })
        : null;

    return {
      items,
      nextCursor,
      source: 'ledger_entries.COIN_PURCHASE',
      note: 'IAP grants are ledger rows (no separate receipts table). Token-reuse rejects are not persisted as purchase rows.',
    };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[admin] adminListIapPurchases failed');
    return {
      items: [],
      nextCursor: null,
      source: 'ledger_entries.COIN_PURCHASE',
      note: 'IAP grants are ledger rows (no separate receipts table).',
      degraded: true,
      detail: e?.message || String(e),
    };
  }
}

/** Dual-control thresholds — UI warning / design only until maker-checker ships. */
export const DUAL_CONTROL_UI = {
  creditCoinsWarnAt: 10_000,
  withdrawalApproveWarnAtGems: 50_000,
  note: 'Maker-checker is not enforced server-side yet. Large actions show a UI warning only.',
} as const;
