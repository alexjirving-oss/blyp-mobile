"use strict";
/**
 * Earn-your-reach engine — the pure, explainable core of Blyp's distribution model.
 *
 * The whole philosophy of the Blyp Charter lives in this file: REACH IS EARNED, not
 * bought. A post is shown to a small "audition" audience first; if real people
 * genuinely engage with it (watch it, like it, share it, save it) it earns a bigger
 * "wave", and so on, all the way to full organic reach. A post that doesn't connect
 * gently rests — it is never hard-deleted from the feed, just down-weighted, and it
 * can always recover. Paying ("boost") buys a bigger/faster AUDITION, never a
 * guaranteed outcome. Editing a post sends it back to audition to re-earn its place.
 *
 * Everything here is a pure function of counters so it can be unit-tested, audited
 * and shown to creators verbatim in the Transparency hub.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyReachDeltas = exports.reAuditionReach = exports.initialReach = exports.computeBlypScore = exports.emptyEngagements = exports.MAX_WAVE = exports.REST_SCORE = exports.PROMOTE_SCORE = exports.MIN_IMPRESSIONS_TO_JUDGE = exports.BOOSTED_AUDITION_EXPOSURE = exports.WAVE_EXPOSURE = void 0;
const types_1 = require("../platform/types");
/** Per-wave audience exposure (share of eligible audience sampled). Transparent. */
exports.WAVE_EXPOSURE = [0.08, 0.2, 0.45, 0.75, 1.0];
/** A boosted audition widens the *initial* sampling only (still must earn the rest). */
exports.BOOSTED_AUDITION_EXPOSURE = 0.18;
/** Minimum impressions a post must gather in a wave before it can be judged. */
exports.MIN_IMPRESSIONS_TO_JUDGE = [40, 120, 350, 900, Infinity];
/** Blyp Score (0..100) at/above which a wave is passed and reach grows. */
exports.PROMOTE_SCORE = 58;
/** Below this (after enough impressions) a post rests and its exposure decays. */
exports.REST_SCORE = 28;
/** Saturation constant for the score curve (tuned so a healthy rate ~0.6 -> ~50). */
const SCORE_K = 0.6;
exports.MAX_WAVE = exports.WAVE_EXPOSURE.length - 1; // graduated
/** Weights for the positive-engagement signal. Watch-through is king on a video app. */
const W = {
    like: 1,
    comment: 3,
    share: 4,
    save: 3,
    completion: 2,
    dwellSecPerImpressionCap: 20,
    dwellWeight: 0.08,
};
function emptyEngagements() {
    return { likes: 0, comments: 0, shares: 0, saves: 0, completions: 0, dwellMsTotal: 0 };
}
exports.emptyEngagements = emptyEngagements;
/**
 * The Blyp Score: positive engagement per impression, on a saturating 0..100 curve.
 * Pure and explainable — this exact computation is what creators see.
 */
function computeBlypScore(impressions, e) {
    const imps = Math.max(impressions, 0);
    if (imps < 1)
        return 0;
    const avgDwellSec = Math.min(e.dwellMsTotal / 1000 / imps, W.dwellSecPerImpressionCap);
    const dwellPoints = avgDwellSec * W.dwellWeight * imps;
    const positive = e.likes * W.like +
        e.comments * W.comment +
        e.shares * W.share +
        e.saves * W.save +
        e.completions * W.completion +
        dwellPoints;
    const rate = positive / imps;
    const score = 100 * (rate / (rate + SCORE_K));
    return Math.round(Math.max(0, Math.min(100, score)));
}
exports.computeBlypScore = computeBlypScore;
function stageForWave(wave, resting) {
    if (resting)
        return 'resting';
    if (wave <= 0)
        return 'audition';
    if (wave >= exports.MAX_WAVE)
        return 'graduated';
    return 'rising';
}
/** A brand-new post's reach state: enters audition immediately. */
function initialReach(now, boosted = false) {
    return {
        v: types_1.REACH_VERSION,
        wave: 0,
        stage: 'audition',
        exposure: boosted ? exports.BOOSTED_AUDITION_EXPOSURE : exports.WAVE_EXPOSURE[0],
        score: 0,
        impressions: 0,
        waveImpressions: 0,
        engagements: emptyEngagements(),
        version: 1,
        boosted: boosted || undefined,
        enteredWaveAt: now,
        lastScoredAt: now,
        updatedAt: now,
    };
}
exports.initialReach = initialReach;
/** Reset a post back to audition after an edit (no penalty — a fresh fair shot). */
function reAuditionReach(prev, now) {
    const base = initialReach(now, false);
    base.version = ((prev === null || prev === void 0 ? void 0 : prev.version) || 1) + 1;
    return base;
}
exports.reAuditionReach = reAuditionReach;
/**
 * Fold a batch of newly-counted signals into a post's reach state and re-judge it.
 * Returns the next PostReach. Pure — the caller owns the read/write transaction.
 */
