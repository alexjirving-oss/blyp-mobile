import * as admin from 'firebase-admin';

let _app: admin.app.App | null = null;

function initApp(): admin.app.App | null {
    if (admin.apps.length > 0) {
        return admin.app();
    }

    const projectId =
        process.env.FIREBASE_PROJECT_ID ||
        process.env.GCLOUD_PROJECT ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        'blyp-master';

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (serviceAccountJson) {
        try {
            const serviceAccount = JSON.parse(serviceAccountJson) as admin.ServiceAccount;
            return admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId,
            });
        } catch (e) {
            console.error('[FIREBASE_ADMIN] Failed to initialize from FIREBASE_SERVICE_ACCOUNT_JSON:', e);
            return null;
        }
    }

    // Cloud Run / GCP fallback when a JSON key secret is not mounted.
    try {
        return admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId,
        });
    } catch (e) {
        console.error('[FIREBASE_ADMIN] ADC initialize failed:', e);
        return null;
    }
}

function getApp(): admin.app.App | null {
    if (!_app) {
        _app = initApp();
    }
    return _app;
}

export function getAdminFirestore(): admin.firestore.Firestore | null {
    const app = getApp();
    if (!app) return null;
    try {
        return app.firestore();
    } catch {
        return null;
    }
}

export function getAdminAuth(): admin.auth.Auth | null {
    const app = getApp();
    if (!app) return null;
    try {
        return app.auth();
    } catch {
        return null;
    }
}
