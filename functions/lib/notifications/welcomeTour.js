"use strict";
/**
 * Welcome tour notification — seeded when a user first completes onboarding.
 *
 * Trigger: users/{uid} write where blyp.prefs.onboarded flips false→true.
 * Idempotent via dedupeKey welcome_tour:{uid}.
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
exports.onUserOnboardedWelcomeTour = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const outbox_1 = require("./outbox");
exports.onUserOnboardedWelcomeTour = functions.firestore
    .document('users/{uid}')
    .onWrite(async (change, context) => {
    var _a, _b, _c, _d, _e, _f;
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const uid = String(context.params.uid || '').trim();
    if (!uid)
        return null;
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    if (!after)
        return null;
    const wasOnboarded = !!((_b = (_a = before === null || before === void 0 ? void 0 : before.blyp) === null || _a === void 0 ? void 0 : _a.prefs) === null || _b === void 0 ? void 0 : _b.onboarded);
    const isOnboarded = !!((_d = (_c = after === null || after === void 0 ? void 0 : after.blyp) === null || _c === void 0 ? void 0 : _c.prefs) === null || _d === void 0 ? void 0 : _d.onboarded);
    if (!isOnboarded || wasOnboarded)
        return null;
    // Already finished the tour on another device — still seed inbox item only
    // if they haven't completed; skip if tourCompleted is already true.
    if ((_f = (_e = after === null || after === void 0 ? void 0 : after.blyp) === null || _e === void 0 ? void 0 : _e.prefs) === null || _f === void 0 ? void 0 : _f.tourCompleted)
        return null;
    try {
        await (0, outbox_1.enqueueNotification)({
            userId: uid,
            type: 'system',
            title: 'Welcome to Blyp',
            body: 'Take a quick tour of Home, Create, Live, Messages, and more.',
            dedupeKey: `welcome_tour:${uid}`,
            collapseKey: `welcome_tour:${uid}`,
            data: {
                type: 'tour',
                action: 'start',
            },
        });
    }
    catch (e) {
        console.warn('[welcomeTour] enqueue failed', uid, (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    return null;
});
//# sourceMappingURL=welcomeTour.js.map