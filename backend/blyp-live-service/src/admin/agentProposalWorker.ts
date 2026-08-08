/**
 * Agent proposal worker — generates comment proposals for enabled suggest_only
 * (or approve-queue) agents when real follow/post context exists.
 *
 * Never posts, never gifts/wallet. Auto-post stays hard-off; this only queues
 * pending proposals for Boss approval at /agents.
 */

import { getFirestore } from './firestoreAdmin';
import {
  getGlobalAgentControl,
  listAgentDirectory,
  listPhrases,
  proposeAgentAction,
  type AgentSettings,
} from './agentAutomationService';
import { getEconomyInfra } from '../economy/infra';
import { ensureAdminSchema } from './adminSchema';
import { logger } from '../config/logger';

const DEFAULT_ALLOW_PHRASES = [
  'Nice one — this looks great.',
  'Love this — thanks for sharing.',
  'Really well done.',
  'This made my day.',
  'Great post — keep it up.',
  'Solid work on this.',
];

const LOOKBACK_MS = 48 * 60 * 60 * 1000;
const MAX_FOLLOWING_SCAN = 40;
const MAX_CREATORS_PER_USER = 12;
const MAX_POSTS_PER_CREATOR = 3;
const MAX_PROPOSALS_PER_USER_PER_RUN = 1;
const MAX_PROPOSALS_PER_RUN = 25;
const MAX_ENABLED_USERS = 80;

export type AgentProposalSweepResult = {
  ok: boolean;
  paused: boolean;
  usersScanned: number;
  candidatesSeen: number;
  proposed: number;
  skipped: Record<string, number>;
  errors: string[];
  durationMs: number;
  proposalIds: string[];
};

function inQuietHours(settings: AgentSettings, now = new Date()): boolean {
  const start = settings.quietHoursStart;
  const end = settings.quietHoursEnd;
  if (start == null || end == null) return false;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (start === end) return false;
  const hour = now.getUTCHours();
  if (start < end) return hour >= start && hour < end;
  // Wraps midnight (e.g. 22 → 7)
  return hour >= start || hour < end;
}

function postCreatedMs(data: Record<string, any>): number {
  const raw = data.date ?? data.createdAt ?? data.publishedAt ?? null;
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw;
  if (typeof raw?.toMillis === 'function') return Number(raw.toMillis());
  if (typeof raw?.seconds === 'number') return Number(raw.seconds) * 1000;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isLivePost(data: Record<string, any>): boolean {
  if (data?.moderation?.hidden === true) return false;
  if (data?.isHidden === true || data?.hidden === true) return false;
  const status = String(data.publishStatus || data.status || '').toLowerCase();
  if (!status || status === 'live' || status === 'published' || status === 'public') return true;
  // Legacy docs omit publishStatus — treat as live.
  if (status === 'scheduled' || status === 'paused' || status === 'draft' || status === 'removed') {
    return false;
  }
  return true;
}

function captionOf(data: Record<string, any>): string {
  return String(data.caption || data.title || data.description || data.transcript || '').trim();
}

function containsAvoidTopic(text: string, topicsAvoid: string | null): boolean {
  if (!topicsAvoid) return false;
  const hay = text.toLowerCase();
  const parts = topicsAvoid
    .split(/[,;\n]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length >= 2);
  return parts.some((p) => hay.includes(p));
}

function pickPhrase(opts: {
  allow: string[];
  deny: string[];
  topicsAvoid: string | null;
  caption: string;
  salt: string;
}): string | null {
  const denyLower = opts.deny.map((d) => d.toLowerCase()).filter(Boolean);
  const pool = (opts.allow.length ? opts.allow : DEFAULT_ALLOW_PHRASES)
    .map((t) => String(t || '').trim())
    .filter((t) => t.length >= 2 && t.length <= 500)
    .filter((t) => !denyLower.some((d) => t.toLowerCase().includes(d) || d.includes(t.toLowerCase())))
    .filter((t) => !containsAvoidTopic(t, opts.topicsAvoid))
    // Never propose gift/wallet/monetization spam.
    .filter((t) => !/\b(gift|gifts|wallet|coin|coins|gem|gems|withdraw|stripe|paypal|venmo|cashapp)\b/i.test(t));

  if (!pool.length) return null;
  if (containsAvoidTopic(opts.caption, opts.topicsAvoid)) return null;

  let hash = 0;
  const s = opts.salt || 'x';
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length];
}

