/**
 * Deferred admin polish helpers (auto-mod, mass-ban, DSAR package, chargeback flags, game disputes).
 * Keep irreversible paths Owner-gated + audited. Prefer export-first for DSAR.
 */

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { FieldValue } from 'firebase-admin/firestore';
import { isCanonicalCognitoSub as isCanonicalSub } from '../auth/cognitoSub';
import { getEconomyInfra } from '../economy/infra';
import { purgeUserData } from '../economy/economyService';
import { logger } from '../config/logger';
import { ensureAdminSchema } from './adminSchema';
import { banUserByAdmin, writeAdminAudit } from './adminService';
import { getFirestore } from './firestoreAdmin';

export const MASS_BAN_MAX = 25;
export const MASS_BAN_CONFIRM = 'MASS BAN';
export const DSAR_PURGE_CONFIRM = 'PURGE';

export type AutoModPolicy = {
  autoHideThreshold: number;
  criticalHideReporters: number;
  seriousHideReports: number;
  visionFailClosed: boolean;
  notes: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  liveEffect: {
    postgres: boolean;
    firestoreMirror: boolean;
    cloudFunctions: string;
  };
};

export const DEFAULT_AUTO_MOD_POLICY: Omit<AutoModPolicy, 'updatedAt' | 'updatedBy' | 'liveEffect'> = {
  autoHideThreshold: 3,
  criticalHideReporters: 2,
  seriousHideReports: 2,
  visionFailClosed: true,
  notes: null,
};

const AUTO_MOD_KEY = 'auto_mod_policy';

async function db(): Promise<Knex> {
  const { db: knex } = getEconomyInfra();
  await ensureAdminSchema(knex);
  return knex;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function normalizeAutoMod(raw: any, meta?: { updatedAt?: string | null; updatedBy?: string | null }): AutoModPolicy {
  return {
    autoHideThreshold: clampInt(raw?.autoHideThreshold, 1, 50, DEFAULT_AUTO_MOD_POLICY.autoHideThreshold),
    criticalHideReporters: clampInt(raw?.criticalHideReporters, 1, 20, DEFAULT_AUTO_MOD_POLICY.criticalHideReporters),
    seriousHideReports: clampInt(raw?.seriousHideReports, 1, 20, DEFAULT_AUTO_MOD_POLICY.seriousHideReports),
    visionFailClosed: raw?.visionFailClosed !== false,
    notes: raw?.notes != null ? String(raw.notes).slice(0, 500) : null,
    updatedAt: meta?.updatedAt ?? (raw?.updatedAt != null ? String(raw.updatedAt) : null),
    updatedBy: meta?.updatedBy ?? (raw?.updatedBy != null ? String(raw.updatedBy) : null),
    liveEffect: {
      postgres: true,
      firestoreMirror: true,
      cloudFunctions:
        'reportAutoAction reads appConfig/autoModPolicy when present; redeploy Cloud Functions to pick up CF source changes. Until then, compile-time defaults may still apply on older function revisions.',
    },
  };
}

export async function getAutoModPolicy(): Promise<AutoModPolicy> {
  const knex = await db();
  try {
    const row = await knex('admin_config').where({ config_key: AUTO_MOD_KEY }).first();
    if (!row) {
      return normalizeAutoMod(DEFAULT_AUTO_MOD_POLICY, { updatedAt: null, updatedBy: null });
    }
    const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value || {};
    return normalizeAutoMod(value, {
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      updatedBy: row.updated_by_user_id != null ? String(row.updated_by_user_id) : null,
    });
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e) }, '[admin] getAutoModPolicy failed');
    return normalizeAutoMod(DEFAULT_AUTO_MOD_POLICY, { updatedAt: null, updatedBy: null });
  }
}

