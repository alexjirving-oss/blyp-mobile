/**
 * Report auto-action + alerting (P0.3).
 *
 * Called by aggregateReport after a report is folded into moderationQueue. It
 * decides whether the accumulated signal warrants an automatic action and/or an
 * admin alert, then applies it:
 *
 *  - Critical reasons (child_safety) always alert for admin review, but only
 *    auto-hide once CRITICAL_HIDE_REPORTERS distinct reporters have reported.
 *  - Serious reasons (nudity_sexual, violence, hate, self_harm) act once two or
 *    more reports land, and always raise an alert.
 *  - Any target crossing AUTO_HIDE_THRESHOLD distinct reports is auto-hidden.
 *
 * Thresholds may be overridden at runtime via Firestore
 * `appConfig/autoModPolicy` (written by Cloud Run admin console). Missing or
 * invalid fields fall back to the compile-time defaults below.
 *
 * "Auto-hide" is only applied to posts today (we can locate and flag them
 * deterministically). The client feed/viewer must honour posts.moderation.hidden.
 * For users/comments/streams we raise an alert and mark the queue item for
 * priority human review rather than taking an irreversible automated action.
 *
 * Never throws.
 */

import { admin } from '../firebaseAdmin';

type Db = admin.firestore.Firestore;

const DEFAULT_AUTO_HIDE_THRESHOLD = 3;
/** Distinct reporters required before a child_safety report auto-hides a post. */
const DEFAULT_CRITICAL_HIDE_REPORTERS = 2;
const DEFAULT_SERIOUS_HIDE_REPORTS = 2;
const CRITICAL_REASONS = new Set(['child_safety']);
const SERIOUS_REASONS = new Set(['nudity_sexual', 'violence', 'hate', 'self_harm', 'illegal']);

type RuntimePolicy = {
  autoHideThreshold: number;
  criticalHideReporters: number;
  seriousHideReports: number;
};

let policyCache: { at: number; policy: RuntimePolicy } | null = null;
const POLICY_TTL_MS = 60_000;

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

async function loadPolicy(db: Db): Promise<RuntimePolicy> {
  const now = Date.now();
  if (policyCache && now - policyCache.at < POLICY_TTL_MS) return policyCache.policy;
  const fallback: RuntimePolicy = {
    autoHideThreshold: DEFAULT_AUTO_HIDE_THRESHOLD,
    criticalHideReporters: DEFAULT_CRITICAL_HIDE_REPORTERS,
    seriousHideReports: DEFAULT_SERIOUS_HIDE_REPORTS,
  };
  try {
    const snap = await db.collection('appConfig').doc('autoModPolicy').get();
    if (!snap.exists) {
      policyCache = { at: now, policy: fallback };
      return fallback;
    }
    const data = snap.data() || {};
    const policy: RuntimePolicy = {
      autoHideThreshold: clamp(data.autoHideThreshold, 1, 50, fallback.autoHideThreshold),
      criticalHideReporters: clamp(data.criticalHideReporters, 1, 20, fallback.criticalHideReporters),
      seriousHideReports: clamp(data.seriousHideReports, 1, 20, fallback.seriousHideReports),
    };
    policyCache = { at: now, policy };
    return policy;
  } catch (e) {
    console.warn('[reportAutoAction] loadPolicy failed', (e as any)?.message || String(e));
    policyCache = { at: now, policy: fallback };
    return fallback;
  }
}

export interface AutoActionInput {
  targetType: string;
  targetId: string;
  reasonCode: string;
  totalReports: number;
  /** Distinct reporter uids when available; falls back to totalReports. */
  distinctReporters?: number;
  reasons: Record<string, number>;
  reportId: string;
}

function reporterSignal(input: AutoActionInput): number {
  const n = Number(input.distinctReporters);
  if (Number.isFinite(n) && n > 0) return n;
  return input.totalReports;
}

