import * as admin from 'firebase-admin';

let _app: admin.app.App | null = null;

function initApp(): admin.app.App | null {
    if (admin.apps.length > 0) {
        return admin.app();
    }
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
        return null;
    }
    try {
        const serviceAccount = JSON.parse(serviceAccountJson) as admin.ServiceAccount;
        return admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
        console.error('[FIREBASE_ADMIN] Failed to initialize:', e);
        return null;
    }
}

export function getAdminFirestore(): admin.firestore.Firestore | null {
    if (!_app) {
        _app = initApp();
    }
    if (!_app) return null;
    try {
        return _app.firestore();
    } catch {
        return null;
    }
}

export function getAdminAuth(): admin.auth.Auth | null {
    if (!_app) {
        _app = initApp();
    }
    if (!_app) return null;
    try {
        return _app.auth();
    } catch {
        return null;
    }
}

export async function verifyFirebaseIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    const auth = getAdminAuth();
    if (!auth) {
        throw new Error('[config] FIREBASE_SERVICE_ACCOUNT_JSON is required for legacy identity linking');
    }
    return auth.verifyIdToken(idToken, true);
}