export async function setAutoModPolicy(input: {
  actorUserId: string;
  autoHideThreshold?: number;
  criticalHideReporters?: number;
  seriousHideReports?: number;
  visionFailClosed?: boolean;
  notes?: string | null;
}): Promise<AutoModPolicy> {
  const knex = await db();
  const current = await getAutoModPolicy();
  const next = normalizeAutoMod(
    {
      autoHideThreshold: input.autoHideThreshold ?? current.autoHideThreshold,
      criticalHideReporters: input.criticalHideReporters ?? current.criticalHideReporters,
      seriousHideReports: input.seriousHideReports ?? current.seriousHideReports,
      visionFailClosed: input.visionFailClosed ?? current.visionFailClosed,
      notes: input.notes !== undefined ? input.notes : current.notes,
    },
    { updatedAt: new Date().toISOString(), updatedBy: input.actorUserId },
  );

  const payload = {
    autoHideThreshold: next.autoHideThreshold,
    criticalHideReporters: next.criticalHideReporters,
    seriousHideReports: next.seriousHideReports,
    visionFailClosed: next.visionFailClosed,
    notes: next.notes,
  };

  await knex.raw(
    `INSERT INTO admin_config (config_key, value, updated_by_user_id, updated_at)
     VALUES (?, ?::jsonb, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (config_key)
     DO UPDATE SET value = EXCLUDED.value, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = CURRENT_TIMESTAMP`,
    [AUTO_MOD_KEY, JSON.stringify(payload), input.actorUserId],
  );

  const fs = getFirestore();
  let firestoreOk = false;
  if (fs) {
    try {
      await fs.collection('appConfig').doc('autoModPolicy').set(
        {
          ...payload,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: input.actorUserId,
        },
        { merge: true },
      );
      firestoreOk = true;
    } catch (e: any) {
      logger.warn({ err: e?.message || String(e) }, '[admin] autoModPolicy Firestore mirror failed');
    }
  }

  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'auto_mod_policy_set',
    targetType: 'config',
    targetId: AUTO_MOD_KEY,
    metadata: { ...payload, firestoreOk },
  });

  next.liveEffect.firestoreMirror = firestoreOk;
  return next;
}

export type MassBanPreviewItem = {
  userId: string;
  valid: boolean;
  alreadyBanned: boolean;
  detail?: string;
};

export async function previewMassBan(userIds: string[]): Promise<{
  items: MassBanPreviewItem[];
  wouldBan: number;
  skipped: number;
  capped: boolean;
}> {
  const knex = await db();
  const unique = Array.from(new Set(userIds.map((x) => String(x || '').trim()).filter(Boolean)));
  const capped = unique.length > MASS_BAN_MAX;
  const slice = unique.slice(0, MASS_BAN_MAX);
  const items: MassBanPreviewItem[] = [];

  for (const userId of slice) {
    if (!isCanonicalSub(userId)) {
      items.push({ userId, valid: false, alreadyBanned: false, detail: 'invalid_cognito_sub' });
      continue;
    }
    const row = await knex('user_admin_state').where({ user_id: userId }).first();
    const alreadyBanned = row?.is_banned === true;
    items.push({ userId, valid: true, alreadyBanned, detail: alreadyBanned ? 'already_banned' : undefined });
  }

  const wouldBan = items.filter((i) => i.valid && !i.alreadyBanned).length;
  const skipped = items.length - wouldBan;
  return { items, wouldBan, skipped, capped };
}

export async function executeMassBan(input: {
  actorUserId: string;
  userIds: string[];
  reason: string;
  dryRun: boolean;
  confirmPhrase?: string;
}): Promise<{
  dryRun: boolean;
  preview: Awaited<ReturnType<typeof previewMassBan>>;
  results?: Array<{ userId: string; ok: boolean; detail?: string }>;
}> {
  const ids = Array.from(new Set(input.userIds.map((x) => String(x || '').trim()).filter(Boolean)));
  if (ids.length === 0) throw Object.assign(new Error('EMPTY_BATCH'), { code: 'EMPTY_BATCH' });
  if (ids.length > MASS_BAN_MAX) throw Object.assign(new Error('BATCH_TOO_LARGE'), { code: 'BATCH_TOO_LARGE', max: MASS_BAN_MAX });

  const preview = await previewMassBan(ids);
  if (input.dryRun) {
    await writeAdminAudit({
      actorUserId: input.actorUserId,
      action: 'user_mass_ban_dry_run',
      targetType: 'users',
      targetId: `batch:${ids.length}`,
      metadata: { reason: input.reason, preview },
    });
    return { dryRun: true, preview };
  }

  if (String(input.confirmPhrase || '').trim() !== MASS_BAN_CONFIRM) {
    throw Object.assign(new Error('CONFIRM_REQUIRED'), {
      code: 'CONFIRM_REQUIRED',
      detail: `confirmPhrase must be exactly "${MASS_BAN_CONFIRM}"`,
    });
  }

  const results: Array<{ userId: string; ok: boolean; detail?: string }> = [];
  for (const item of preview.items) {
    if (!item.valid) {
      results.push({ userId: item.userId, ok: false, detail: item.detail || 'invalid' });
      continue;
    }
    if (item.alreadyBanned) {
      results.push({ userId: item.userId, ok: true, detail: 'already_banned' });
      continue;
    }
    try {
      await banUserByAdmin({
        actorUserId: input.actorUserId,
        targetUserId: item.userId,
        reason: input.reason,
        bannedUntil: null,
      });
      results.push({ userId: item.userId, ok: true });
    } catch (e: any) {
      results.push({ userId: item.userId, ok: false, detail: e?.message || String(e) });
    }
  }

  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'user_mass_ban',
    targetType: 'users',
    targetId: `batch:${ids.length}`,
    metadata: { reason: input.reason, results, preview },
  });

  return { dryRun: false, preview, results };
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return { ...(raw as Record<string, unknown>) };
  return {};
}

