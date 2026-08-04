import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Centralized Admin SDK initialization.
 *
 * Why: multiple modules were calling admin.initializeApp() without a service account,
 * causing the Functions emulator to fall back to ADC/metadata (which fails locally)
 * and breaking mintFirebaseCustomToken.
 */
export function initFirebaseAdmin(): void {
  if (admin.apps.length) return;

  try {
    const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (jsonEnv && jsonEnv.trim().startsWith('{')) {
      const parsed = JSON.parse(jsonEnv);
      admin.initializeApp({ credential: admin.credential.cert(parsed as any) });
      console.log('[admin] initialized with FIREBASE_SERVICE_ACCOUNT_JSON');
      return;
    }

    const baseDirs = Array.from(
      new Set(
        [
          process.cwd(),
          path.resolve(process.cwd(), 'functions'),
          path.resolve(__dirname, '..'),
          path.resolve(__dirname, '..', '..'),
          path.resolve(__dirname, '..', '..', '..'),
        ].filter(Boolean)
      )
    );

    const filenames = ['serviceAccountKey.json', 'serviceAccount.json', 'firebase-service-account.json'];

    const candidatePaths = [
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
      ...baseDirs.flatMap((d) => filenames.map((f) => path.resolve(d, f))),
    ].filter(Boolean) as string[];

    for (const candidate of candidatePaths) {
      try {
        if (!candidate) continue;
        if (!fs.existsSync(candidate)) continue;
        const raw = fs.readFileSync(candidate, 'utf8');
        const parsed = JSON.parse(raw);
        admin.initializeApp({ credential: admin.credential.cert(parsed as any) });
        console.log('[admin] initialized with service account file', candidate);
        return;
      } catch {
        // Try next candidate
      }
    }
  } catch {
    // Fall through to default init
  }

  console.warn(
    '[admin][warn] no service account found; using default credentials (ADC). In local emulators this may fail when minting custom tokens.'
  );
  admin.initializeApp();
}

export { admin };