function decide(
  input: AutoActionInput,
  policy: RuntimePolicy,
): { hide: boolean; alert: boolean; severity: 'critical' | 'high' | 'normal'; reason: string } {
  const { reasonCode, totalReports } = input;
  const reporters = reporterSignal(input);
  if (CRITICAL_REASONS.has(reasonCode)) {
    // Always escalate for human review; never hide on a single reporter.
    return {
      hide: reporters >= policy.criticalHideReporters,
      alert: true,
      severity: 'critical',
      reason: `critical_reason:${reasonCode}:reporters=${reporters}`,
    };
  }
  if (SERIOUS_REASONS.has(reasonCode)) {
    return {
      hide: totalReports >= policy.seriousHideReports,
      alert: true,
      severity: 'high',
      reason: `serious_reason:${reasonCode}:reports=${totalReports}`,
    };
  }
  if (totalReports >= policy.autoHideThreshold) {
    return { hide: true, alert: true, severity: 'normal', reason: `threshold:reports=${totalReports}` };
  }
  return { hide: false, alert: false, severity: 'normal', reason: '' };
}

async function hidePost(db: Db, postId: string, reason: string): Promise<boolean> {
  try {
    const ref = db.collection('posts').doc(postId);
    const cur = await ref.get();
    if (!cur.exists) return false;
    const existing = (cur.data() as any)?.moderation;
    if (existing?.hidden) return true; // already hidden — idempotent
    await ref.set(
      {
        moderation: {
          hidden: true,
          reason,
          source: 'auto_report',
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
    return true;
  } catch (e) {
    console.warn('[reportAutoAction] hidePost failed', (e as any)?.message || String(e));
    return false;
  }
}

export async function evaluateAutoAction(db: Db, input: AutoActionInput): Promise<void> {
  const policy = await loadPolicy(db);
  let verdict;
  try {
    verdict = decide(input, policy);
  } catch (e) {
    console.warn('[reportAutoAction] decide failed', (e as any)?.message || String(e));
    return;
  }
  if (!verdict.hide && !verdict.alert) return;

  const queueDocId = `${input.targetType}_${input.targetId}`;
  let hidden = false;

  if (verdict.hide && input.targetType === 'post') {
    hidden = await hidePost(db, input.targetId, verdict.reason);
  }

  // Audit the automated decision.
  try {
    await db.collection('moderationActions').add({
      actorId: 'system',
      source: 'auto_report',
      actionType: hidden ? 'post_hidden' : 'flagged_for_review',
      targetType: input.targetType,
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      severity: verdict.severity,
      decisionReason: verdict.reason,
      totalReports: input.totalReports,
      distinctReporters: reporterSignal(input),
      policy,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[reportAutoAction] audit failed', (e as any)?.message || String(e));
  }

  // Escalate the queue item so humans triage serious things first.
  try {
    await db.collection('moderationQueue').doc(queueDocId).set(
      {
        status: 'under_review',
        autoActioned: true,
        autoActionSeverity: verdict.severity,
        autoActionHidden: hidden,
        autoActionedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('[reportAutoAction] queue escalate failed', (e as any)?.message || String(e));
  }

  if (verdict.alert) {
    try {
      await db.collection('adminAlerts').add({
        kind: 'report_auto_action',
        severity: verdict.severity,
        targetType: input.targetType,
        targetId: input.targetId,
        reasonCode: input.reasonCode,
        totalReports: input.totalReports,
        distinctReporters: reporterSignal(input),
        hidden,
        status: 'open',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.error(
        `[ALERT][report_auto_action] sev=${verdict.severity} ${input.targetType}/${input.targetId} reason=${input.reasonCode} reports=${input.totalReports} reporters=${reporterSignal(input)} hidden=${hidden}`
      );
    } catch (e) {
      console.warn('[reportAutoAction] alert failed', (e as any)?.message || String(e));
    }
  }
}

/** Exported for unit tests. */
export const __test = {
  decide,
  CRITICAL_HIDE_REPORTERS: DEFAULT_CRITICAL_HIDE_REPORTERS,
  AUTO_HIDE_THRESHOLD: DEFAULT_AUTO_HIDE_THRESHOLD,
  loadPolicy,
};