export type FraudFlags = {
  openChargebackCount: number;
  accountFrozen: boolean;
  underFraudReview: boolean;
  chargebackNote: string | null;
  chargebackUpdatedAt: string | null;
  chargebackUpdatedBy: string | null;
};

export function fraudFlagsFromMetadata(metadata: Record<string, unknown>): FraudFlags {
  const fraud = parseMeta(metadata.fraud);
  return {
    openChargebackCount: Math.max(0, Math.floor(Number(fraud.openChargebackCount) || 0)),
    accountFrozen: fraud.accountFrozen === true,
    underFraudReview: fraud.underFraudReview === true,
    chargebackNote: fraud.chargebackNote != null ? String(fraud.chargebackNote) : null,
    chargebackUpdatedAt: fraud.updatedAt != null ? String(fraud.updatedAt) : null,
    chargebackUpdatedBy: fraud.updatedBy != null ? String(fraud.updatedBy) : null,
  };
}

export async function getUserFraudFlags(userId: string): Promise<FraudFlags> {
  const knex = await db();
  const row = await knex('user_admin_state').where({ user_id: userId }).first();
  return fraudFlagsFromMetadata(parseMeta(row?.metadata));
}

export async function setUserFraudFlags(input: {
  actorUserId: string;
  userId: string;
  openChargebackCount?: number;
  accountFrozen?: boolean;
  underFraudReview?: boolean;
  note?: string | null;
}): Promise<FraudFlags> {
  if (!isCanonicalSub(input.userId)) throw Object.assign(new Error('INVALID_SUB'), { code: 'INVALID_SUB' });
  const knex = await db();
  const row = await knex('user_admin_state').where({ user_id: input.userId }).first();
  const metadata = parseMeta(row?.metadata);
  const current = fraudFlagsFromMetadata(metadata);
  const next: FraudFlags = {
    openChargebackCount:
      input.openChargebackCount !== undefined
        ? Math.max(0, Math.min(99, Math.floor(Number(input.openChargebackCount) || 0)))
        : current.openChargebackCount,
    accountFrozen: input.accountFrozen !== undefined ? input.accountFrozen === true : current.accountFrozen,
    underFraudReview: input.underFraudReview !== undefined ? input.underFraudReview === true : current.underFraudReview,
    chargebackNote: input.note !== undefined ? (input.note ? String(input.note).slice(0, 500) : null) : current.chargebackNote,
    chargebackUpdatedAt: new Date().toISOString(),
    chargebackUpdatedBy: input.actorUserId,
  };

  const nextMeta = {
    ...metadata,
    fraud: {
      openChargebackCount: next.openChargebackCount,
      accountFrozen: next.accountFrozen,
      underFraudReview: next.underFraudReview,
      chargebackNote: next.chargebackNote,
      updatedAt: next.chargebackUpdatedAt,
      updatedBy: next.chargebackUpdatedBy,
    },
  };

  await knex.raw(
    `INSERT INTO user_admin_state (user_id, metadata, updated_at)
     VALUES (?, ?::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET
       metadata = EXCLUDED.metadata,
       updated_at = CURRENT_TIMESTAMP`,
    [input.userId, JSON.stringify(nextMeta)],
  );

  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'user_fraud_flags_set',
    targetType: 'user',
    targetId: input.userId,
    metadata: { fraud: nextMeta.fraud },
  });

  return next;
}

