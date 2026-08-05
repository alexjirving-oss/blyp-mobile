"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditSubscriptionCoinsViaLiveService = creditSubscriptionCoinsViaLiveService;
/**
 * Subscription coin grant -> live-service Postgres wallet.
 *
 * Subscription coins (Plus+Coins monthly 999) MUST be credited to the same
 * Postgres wallet the app reads and spends from. Previously they were written to
 * a separate Firestore ledger and stranded (credited there, spent from Postgres)
 * — i.e. invisible/unspendable. This calls the live-service internal endpoint
 * (shared-secret auth) which credits Postgres idempotently per billing period.
 *
 * Never throws: a transient credit failure must not fail subscription
 * activation/renewal. The period-scoped idempotency key means a later retry
 * (re-activate, or an RTDN RENEWED/RECOVERED) reconciles the grant exactly once.
 *
 * Needs (functions environment):
 *   - LIVE_SERVICE_BASE_URL   e.g. https://blyp-live-service-xxxxx.run.app
 *   - INTERNAL_SHARED_SECRET  the same secret set on the live-service
 */
async function creditSubscriptionCoinsViaLiveService(params) {
    const base = String(process.env.LIVE_SERVICE_BASE_URL || '').replace(/\/+$/, '');
    const secret = String(process.env.INTERNAL_SHARED_SECRET || '').trim();
    if (!base || !secret) {
        console.error('[subscriptions] coin grant SKIPPED: LIVE_SERVICE_BASE_URL / INTERNAL_SHARED_SECRET not configured');
        return { ok: false, granted: 0 };
    }
    try {
        const resp = await fetch(`${base}/internal/subscription/credit-coins`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
            body: JSON.stringify({
                userId: params.uid,
                coins: params.coins,
                idempotencyKey: params.idempotencyKey,
                sku: params.sku,
                source: params.source,
            }),
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            console.error('[subscriptions] coin grant failed', resp.status, text.slice(0, 300));
            return { ok: false, granted: 0 };
        }
        const data = await resp.json().catch(() => ({}));
        return { ok: true, granted: Number((data === null || data === void 0 ? void 0 : data.granted) || 0) };
    }
    catch (e) {
        console.error('[subscriptions] coin grant error', e === null || e === void 0 ? void 0 : e.message);
        return { ok: false, granted: 0 };
    }
}
//# sourceMappingURL=coinGrant.js.map