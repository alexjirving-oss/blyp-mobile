"use strict";
/**
 * Resolve a human-facing label for notification titles/bodies.
 * Skips Cognito-sub / UUID-shaped values that were historically stored as
 * username/displayName.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveUserLabel = resolveUserLabel;
exports.isUsablePublicLabel = isUsablePublicLabel;
const firebaseAdmin_1 = require("../firebaseAdmin");
function looksLikeRawId(value) {
    const t = String(value || '').trim();
    if (!t)
        return true;
    if (/\s/.test(t))
        return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
        return true;
    }
    if (t.length >= 20 && /[0-9]/.test(t) && /[a-f]/i.test(t) && /[-_]/.test(t)) {
        return true;
    }
    return false;
}
function clean(value) {
    const t = String(value || '').trim();
    if (!t)
        return '';
    return t.startsWith('@') ? t.slice(1).trim() : t;
}
function pickFromDoc(d, uid) {
    const ordered = [d === null || d === void 0 ? void 0 : d.username, d === null || d === void 0 ? void 0 : d.handle, d === null || d === void 0 ? void 0 : d.preferredUsername, d === null || d === void 0 ? void 0 : d.displayName, d === null || d === void 0 ? void 0 : d.name];
    for (const raw of ordered) {
        const t = clean(raw);
        if (!t)
            continue;
        if (uid && t === uid)
            continue;
        if (looksLikeRawId(t))
            continue;
        if (/^user_/i.test(t))
            continue;
        return t;
    }
    return '';
}
/** Prefer username/handle, then displayName. Never returns the raw uid. */
async function resolveUserLabel(uid, fallback = 'Someone') {
    const id = String(uid || '').trim();
    const safeFallback = isUsablePublicLabel(fallback) ? clean(fallback) : 'Someone';
    if (!id)
        return safeFallback;
    const db = firebaseAdmin_1.admin.firestore();
    try {
        const u = await db.collection('users').doc(id).get();
        const fromUsers = pickFromDoc(u.data() || {}, id);
        if (fromUsers)
            return fromUsers;
    }
    catch (_a) {
        // fall through
    }
    try {
        const p = await db.collection('userProfiles').doc(id).get();
        const fromProfiles = pickFromDoc(p.data() || {}, id);
        if (fromProfiles)
            return fromProfiles;
    }
    catch (_b) {
        // fall through
    }
    return safeFallback;
}
function isUsablePublicLabel(value, uid) {
    const t = clean(value);
    if (!t)
        return false;
    if (uid && t === String(uid))
        return false;
    if (looksLikeRawId(t))
        return false;
    if (/^user_/i.test(t))
        return false;
    return true;
}
//# sourceMappingURL=resolveUserLabel.js.map