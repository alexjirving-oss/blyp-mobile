/**
 * Agent execute worker — posts approved (or auto_with_limits) comment proposals
 * to Firestore posts/{postId}/comments. Never creates posts, never gifts/wallet.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from './firestoreAdmin';
import { safeLiveDisplayName } from '../live/liveDisplayName';
import {
  executeAgentProposal,
  getGlobalAgentControl,
  listApprovedPendingExecution,
  type AgentProposal,
} from './agentAutomationService';
import { logger } from '../config/logger';

const MAX_EXECUTES_PER_RUN = 25;

export type AgentExecuteSweepResult = {
  ok: boolean;
  paused: boolean;
  scanned: number;
  executed: number;
  skipped: Record<string, number>;
  errors: string[];
  durationMs: number;
  proposalIds: string[];
};

function bump(skipped: Record<string, number>, key: string) {
  skipped[key] = (skipped[key] || 0) + 1;
}

async function resolveCommentIdentity(userId: string): Promise<{
  displayName: string;
  username: string;
  avatar: string;
}> {
  const fs = getFirestore();
  if (!fs) {
    return { displayName: 'Blyp user', username: 'blyp_user', avatar: '' };
  }
  try {
    const [userSnap, profileSnap] = await Promise.all([
      fs.collection('users').doc(userId).get(),
      fs.collection('userProfiles').doc(userId).get(),
    ]);
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const profile = profileSnap.exists ? profileSnap.data() || {} : {};
    const displayName =
      safeLiveDisplayName(userData.displayName, userId, '') ||
      safeLiveDisplayName(profile.displayName, userId, '') ||
      safeLiveDisplayName(userData.username, userId, '') ||
      safeLiveDisplayName(profile.username, userId, '') ||
      'Blyp user';
    const username =
      safeLiveDisplayName(userData.username, userId, '') ||
      safeLiveDisplayName(profile.username, userId, '') ||
      displayName;
    const avatar = String(
      userData.photoURL || userData.avatar || profile.photoURL || profile.avatar || '',
    );
    return { displayName, username, avatar };
  } catch {
    return { displayName: 'Blyp user', username: 'blyp_user', avatar: '' };
  }
}

/**
 * Write a feed comment as the agent user via Admin SDK.
 * Returns commentId, or null when target is demo/missing (caller marks skipped).
 */
export async function writeAgentCommentToPost(input: {
  userId: string;
  postId: string;
  text: string;
  proposalId: string;
}): Promise<{ commentId: string | null; skipped?: string }> {
  const postId = String(input.postId || '').trim();
  const text = String(input.text || '').trim().slice(0, 2000);
  if (!postId || postId === 'demo') {
    return { commentId: null, skipped: 'demo_or_missing_target' };
  }
  if (!text) throw new Error('EMPTY_TEXT');
  if (/\b(gift|gifts|wallet|coin|coins|gem|gems|withdraw|stripe|paypal|venmo|cashapp)\b/i.test(text)) {
    throw new Error('SPAM_TEXT_BLOCKED');
  }

  const fs = getFirestore();
  if (!fs) throw new Error('FIRESTORE_UNAVAILABLE');

  const postRef = fs.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) throw new Error('POST_NOT_FOUND');

  const identity = await resolveCommentIdentity(input.userId);
  const commentRef = postRef.collection('comments').doc();
  const createdAt = Date.now();

  await fs.runTransaction(async (tx) => {
    tx.set(commentRef, {
      userId: input.userId,
      username: identity.username,
      displayName: identity.displayName,
      avatar: identity.avatar,
      photoURL: identity.avatar,
      text,
      createdAt,
      likes: 0,
      likedBy: [],
      parentId: null,
      source: 'agent_automation',
      agentProposalId: input.proposalId,
    });
    tx.update(postRef, {
      commentCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { commentId: commentRef.id };
}

export async function runAgentExecuteSweep(opts?: {
  dryRun?: boolean;
  maxExecutes?: number;
  actorUserId?: string;
}): Promise<AgentExecuteSweepResult> {
  const started = Date.now();
  const skipped: Record<string, number> = {};
  const errors: string[] = [];
  const proposalIds: string[] = [];
  let executed = 0;
  let scanned = 0;

  const global = await getGlobalAgentControl();
  if (global.paused) {
    return {
      ok: true,
      paused: true,
      scanned: 0,
      executed: 0,
      skipped: { globally_paused: 1 },
      errors: [],
      durationMs: Date.now() - started,
      proposalIds: [],
    };
  }

  const maxExecutes = Math.min(Math.max(opts?.maxExecutes ?? MAX_EXECUTES_PER_RUN, 1), 100);
  const dryRun = Boolean(opts?.dryRun);
  const actor = opts?.actorUserId || 'system:agent_execute_worker';

  const pending = await listApprovedPendingExecution({ limit: maxExecutes });
  for (const proposal of pending) {
    if (executed >= maxExecutes) break;
    scanned += 1;

    if (dryRun) {
      bump(skipped, 'dry_run_would_execute');
      executed += 1;
      continue;
    }

    try {
      const out = await executeAgentProposal({
        proposalId: proposal.proposalId,
        actorUserId: actor,
        writeComment: writeAgentCommentToPost,
      });
      if (out.status === 'executed') {
        proposalIds.push(out.proposalId);
        executed += 1;
      } else {
        bump(skipped, `status_${out.status}`);
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      errors.push(`${proposal.proposalId}:${msg}`.slice(0, 200));
      bump(skipped, `err_${msg.slice(0, 40)}`);
    }
  }

  const result: AgentExecuteSweepResult = {
    ok: errors.length === 0,
    paused: false,
    scanned,
    executed,
    skipped,
    errors: errors.slice(0, 20),
    durationMs: Date.now() - started,
    proposalIds,
  };

  logger.info(
    {
      executed: result.executed,
      scanned: result.scanned,
      skipped: result.skipped,
      dryRun,
      durationMs: result.durationMs,
    },
    '[agent-execute] sweep complete',
  );

  return result;
}

/** Immediate execute after human approve (or auto path). */
export async function executeApprovedProposalNow(
  proposal: AgentProposal,
  actorUserId: string,
): Promise<AgentProposal> {
  return executeAgentProposal({
    proposalId: proposal.proposalId,
    actorUserId,
    writeComment: writeAgentCommentToPost,
  });
}
