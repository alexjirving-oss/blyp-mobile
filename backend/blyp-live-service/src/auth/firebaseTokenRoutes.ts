import { Router, Response } from 'express';
import { AuthedRequest, cognitoJwtMiddleware } from './cognitoJwtMiddleware';
import { isCanonicalCognitoSub } from './cognitoSub';
import { getAdminAuth } from '../config/firebaseAdmin';
import { logger } from '../config/logger';

const router = Router();

/**
 * Wave 1 federation: mint a Firebase custom token whose uid is the Cognito sub.
 * Clients sign in with this token so Firestore auth.uid == economy/live identity.
 */
router.post(
  '/auth/firebase-token',
  cognitoJwtMiddleware,
  async (req: AuthedRequest, res: Response) => {
    try {
      const sub = String(req.user?.sub || '').trim();
      if (!isCanonicalCognitoSub(sub)) {
        return res.status(401).json({
          error: 'UNAUTH',
          code: 'INVALID_SUB',
          detail: 'token subject is not a canonical Cognito sub',
        });
      }

      const adminAuth = getAdminAuth();
      if (!adminAuth) {
        logger.error('[auth] FIREBASE_SERVICE_ACCOUNT_JSON missing; cannot mint custom token');
        return res.status(503).json({
          error: 'FIREBASE_ADMIN_UNAVAILABLE',
          code: 'FIREBASE_ADMIN_UNAVAILABLE',
          detail: 'Set FIREBASE_SERVICE_ACCOUNT_JSON to enable Cognito→Firebase federation',
        });
      }

      const customToken = await adminAuth.createCustomToken(sub, {
        provider: 'cognito',
        cognito_sub: sub,
      });

      return res.json({
        ok: true,
        uid: sub,
        customToken,
        authMode: 'cognito-firebase-federation',
      });
    } catch (err: any) {
      logger.error(
        { err: err?.message || String(err) },
        '[auth] /auth/firebase-token failed',
      );
      return res.status(500).json({
        error: 'INTERNAL',
        code: 'INTERNAL',
        detail: err?.message || String(err),
      });
    }
  },
);

export default router;
