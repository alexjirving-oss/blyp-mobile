"use strict";
/**
 * Outbox — the only sanctioned way to create a notification.
 *
 * enqueue() is idempotent: the doc id is a hash of the dedupeKey, so the same
 * logical event enqueued twice collapses to a single durable record. This is the
 * "never wrong / never double-fire" guarantee at the point of creation.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationIdFor = notificationIdFor;
exports.enqueueNotification = enqueueNotification;
const crypto = __importStar(require("crypto"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const types_1 = require("./types");
function notificationIdFor(dedupeKey) {
    return 'n_' + crypto.createHash('sha1').update(dedupeKey).digest('hex').slice(0, 32);
}
/**
 * Create a queued notification if one doesn't already exist for this dedupeKey.
 * Returns true if newly created, false if it already existed (idempotent no-op).
 */
async function enqueueNotification(input) {
    const db = firebaseAdmin_1.admin.firestore();
    const id = notificationIdFor(input.dedupeKey);
    const now = Date.now();
    const doc = {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data || {},
        dedupeKey: input.dedupeKey,
        collapseKey: input.collapseKey,
        status: 'queued',
        sendAfter: typeof input.sendAfter === 'number' ? input.sendAfter : now,
        attempts: 0,
        maxAttempts: input.maxAttempts || types_1.DEFAULT_MAX_ATTEMPTS,
        nextAttemptAt: 0,
        createdAt: now,
    };
    const ref = db.collection(types_1.NOTIF_COLLECTIONS.notifications).doc(id);
    try {
        // create() throws ALREADY_EXISTS if the doc is present → idempotent.
        await ref.create(doc);
        return true;
    }
    catch (e) {
        const code = (e === null || e === void 0 ? void 0 : e.code) || (e === null || e === void 0 ? void 0 : e.status);
        if (code === 6 || code === 'already-exists' || /already exists/i.test(String(e === null || e === void 0 ? void 0 : e.message))) {
            return false;
        }
        throw e;
    }
}
//# sourceMappingURL=outbox.js.map