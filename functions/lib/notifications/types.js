"use strict";
/**
 * Notification spine — shared types & constants.
 *
 * Design bar (non-negotiable): a notification you'd trust with a real appointment.
 *  - NEVER WRONG: every send is keyed by a deterministic dedupeKey so the same
 *    event can't fire twice, and the dispatcher claims each doc transactionally
 *    so concurrent runs can't double-send.
 *  - NEVER SILENT: every intent becomes a durable `notifications/{id}` document.
 *    Failures retry with backoff; permanent failures become `dead` but remain
 *    visible. The dispatcher writes a heartbeat that knows what it still owes.
 *  - NEVER LEAVES YOU UNINFORMED: the same durable doc is the in-app inbox and
 *    the catch-up surface, so a missed push still reconciles on next app open.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.backoffMs = exports.DEFAULT_MAX_ATTEMPTS = exports.DISPATCH_HEARTBEAT_DOC = exports.NOTIF_COLLECTIONS = void 0;
exports.NOTIF_COLLECTIONS = {
    /** Durable outbox + inbox. One doc per (recipient, event). */
    notifications: 'notifications',
    /** Per-user push tokens: users/{uid}/devices/{deviceId}. */
    devicesSub: 'devices',
    /** Job heartbeats / cursors live alongside the rest of the platform state. */
    platformState: 'platformState',
};
/** Heartbeat doc id under platformState. */
exports.DISPATCH_HEARTBEAT_DOC = 'notificationDispatch';
exports.DEFAULT_MAX_ATTEMPTS = 5;
/** Exponential backoff with a sane ceiling (ms). attempt is 1-based. */
function backoffMs(attempt) {
    const base = 30000; // 30s
    const ms = base * Math.pow(2, Math.max(0, attempt - 1));
    return Math.min(ms, 30 * 60000); // cap at 30 min
}
exports.backoffMs = backoffMs;
//# sourceMappingURL=types.js.map