async function listFollowingIds(userId: string, limit: number): Promise<string[]> {
  const fs = getFirestore();
  if (!fs) return [];
  try {
    const snap = await fs.collection('users').doc(userId).collection('following').limit(limit).get();
    return snap.docs.map((d) => d.id).filter((id) => id && id !== userId);
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e), userId }, '[agent-worker] following list failed');
    return [];
  }
}

async function listRecentCreatorPosts(
  creatorId: string,
  limit: number,
  sinceMs: number,
): Promise<Array<{ postId: string; caption: string; createdMs: number }>> {
  const fs = getFirestore();
  if (!fs) return [];
  try {
    const snap = await fs.collection('posts').where('userId', '==', creatorId).limit(40).get();
    const rows = snap.docs
      .map((d) => {
        const data = d.data() || {};
        return {
          postId: d.id,
          caption: captionOf(data),
          createdMs: postCreatedMs(data),
          live: isLivePost(data),
        };
      })
      .filter((p) => p.live && p.createdMs >= sinceMs)
      .sort((a, b) => b.createdMs - a.createdMs)
      .slice(0, limit)
      .map(({ postId, caption, createdMs }) => ({ postId, caption, createdMs }));
    return rows;
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e), creatorId }, '[agent-worker] creator posts failed');
    return [];
  }
}

async function countActionsToday(userId: string): Promise<number> {
  const { db } = getEconomyInfra();
  await ensureAdminSchema(db);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const row = await db('agent_action_proposals')
    .where({ user_id: userId })
    .whereIn('status', ['pending', 'approved', 'executed'])
    .andWhere('created_at', '>=', start.toISOString())
    .count<{ count: string }[]>('* as count');
  return Number(row[0]?.count || 0);
}

async function alreadyProposedForTarget(
  userId: string,
  targetType: string,
  targetId: string,
): Promise<boolean> {
  const { db } = getEconomyInfra();
  await ensureAdminSchema(db);
  const row = await db('agent_action_proposals')
    .where({
      user_id: userId,
      target_type: targetType,
      target_id: targetId,
    })
    .whereIn('status', ['pending', 'approved', 'executed'])
    .first();
  return Boolean(row);
}

function bump(skipped: Record<string, number>, key: string) {
  skipped[key] = (skipped[key] || 0) + 1;
}

/**
 * Scan enabled agents and queue comment proposals when followed creators
 * have recent live posts. Safe to run every N minutes via Cloud Scheduler.
 */
