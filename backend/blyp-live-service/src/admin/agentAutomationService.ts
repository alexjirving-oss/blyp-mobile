/**
 * Busy-person automated agent MVP — settings, propose/approve queue, boss oversight.
 * Default mode is suggest_only (never auto-post). Proposal generation: agentProposalWorker.
 * Execution (posting after approve) is still out of scope for v1.
 */

import { createHash, randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from '../economy/infra';
import { ensureAdminSchema } from './adminSchema';
import { logger } from '../config/logger';

export const AGENT_MODES = ['off', 'suggest_only', 'auto_with_limits'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export const AGENT_ACTION_TYPES = ['comment', 'reply', 'react', 'post'] as const;
export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

export const AGENT_PROPOSAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'executed',
  'cancelled',
] as const;
export type AgentProposalStatus = (typeof AGENT_PROPOSAL_STATUSES)[number];

const GLOBAL_PAUSE_KEY = 'agent_automation_global';

export type AgentSettings = {
  userId: string;
  enabled: boolean;
  mode: AgentMode;
  allowComment: boolean;
  allowReply: boolean;
  allowReact: boolean;
  allowPost: boolean;
  styleNotes: string | null;
  topicsAvoid: string | null;
  maxActionsPerDay: number;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

export type AgentPhrase = {
  phraseId: string;
  userId: string;
  kind: 'allow' | 'deny';
  text: string;
  createdAt: string | null;
};

export type AgentProposal = {
  proposalId: string;
  userId: string;
  actionType: AgentActionType;
  status: AgentProposalStatus;
  targetType: string | null;
  targetId: string | null;
  proposedText: string | null;
  contextSummary: string | null;
  contentHash: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  executedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AgentActionLogRow = {
  logId: string;
  userId: string;
  proposalId: string | null;
  actionType: string;
  outcome: string;
  detail: string | null;
  actorUserId: string | null;
  createdAt: string | null;
};

async function getDb(): Promise<Knex> {
  const { db } = getEconomyInfra();
  await ensureAdminSchema(db);
  return db;
}

function rowSettings(row: any): AgentSettings {
  return {
    userId: String(row.user_id),
    enabled: Boolean(row.enabled),
    mode: (row.mode as AgentMode) || 'suggest_only',
    allowComment: row.allow_comment !== false,
    allowReply: Boolean(row.allow_reply),
    allowReact: Boolean(row.allow_react),
    allowPost: Boolean(row.allow_post),
    styleNotes: row.style_notes != null ? String(row.style_notes) : null,
    topicsAvoid: row.topics_avoid != null ? String(row.topics_avoid) : null,
    maxActionsPerDay: Number(row.max_actions_per_day ?? 5),
    quietHoursStart: row.quiet_hours_start != null ? Number(row.quiet_hours_start) : null,
    quietHoursEnd: row.quiet_hours_end != null ? Number(row.quiet_hours_end) : null,
    updatedBy: row.updated_by != null ? String(row.updated_by) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function defaultSettings(userId: string): AgentSettings {
  return {
    userId,
    enabled: false,
    mode: 'suggest_only',
    allowComment: true,
    allowReply: false,
    allowReact: false,
    allowPost: false,
    styleNotes: null,
    topicsAvoid: null,
    maxActionsPerDay: 5,
    quietHoursStart: null,
    quietHoursEnd: null,
    updatedBy: null,
    updatedAt: null,
    createdAt: null,
  };
}

function rowProposal(row: any): AgentProposal {
  let metadata: Record<string, unknown> = {};
  try {
    metadata =
      typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : row.metadata && typeof row.metadata === 'object'
          ? row.metadata
          : {};
  } catch {
    metadata = {};
  }
  return {
    proposalId: String(row.proposal_id),
    userId: String(row.user_id),
    actionType: row.action_type as AgentActionType,
    status: row.status as AgentProposalStatus,
    targetType: row.target_type != null ? String(row.target_type) : null,
    targetId: row.target_id != null ? String(row.target_id) : null,
    proposedText: row.proposed_text != null ? String(row.proposed_text) : null,
    contextSummary: row.context_summary != null ? String(row.context_summary) : null,
    contentHash: row.content_hash != null ? String(row.content_hash) : null,
    reviewedBy: row.reviewed_by != null ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    reviewNote: row.review_note != null ? String(row.review_note) : null,
    executedAt: row.executed_at ? new Date(row.executed_at).toISOString() : null,
    metadata,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function hashContent(text: string): string {
  return createHash('sha256').update(String(text || '')).digest('hex').slice(0, 32);
}

export async function getGlobalAgentControl(): Promise<{
  paused: boolean;
  forceSuggestOnly: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}> {
  const db = await getDb();
  const row = await db('admin_config').where({ config_key: GLOBAL_PAUSE_KEY }).first();
  const value = (row?.value || {}) as Record<string, unknown>;
  return {
    paused: Boolean(value.paused),
    forceSuggestOnly: value.forceSuggestOnly !== false,
    updatedBy: row?.updated_by_user_id != null ? String(row.updated_by_user_id) : null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function setGlobalAgentControl(input: {
  paused?: boolean;
  forceSuggestOnly?: boolean;
  actorUserId: string;
}): Promise<Awaited<ReturnType<typeof getGlobalAgentControl>>> {
  const db = await getDb();
  const current = await getGlobalAgentControl();
  const next = {
    paused: input.paused ?? current.paused,
    forceSuggestOnly: input.forceSuggestOnly ?? current.forceSuggestOnly,
  };
  const now = new Date().toISOString();
  await db.raw(
    `INSERT INTO admin_config (config_key, value, updated_by_user_id, updated_at)
     VALUES (?, ?::jsonb, ?, ?)
     ON CONFLICT (config_key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = EXCLUDED.updated_at`,
    [GLOBAL_PAUSE_KEY, JSON.stringify(next), input.actorUserId, now],
  );
  return getGlobalAgentControl();
}

export async function getAgentSettings(userId: string): Promise<AgentSettings> {
  const db = await getDb();
  const row = await db('user_agent_settings').where({ user_id: userId }).first();
  return row ? rowSettings(row) : defaultSettings(userId);
}

export async function upsertAgentSettings(input: {
  userId: string;
  actorUserId: string;
  enabled?: boolean;
  mode?: AgentMode;
  allowComment?: boolean;
  allowReply?: boolean;
  allowReact?: boolean;
  allowPost?: boolean;
  styleNotes?: string | null;
  topicsAvoid?: string | null;
  maxActionsPerDay?: number;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
}): Promise<AgentSettings> {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('INVALID_USER');

  const mode = input.mode ?? 'suggest_only';
  if (!AGENT_MODES.includes(mode)) throw new Error('INVALID_MODE');

  // Hard safety: auto-post stays off in MVP (highest abuse surface).
  const allowPost = false;

  const db = await getDb();
  const now = new Date().toISOString();
  const existing = await getAgentSettings(userId);

  await db.raw(
    `INSERT INTO user_agent_settings (
       user_id, enabled, mode, allow_comment, allow_reply, allow_react, allow_post,
       style_notes, topics_avoid, max_actions_per_day, quiet_hours_start, quiet_hours_end,
       updated_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       mode = EXCLUDED.mode,
       allow_comment = EXCLUDED.allow_comment,
       allow_reply = EXCLUDED.allow_reply,
       allow_react = EXCLUDED.allow_react,
       allow_post = EXCLUDED.allow_post,
       style_notes = EXCLUDED.style_notes,
       topics_avoid = EXCLUDED.topics_avoid,
       max_actions_per_day = EXCLUDED.max_actions_per_day,
       quiet_hours_start = EXCLUDED.quiet_hours_start,
       quiet_hours_end = EXCLUDED.quiet_hours_end,
       updated_by = EXCLUDED.updated_by,
       updated_at = EXCLUDED.updated_at`,
    [
      userId,
      input.enabled ?? existing.enabled,
      mode,
      input.allowComment ?? existing.allowComment,
      input.allowReply ?? existing.allowReply,
      input.allowReact ?? existing.allowReact,
      allowPost,
      input.styleNotes !== undefined ? input.styleNotes : existing.styleNotes,
      input.topicsAvoid !== undefined ? input.topicsAvoid : existing.topicsAvoid,
      input.maxActionsPerDay ?? existing.maxActionsPerDay,
      input.quietHoursStart !== undefined ? input.quietHoursStart : existing.quietHoursStart,
      input.quietHoursEnd !== undefined ? input.quietHoursEnd : existing.quietHoursEnd,
      input.actorUserId,
      now,
      now,
    ],
  );

  return getAgentSettings(userId);
}

export async function listAgentDirectory(opts?: {
  enabledOnly?: boolean;
  limit?: number;
}): Promise<{ items: AgentSettings[]; global: Awaited<ReturnType<typeof getGlobalAgentControl>> }> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  let q = db('user_agent_settings').orderBy('updated_at', 'desc').limit(limit);
  if (opts?.enabledOnly) q = q.where({ enabled: true });
  const rows = await q;
  return {
    items: rows.map(rowSettings),
    global: await getGlobalAgentControl(),
  };
}

export async function listPhrases(userId: string): Promise<AgentPhrase[]> {
  const db = await getDb();
  const rows = await db('user_agent_phrases').where({ user_id: userId }).orderBy('created_at', 'desc');
  return rows.map((row: any) => ({
    phraseId: String(row.phrase_id),
    userId: String(row.user_id),
    kind: row.kind as 'allow' | 'deny',
    text: String(row.text || ''),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

export async function addPhrase(input: {
  userId: string;
  kind: 'allow' | 'deny';
  text: string;
}): Promise<AgentPhrase> {
  const text = String(input.text || '').trim().slice(0, 500);
  if (!text) throw new Error('EMPTY_PHRASE');
  const kind = input.kind === 'deny' ? 'deny' : 'allow';
  const phraseId = `aphr_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const db = await getDb();
  const now = new Date().toISOString();
  await db('user_agent_phrases').insert({
    phrase_id: phraseId,
    user_id: input.userId,
    kind,
    text,
    created_at: now,
  });
  const rows = await listPhrases(input.userId);
  const found = rows.find((p) => p.phraseId === phraseId);
  if (!found) throw new Error('PHRASE_CREATE_FAILED');
  return found;
}

export async function deletePhrase(phraseId: string): Promise<boolean> {
  const db = await getDb();
  const n = await db('user_agent_phrases').where({ phrase_id: phraseId }).del();
  return n > 0;
}

export async function proposeAgentAction(input: {
  userId: string;
  actionType: AgentActionType;
  targetType?: string | null;
  targetId?: string | null;
  proposedText?: string | null;
  contextSummary?: string | null;
  metadata?: Record<string, unknown>;
  actorUserId?: string | null;
}): Promise<AgentProposal> {
  if (!AGENT_ACTION_TYPES.includes(input.actionType)) throw new Error('INVALID_ACTION_TYPE');
  if (input.actionType === 'post') {
    throw new Error('AUTO_POST_DISABLED');
  }

  const global = await getGlobalAgentControl();
  if (global.paused) throw new Error('AGENTS_GLOBALLY_PAUSED');

  const settings = await getAgentSettings(input.userId);
  if (!settings.enabled && !input.actorUserId) {
    throw new Error('AGENT_DISABLED');
  }

  const text = input.proposedText != null ? String(input.proposedText).slice(0, 2000) : null;
  if (!input.contextSummary || !String(input.contextSummary).trim()) {
    throw new Error('CONTEXT_REQUIRED');
  }

  const proposalId = `aprop_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = new Date().toISOString();
  const db = await getDb();

  await db('agent_action_proposals').insert({
    proposal_id: proposalId,
    user_id: input.userId,
    action_type: input.actionType,
    status: 'pending',
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    proposed_text: text,
    context_summary: String(input.contextSummary).slice(0, 2000),
    content_hash: text ? hashContent(text) : null,
    metadata: JSON.stringify(input.metadata || {}),
    created_at: now,
    updated_at: now,
  });

  await appendAgentLog({
    userId: input.userId,
    proposalId,
    actionType: input.actionType,
    outcome: 'proposed',
    detail: 'queued for human approval (suggest_only / approve queue)',
    actorUserId: input.actorUserId ?? null,
  });

  const row = await db('agent_action_proposals').where({ proposal_id: proposalId }).first();
  return rowProposal(row);
}

export async function listProposals(opts: {
  userId?: string;
  status?: AgentProposalStatus | 'all';
  limit?: number;
}): Promise<{ items: AgentProposal[]; pendingCount: number }> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  let q = db('agent_action_proposals').orderBy('created_at', 'desc').limit(limit);
  if (opts.userId) q = q.where({ user_id: opts.userId });
  if (opts.status && opts.status !== 'all') q = q.where({ status: opts.status });
  const rows = await q;

  let pendingQ = db('agent_action_proposals').where({ status: 'pending' }).count<{ count: string }[]>('* as count');
  if (opts.userId) pendingQ = pendingQ.andWhere({ user_id: opts.userId });
  const pendingRows = await pendingQ;
  const pendingCount = Number(pendingRows[0]?.count || 0);

  return { items: rows.map(rowProposal), pendingCount };
}

export async function reviewProposal(input: {
  proposalId: string;
  decision: 'approved' | 'rejected' | 'cancelled';
  actorUserId: string;
  reviewNote?: string | null;
}): Promise<AgentProposal> {
  const db = await getDb();
  const row = await db('agent_action_proposals').where({ proposal_id: input.proposalId }).first();
  if (!row) throw new Error('NOT_FOUND');
  if (String(row.status) !== 'pending') throw new Error('NOT_PENDING');

  const now = new Date().toISOString();
  await db('agent_action_proposals')
    .where({ proposal_id: input.proposalId })
    .update({
      status: input.decision,
      reviewed_by: input.actorUserId,
      reviewed_at: now,
      review_note: input.reviewNote ?? null,
      updated_at: now,
    });

  await appendAgentLog({
    userId: String(row.user_id),
    proposalId: input.proposalId,
    actionType: String(row.action_type),
    outcome: input.decision,
    detail: input.reviewNote || null,
    actorUserId: input.actorUserId,
  });

  // MVP: approval does not execute — worker not wired. Status stays approved until executor ships.
  const updated = await db('agent_action_proposals').where({ proposal_id: input.proposalId }).first();
  return rowProposal(updated);
}

async function appendAgentLog(input: {
  userId: string;
  proposalId: string | null;
  actionType: string;
  outcome: string;
  detail: string | null;
  actorUserId: string | null;
}): Promise<void> {
  try {
    const db = await getDb();
    const logId = `alog_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db('agent_action_log').insert({
      log_id: logId,
      user_id: input.userId,
      proposal_id: input.proposalId,
      action_type: input.actionType,
      outcome: input.outcome,
      detail: input.detail,
      actor_user_id: input.actorUserId,
      created_at: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err) }, '[agent-automation] log write failed');
  }
}

export async function listAgentLog(opts: {
  userId?: string;
  limit?: number;
}): Promise<AgentActionLogRow[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  let q = db('agent_action_log').orderBy('created_at', 'desc').limit(limit);
  if (opts.userId) q = q.where({ user_id: opts.userId });
  const rows = await q;
  return rows.map((row: any) => ({
    logId: String(row.log_id),
    userId: String(row.user_id),
    proposalId: row.proposal_id != null ? String(row.proposal_id) : null,
    actionType: String(row.action_type || ''),
    outcome: String(row.outcome || ''),
    detail: row.detail != null ? String(row.detail) : null,
    actorUserId: row.actor_user_id != null ? String(row.actor_user_id) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}
