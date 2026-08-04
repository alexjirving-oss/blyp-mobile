"use strict";
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.admin = exports.initFirebaseAdmin = void 0;
const admin = __importStar(require("firebase-admin"));
exports.admin = admin;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Centralized Admin SDK initialization.
 *
 * Why: multiple modules were calling admin.initializeApp() without a service account,
 * causing the Functions emulator to fall back to ADC/metadata (which fails locally)
 * and breaking mintFirebaseCustomToken.
 */
function initFirebaseAdmin() {
    if (admin.apps.length)
        return;
    try {
        const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        if (jsonEnv && jsonEnv.trim().startsWith('{')) {
            const parsed = JSON.parse(jsonEnv);
            admin.initializeApp({ credential: admin.credential.cert(parsed) });
            console.log('[admin] initialized with FIREBASE_SERVICE_ACCOUNT_JSON');
            return;
        }
        const baseDirs = Array.from(new Set([
            process.cwd(),
            path.resolve(process.cwd(), 'functions'),
            path.resolve(__dirname, '..'),
            path.resolve(__dirname, '..', '..'),
            path.resolve(__dirname, '..', '..', '..'),
        ].filter(Boolean)));
        const filenames = ['serviceAccountKey.json', 'serviceAccount.json', 'firebase-service-account.json'];
        const candidatePaths = [
            process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
            process.env.GOOGLE_APPLICATION_CREDENTIALS,
            ...baseDirs.flatMap((d) => filenames.map((f) => path.resolve(d, f))),
        ].filter(Boolean);
        for (const candidate of candidatePaths) {
            try {
                if (!candidate)
                    continue;
                if (!fs.existsSync(candidate))
                    continue;
                const raw = fs.readFileSync(candidate, 'utf8');
                const parsed = JSON.parse(raw);
                admin.initializeApp({ credential: admin.credential.cert(parsed) });
                console.log('[admin] initialized with service account file', candidate);
                return;
            }
            catch (_a) {
                // Try next candidate
            }
        }
    }
    catch (_b) {
        // Fall through to default init
    }
    console.warn('[admin][warn] no service account found; using default credentials (ADC). In local emulators this may fail when minting custom tokens.');
    admin.initializeApp();
}
exports.initFirebaseAdmin = initFirebaseAdmin;
//# sourceMappingURL=firebaseAdmin.js.map