export async function runAgentProposalSweep(opts?: {
  dryRun?: boolean;
  maxUsers?: number;
  maxProposals?: number;
}): Promise<AgentProposalSweepResult> {
  const started = Date.now();
  const skipped: Record<string, number> = {};
  const errors: string[] = [];
  const proposalIds: string[] = [];
  let proposed = 0;
  let candidatesSeen = 0;
  let usersScanned = 0;

  const global = await getGlobalAgentControl();
  if (global.paused) {
    return {
      ok: true,
      paused: true,
      usersScanned: 0,
      candidatesSeen: 0,
      proposed: 0,
      skipped: { globally_paused: 1 },
      errors: [],
      durationMs: Date.now() - started,
      proposalIds: [],
    };
  }

  if (!getFirestore()) {
    return {
      ok: false,
      paused: false,
      usersScanned: 0,
      candidatesSeen: 0,
      proposed: 0,
      skipped: { firestore_unavailable: 1 },
      errors: ['firestore_unavailable'],
      durationMs: Date.now() - started,
      proposalIds: [],
    };
  }

  const maxUsers = Math.min(Math.max(opts?.maxUsers ?? MAX_ENABLED_USERS, 1), 200);
  const maxProposals = Math.min(Math.max(opts?.maxProposals ?? MAX_PROPOSALS_PER_RUN, 1), 100);
  const dryRun = Boolean(opts?.dryRun);

  const { items } = await listAgentDirectory({ enabledOnly: true, limit: maxUsers });
  const sinceMs = Date.now() - LOOKBACK_MS;

  for (const settings of items) {
    if (proposed >= maxProposals) break;
    usersScanned += 1;

    // MVP only proposes into the approve queue — never execute.
    // Accept suggest_only and auto_with_limits (forced into suggest path by global flag).
    if (settings.mode === 'off') {
      bump(skipped, 'mode_off');
      continue;
    }
    if (!settings.allowComment) {
      bump(skipped, 'comment_disabled');
      continue;
    }
    if (inQuietHours(settings)) {
      bump(skipped, 'quiet_hours');
      continue;
    }

    const usedToday = await countActionsToday(settings.userId);
    const remaining = Math.max(0, Number(settings.maxActionsPerDay || 0) - usedToday);
    if (remaining <= 0) {
      bump(skipped, 'daily_cap');
      continue;
    }

    const phrases = await listPhrases(settings.userId);
    const allow = phrases.filter((p) => p.kind === 'allow').map((p) => p.text);
    const deny = phrases.filter((p) => p.kind === 'deny').map((p) => p.text);

    const following = await listFollowingIds(settings.userId, MAX_FOLLOWING_SCAN);
    if (!following.length) {
      bump(skipped, 'no_following');
      continue;
    }

    let userProposed = 0;
    for (const creatorId of following.slice(0, MAX_CREATORS_PER_USER)) {
      if (proposed >= maxProposals || userProposed >= MAX_PROPOSALS_PER_USER_PER_RUN) break;
      if (userProposed >= remaining) break;

      const posts = await listRecentCreatorPosts(creatorId, MAX_POSTS_PER_CREATOR, sinceMs);
      for (const post of posts) {
        if (proposed >= maxProposals || userProposed >= MAX_PROPOSALS_PER_USER_PER_RUN) break;
        candidatesSeen += 1;

        if (await alreadyProposedForTarget(settings.userId, 'post', post.postId)) {
          bump(skipped, 'already_proposed');
          continue;
        }

        const phrase = pickPhrase({
          allow,
          deny,
          topicsAvoid: settings.topicsAvoid,
          caption: post.caption,
          salt: `${settings.userId}:${post.postId}`,
        });
        if (!phrase) {
          bump(skipped, 'no_safe_phrase');
          continue;
        }

        const contextSummary = [
          `Followed creator ${creatorId.slice(0, 8)}… posted recently`,
          post.caption ? `caption: "${post.caption.slice(0, 120)}"` : 'no caption',
          `(lookback ${Math.round(LOOKBACK_MS / 3600000)}h)`,
        ].join(' — ');

        if (dryRun) {
          bump(skipped, 'dry_run_would_propose');
          userProposed += 1;
          proposed += 1;
          continue;
        }

        try {
          const out = await proposeAgentAction({
            userId: settings.userId,
            actionType: 'comment',
            targetType: 'post',
            targetId: post.postId,
            proposedText: phrase,
            contextSummary,
            metadata: {
              source: 'agent_proposal_worker',
              creatorId,
              postCreatedMs: post.createdMs,
              mode: settings.mode,
            },
            actorUserId: 'system:agent_proposal_worker',
          });
          proposalIds.push(out.proposalId);
          userProposed += 1;
          proposed += 1;
        } catch (e: any) {
          const msg = e?.message || String(e);
          errors.push(`${settings.userId}:${post.postId}:${msg}`.slice(0, 200));
          bump(skipped, `err_${msg.slice(0, 40)}`);
        }
      }
    }

    if (userProposed === 0) bump(skipped, 'no_candidate_posts');
  }

  const result: AgentProposalSweepResult = {
    ok: errors.length === 0,
    paused: false,
    usersScanned,
    candidatesSeen,
    proposed,
    skipped,
    errors: errors.slice(0, 20),
    durationMs: Date.now() - started,
    proposalIds,
  };

  logger.info(
    {
      proposed: result.proposed,
      usersScanned: result.usersScanned,
      candidatesSeen: result.candidatesSeen,
      skipped: result.skipped,
      dryRun,
      durationMs: result.durationMs,
    },
    '[agent-worker] proposal sweep complete',
  );

  return result;
}
