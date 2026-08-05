"use strict";
/**
 * "Blyp it" — AI compose-and-send assistant (premium).
 *
 * A subscriber speaks to the Ask Blyp bar ("Blyp Ru — tough luck about the
 * football") and the backend returns a ready-to-send DRAFT: warm, on-tone message
 * options + an AI-generated image. The app then previews it and, only on the
 * user's nod, delivers it (in-app DM or native share-sheet to WhatsApp/SMS/...).
 *
 * Guarantees mirrored from the notification spine:
 *  - NEVER auto-sends: the server only ever produces a durable DRAFT.
 *  - NEVER client-trusted: the subscription gate is checked server-side against
 *    admin-written entitlements/{uid}; the client cannot unlock it.
 *  - SAFE: requests that are harassing/abusive/hateful are refused, not drafted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RATE_LIMIT_MAX = exports.RATE_LIMIT_WINDOW_MS = exports.DRAFT_TTL_MS = exports.ASSISTANT_COLLECTIONS = void 0;
exports.ASSISTANT_COLLECTIONS = {
    drafts: 'assistantDrafts',
    usage: 'assistantUsage', // per-user rate-limit windows
    entitlements: 'entitlements',
};
exports.DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
// Cost-control rate limit (per user). Generous for a paying user, but bounded.
exports.RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
exports.RATE_LIMIT_MAX = 30; // composes per window
//# sourceMappingURL=types.js.map