export async function listOpenChargebackUsers(limit = 50): Promise<
  Array<{ userId: string; flags: FraudFlags }>
> {
  const knex = await db();
  const rows = await knex('user_admin_state')
    .select('user_id', 'metadata')
    .whereRaw(`COALESCE((metadata->'fraud'->>'openChargebackCount')::int, 0) > 0`)
    .orderBy('updated_at', 'desc')
    .limit(Math.max(1, Math.min(100, limit)));
  return rows.map((r: any) => ({
    userId: String(r.user_id),
    flags: fraudFlagsFromMetadata(parseMeta(r.metadata)),
  }));
}

export async function buildDsarExportPackage(input: {
  actorUserId: string;
  requestId: string;
}): Promise<{ ok: true; package: Record<string, unknown> } | { ok: false; code: string; detail?: string }> {
  const knex = await db();
  const row = await knex('admin_dsar_requests').where({ request_id: input.requestId }).first();
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  const userId = String(row.user_id);

  const [adminState, wallet, ledgerCount, auditRows, messages] = await Promise.all([
    knex('user_admin_state').where({ user_id: userId }).first().catch(() => null),
    knex('wallets').where({ user_id: userId }).first().catch(() => null),
    knex('ledger_entries').where({ user_id: userId }).count('* as n').first().catch(() => ({ n: 0 })),
    knex('admin_audit_log')
      .where({ target_type: 'user', target_id: userId })
      .orderBy('created_at', 'desc')
      .limit(50)
      .catch(() => []),
    knex('admin_user_messages').where({ user_id: userId }).orderBy('created_at', 'desc').limit(20).catch(() => []),
  ]);

  const exportPackage = {
    generatedAt: new Date().toISOString(),
    generatedBy: input.actorUserId,
    requestId: input.requestId,
    userId,
    requestType: row.request_type,
    sections: {
      adminState: adminState
        ? {
            role: adminState.role,
            isBanned: adminState.is_banned,
            banReason: adminState.ban_reason,
            bannedUntil: adminState.banned_until,
            metadata: parseMeta(adminState.metadata),
            updatedAt: adminState.updated_at,
          }
        : null,
      wallet: wallet
        ? {
            coinBalance: wallet.coin_balance ?? wallet.coins ?? null,
            gemAvailable: wallet.gem_available ?? null,
            gemPending: wallet.gem_pending ?? null,
            createdAt: wallet.created_at,
          }
        : null,
      ledgerEntryCount: Number((ledgerCount as any)?.n || 0),
      recentAdminActions: (auditRows as any[]).map((a) => ({
        action: a.action,
        createdAt: a.created_at,
        metadata: parseMeta(a.metadata),
      })),
      recentAdminMessages: (messages as any[]).map((m) => ({
        messageId: m.message_id,
        channel: m.channel,
        subject: m.subject,
        createdAt: m.created_at,
      })),
    },
    notes: [
      'Export-first package from Cloud Run Postgres mirrors.',
      'Firestore profile / media / messages not fully included in v1 — gather separately if Legal requires.',
      'Hard-delete/purge is Owner-only and separate from this package.',
    ],
  };

  const meta = parseMeta(row.metadata);
  meta.exportPackage = exportPackage;
  meta.exportGeneratedAt = exportPackage.generatedAt;

  await knex.raw(
    `UPDATE admin_dsar_requests
     SET status = ?, metadata = ?::jsonb, updated_at = ?
     WHERE request_id = ?`,
    ['package_ready', JSON.stringify(meta), new Date().toISOString(), input.requestId],
  );

  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'dsar_export_package',
    targetType: 'dsar',
    targetId: input.requestId,
    metadata: { userId, ledgerEntryCount: exportPackage.sections.ledgerEntryCount },
  });

  return { ok: true, package: exportPackage };
}

