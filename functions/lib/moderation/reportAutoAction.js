"use strict";
/**
 * Report auto-action + alerting (P0.3).
 *
 * Called by aggregateReport after a report is folded into moderationQueue. It
 * decides whether the accumulated signal warrants an automatic action and/or an
 * admin alert, then applies it:
 *
 *  - Critical reasons (child_safety) act on the FIRST report — zero tolerance.
 *  - Serious reasons (nudity_sexual, violence, hate, self_harm) act once two or
 *    more reports land, and always raise an alert.
 *  - Any target crossing AUTO_HIDE_THRESHOLD distinct reports is auto-hidden.
 *
 * "Auto-hide" is only applied to posts today (we can locate and flag them
 * deterministically). The client feed/viewer must honour posts.moderation.hidden.
 * For users/comments/streams we raise an alert and mark the queue item for
 * priority human review rather than taking an irreversible automated action.
 *
 * Never throws.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateAutoAction = void 0;
const firebaseAdmin_1 = require("../firebaseAdmin");
const AUTO_HIDE_THRESHOLD = 3;
const CRITICAL_REASONS = new Set(['child_safety']);
const SERIOUS_REASONS = new Set(['nudity_sexual', 'violence', 'hate', 'self_harm', 'illegal']);
function decide(input) {
    const { reasonCode, totalReports } = input;
    if (CRITICAL_REASONS.has(reasonCode)) {
        return { hide: true, alert: true, severity: 'critical', reason: `critical_reason:${reasonCode}` };
    }
    if (SERIOUS_REASONS.has(reasonCode)) {
        return {
            hide: totalReports >= 2,
            alert: true,
            severity: 'high',
            reason: `serious_reason:${reasonCode}:reports=${totalReports}`,
        };
    }
    if (totalReports >= AUTO_HIDE_THRESHOLD) {
        return { hide: true, alert: true, severity: 'normal', reason: `threshold:reports=${totalReports}` };
    }
    return { hide: false, alert: false, severity: 'normal', reason: '' };
}
async function hidePost(db, postId, reason) {
    var _a;
    try {
        const ref = db.collection('posts').doc(postId);
        const cur = await ref.get();
        if (!cur.exists)
            return false;
        const existing = (_a = cur.data()) === null || _a === void 0 ? void 0 : _a.moderation;
        if (existing === null || existing === void 0 ? void 0 : existing.hidden)
            return true; // already hidden — idempotent
        await ref.set({
            moderation: {
                hidden: true,
                reason,
                source: 'auto_report',
                at: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            },
        }, { merge: true });
        return true;
    }
    catch (e) {
        console.warn('[reportAutoAction] hidePost failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return false;
    }
}
async function evaluateAutoAction(db, input) {
    let verdict;
    try {
        verdict = decide(input);
    }
    catch (e) {
        console.warn('[reportAutoAction] decide failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return;
    }
    if (!verdict.hide && !verdict.alert)
        return;
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
            createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (e) {
        console.warn('[reportAutoAction] audit failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    // Escalate the queue item so humans triage serious things first.
    try {
        await db.collection('moderationQueue').doc(queueDocId).set({
            status: 'under_review',
            autoActioned: true,
            autoActionSeverity: verdict.severity,
            autoActionHidden: hidden,
            autoActionedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    catch (e) {
        console.warn('[reportAutoAction] queue escalate failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
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
                hidden,
                status: 'open',
                createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            });
            console.error(`[ALERT][report_auto_action] sev=${verdict.severity} ${input.targetType}/${input.targetId} reason=${input.reasonCode} reports=${input.totalReports} hidden=${hidden}`);
        }
        catch (e) {
            console.warn('[reportAutoAction] alert failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        }
    }
}
exports.evaluateAutoAction = evaluateAutoAction;
//# sourceMappingURL=reportAutoAction.js.map