"use strict";
/**
 * Account-deletion worker (P0.4 — GDPR/CCPA, Google Play data-deletion).
 *
 * The client records a request at `accountDeletions/{uid}`; this trigger
 * actions it: purge the user's posts + media, profile + subcollections,
 * authored activities, and (via the live-service internal endpoint) their
 * personal economy data in Postgres. Each step is best-effort and idempotent
 * so a retry (re-create / manual re-run) safely continues.
 *
 * Note: the Cognito identity is deleted by the live-service purge endpoint
 * (it holds the AWS credentials GCP Functions lack). If that step doesn't run
 * or fails, we record `cognitoDeletion: 'pending_external'` so the email
 * deletion flow (privacy@blyp.world / blyp.world/delete-account) completes it.
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
exports.processAccountDeletion = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
let _storage = null;
function getBucket() {
    if (!_storage) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Storage } = require('@google-cloud/storage');
        _storage = new Storage();
    }
    return _storage.bucket(admin.app().options.storageBucket || `${process.env.GCLOUD_PROJECT}.appspot.com`);
}
const STORAGE_FIELDS = ['mediaPath', 'videoPath', 'thumbnailPath', 'storagePath', 'photoPath'];
async function purgePosts(uid) {
    let deleted = 0;
    // Posts authored by this user (field is `userId` across the app).
    const snap = await db.collection('posts').where('userId', '==', uid).limit(500).get();
    const bucket = getBucket();
    for (const docSnap of snap.docs) {
        const data = docSnap.data() || {};
        // Best-effort: delete any storage object the post references by path.
        for (const f of STORAGE_FIELDS) {
            const p = data[f];
            if (p && typeof p === 'string' && !p.startsWith('http')) {
                try {
                    await bucket.file(p).delete({ ignoreNotFound: true });
                }
                catch ( /* ignore */_a) { /* ignore */ }
            }
        }
        try {
            await docSnap.ref.delete();
            deleted++;
        }
        catch ( /* ignore */_b) { /* ignore */ }
    }
    return deleted;
}
async function purgeStoragePrefixes(uid) {
    const bucket = getBucket();
    const prefixes = [`posts/${uid}/`, `avatars/${uid}/`, `profiles/${uid}/`, `uploads/${uid}/`, `media/${uid}/`];
    for (const prefix of prefixes) {
        try {
            await bucket.deleteFiles({ prefix, force: true });
        }
        catch ( /* ignore */_a) { /* ignore */ }
    }
}
async function purgeActivities(uid) {
    let deleted = 0;
    for (const field of ['actorId', 'targetUserId']) {
        try {
            const snap = await db.collection('activities').where(field, '==', uid).limit(500).get();
            for (const d of snap.docs) {
                try {
                    await d.ref.delete();
                    deleted++;
                }
                catch ( /* ignore */_a) { /* ignore */ }
            }
        }
        catch ( /* ignore (missing index etc.) */_b) { /* ignore (missing index etc.) */ }
    }
    return deleted;
}
async function purgeBackend(uid) {
    const base = String(process.env.LIVE_SERVICE_BASE_URL || '').replace(/\/+$/, '');
    const secret = String(process.env.INTERNAL_SHARED_SECRET || '').trim();
    if (!base || !secret) {
        console.error('[deletionWorker] backend purge SKIPPED: LIVE_SERVICE_BASE_URL / INTERNAL_SHARED_SECRET not set');
        return { ok: false };
    }
    try {
        const resp = await fetch(`${base}/internal/account/purge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
            body: JSON.stringify({ userId: uid }),
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            console.error('[deletionWorker] backend purge failed', resp.status, text.slice(0, 300));
            return { ok: false };
        }
        const data = await resp.json().catch(() => ({}));
        return { ok: true, deleted: data === null || data === void 0 ? void 0 : data.deleted, cognitoDeleted: Boolean(data === null || data === void 0 ? void 0 : data.cognitoDeleted) };
    }
    catch (e) {
        console.error('[deletionWorker] backend purge error', e === null || e === void 0 ? void 0 : e.message);
        return { ok: false };
    }
}
exports.processAccountDeletion = functions.firestore
    .document('accountDeletions/{uid}')
    .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const reqRef = snap.ref;
    console.log('[deletionWorker] starting purge for', uid);
    try {
        await reqRef.set({ status: 'processing', processingStartedAt: Date.now() }, { merge: true });
        const postsDeleted = await purgePosts(uid);
        await purgeStoragePrefixes(uid);
        const activitiesDeleted = await purgeActivities(uid);
        // Flag the profile as deleted BEFORE removing it, so any concurrent reader
        // sees a tombstone, then recursively delete the user doc + subcollections.
        try {
            await db.collection('users').doc(uid).set({ deleted: true, deletedAt: Date.now() }, { merge: true });
        }
        catch ( /* ignore */_a) { /* ignore */ }
        try {
            await db.recursiveDelete(db.collection('users').doc(uid));
        }
        catch ( /* ignore */_b) { /* ignore */ }
        try {
            await db.collection('userProfiles').doc(uid).delete();
        }
        catch ( /* ignore */_c) { /* ignore */ }
        const backend = await purgeBackend(uid);
        await reqRef.set({
            status: 'completed',
            completedAt: Date.now(),
            summary: {
                postsDeleted,
                activitiesDeleted,
                postgres: backend.ok ? backend.deleted || 'ok' : 'failed',
            },
            // The live-service deletes the Cognito identity (it holds AWS creds).
            // If that didn't run/succeed, fall back to the external email flow.
            cognitoDeletion: backend.cognitoDeleted ? 'deleted' : 'pending_external',
        }, { merge: true });
        console.log('[deletionWorker] purge complete for', uid, { postsDeleted, activitiesDeleted, backend: backend.ok, cognito: backend.cognitoDeleted });
    }
    catch (e) {
        console.error('[deletionWorker] purge failed for', uid, (e === null || e === void 0 ? void 0 : e.message) || e);
        try {
            await reqRef.set({ status: 'failed', failedAt: Date.now(), error: String((e === null || e === void 0 ? void 0 : e.message) || e).slice(0, 500) }, { merge: true });
        }
        catch ( /* ignore */_d) { /* ignore */ }
    }
});
//# sourceMappingURL=deletionWorker.js.map