export async function executeDsarPurge(input: {
  actorUserId: string;
  requestId: string;
  confirmPhrase: string;
  confirmUserId: string;
}): Promise<{ ok: true; deleted: Record<string, number> } | { ok: false; code: string; detail?: string }> {
  if (String(input.confirmPhrase || '').trim() !== DSAR_PURGE_CONFIRM) {
    return { ok: false, code: 'CONFIRM_REQUIRED', detail: `confirmPhrase must be exactly "${DSAR_PURGE_CONFIRM}"` };
  }

  const knex = await db();
  const row = await knex('admin_dsar_requests').where({ request_id: input.requestId }).first();
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (String(row.request_type) !== 'delete') {
    return { ok: false, code: 'WRONG_TYPE', detail: 'Hard-delete only allowed for requestType=delete' };
  }
  if (!['package_ready', 'awaiting_legal', 'in_progress'].includes(String(row.status))) {
    return {
      ok: false,
      code: 'EXPORT_FIRST',
      detail: 'Generate export package (status package_ready) before purge',
    };
  }
  if (String(input.confirmUserId || '').trim() !== String(row.user_id)) {
    return { ok: false, code: 'USER_MISMATCH', detail: 'confirmUserId must match DSAR subject' };
  }

  const meta = parseMeta(row.metadata);
  if (!meta.exportPackage) {
    return { ok: false, code: 'EXPORT_FIRST', detail: 'No export package on request — generate first' };
  }

  const out = await purgeUserData(String(row.user_id));
  meta.purge = {
    at: new Date().toISOString(),
    by: input.actorUserId,
    deleted: out.deleted,
    note: 'Economy personal tables only; immutable ledger retained per policy.',
  };

  await knex.raw(
    `UPDATE admin_dsar_requests
     SET status = ?, resolved_by = ?, resolved_at = ?, updated_at = ?, metadata = ?::jsonb,
         notes = COALESCE(notes || E'\n', '') || ?
     WHERE request_id = ?`,
    [
      'completed',
      input.actorUserId,
      new Date().toISOString(),
      new Date().toISOString(),
      JSON.stringify(meta),
      '[purged economy personal tables]',
      input.requestId,
    ],
  );

  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'dsar_purge',
    targetType: 'dsar',
    targetId: input.requestId,
    metadata: { userId: row.user_id, deleted: out.deleted },
  });

  return { ok: true, deleted: out.deleted };
}

export const DISPUTE_STATUSES = [
  'open',
  'investigating',
  'noted_freeze',
  'resolved',
  'closed',
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export async function listGameDisputes(limit = 50) {
  const knex = await db();
  const rows = await knex('admin_game_disputes').orderBy('created_at', 'desc').limit(Math.max(1, Math.min(100, limit)));
  return rows.map((r: any) => ({
    disputeId: r.dispute_id,
    surface: r.surface,
    referenceId: r.reference_id,
    status: r.status,
    summary: r.summary,
    notes: r.notes,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }));
}

export async function createGameDispute(input: {
  actorUserId: string;
  surface: string;
  referenceId: string;
  summary: string;
  notes?: string | null;
}) {
  const knex = await db();
  const disputeId = randomUUID();
  const now = new Date().toISOString();
  await knex('admin_game_disputes').insert({
    dispute_id: disputeId,
    surface: String(input.surface).slice(0, 40),
    reference_id: String(input.referenceId).slice(0, 128),
    status: 'open',
    summary: String(input.summary).slice(0, 500),
    notes: input.notes != null ? String(input.notes).slice(0, 2000) : null,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
    created_at: now,
    updated_at: now,
  });
  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'game_dispute_create',
    targetType: 'game_dispute',
    targetId: disputeId,
    metadata: { surface: input.surface, referenceId: input.referenceId },
  });
  return disputeId;
}

export async function updateGameDisputeStatus(input: {
  actorUserId: string;
  disputeId: string;
  status: DisputeStatus;
  notes?: string | null;
}) {
  const knex = await db();
  if (!(DISPUTE_STATUSES as readonly string[]).includes(input.status)) {
    throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
  }
  const patch: any = {
    status: input.status,
    updated_by: input.actorUserId,
    updated_at: new Date().toISOString(),
  };
  if (input.notes !== undefined) patch.notes = input.notes;
  const n = await knex('admin_game_disputes').where({ dispute_id: input.disputeId }).update(patch);
  if (!n) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'game_dispute_status',
    targetType: 'game_dispute',
    targetId: input.disputeId,
    metadata: {
      status: input.status,
      notes: input.notes ?? null,
      settlement: 'not_wired',
      detail: 'Status workflow only — freeze/void/refund of pots is not implemented.',
    },
  });
}