function applyReachDeltas(prev, deltas, now) {
    var _a, _b, _c, _d, _e, _f;
    const cur = prev || initialReach(now, false);
    const eng = {
        likes: (((_a = cur.engagements) === null || _a === void 0 ? void 0 : _a.likes) || 0) + deltas.likes,
        comments: (((_b = cur.engagements) === null || _b === void 0 ? void 0 : _b.comments) || 0) + deltas.comments,
        shares: (((_c = cur.engagements) === null || _c === void 0 ? void 0 : _c.shares) || 0) + deltas.shares,
        saves: (((_d = cur.engagements) === null || _d === void 0 ? void 0 : _d.saves) || 0) + deltas.saves,
        completions: (((_e = cur.engagements) === null || _e === void 0 ? void 0 : _e.completions) || 0) + deltas.completions,
        dwellMsTotal: (((_f = cur.engagements) === null || _f === void 0 ? void 0 : _f.dwellMsTotal) || 0) + deltas.dwellMsTotal,
    };
    const impressions = (cur.impressions || 0) + Math.max(0, deltas.impressions);
    let waveImpressions = (cur.waveImpressions || 0) + Math.max(0, deltas.impressions);
    let wave = cur.wave || 0;
    const score = computeBlypScore(impressions, eng);
    let resting = cur.stage === 'resting';
    const minToJudge = exports.MIN_IMPRESSIONS_TO_JUDGE[Math.min(wave, exports.MAX_WAVE)];
    if (wave < exports.MAX_WAVE && waveImpressions >= minToJudge) {
        if (score >= exports.PROMOTE_SCORE) {
            // Earned the next wave — reset the wave-impression counter for a fresh judgement.
            wave += 1;
            waveImpressions = 0;
            resting = false;
        }
        else if (score < exports.REST_SCORE) {
            resting = true;
        }
        else {
            resting = false;
        }
    }
    else if (resting && score >= exports.PROMOTE_SCORE) {
        // A resting post that recovers can rejoin its wave.
        resting = false;
    }
    const stage = stageForWave(wave, resting);
    const baseExposure = exports.WAVE_EXPOSURE[Math.min(wave, exports.MAX_WAVE)];
    const exposure = resting ? Math.max(0.03, baseExposure * 0.35) : (cur.boosted && wave === 0 ? Math.max(baseExposure, exports.BOOSTED_AUDITION_EXPOSURE) : baseExposure);
    return {
        v: types_1.REACH_VERSION,
        wave,
        stage,
        exposure: Number(exposure.toFixed(4)),
        score,
        impressions,
        waveImpressions,
        engagements: eng,
        version: cur.version || 1,
        boosted: cur.boosted,
        enteredWaveAt: wave !== cur.wave ? now : cur.enteredWaveAt || now,
        lastScoredAt: now,
        updatedAt: now,
    };
}
exports.applyReachDeltas = applyReachDeltas;
//# sourceMappingURL=reach.js.map