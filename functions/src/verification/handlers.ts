/**
 * Profile verification — Dating + run-a-team eligibility.
 *
 * POST /blypVerificationSubmit  (Bearer Firebase ID token)
 *   body: {
 *     method: 'identity' | 'external_auth',
 *     identity?: { legalFullName, dateOfBirth, addressLine1, addressLine2,
 *                  city, region, postalCode, country, idDocumentType, idDocumentLast4 },
 *     provider?: 'Google' | 'Apple' | 'Facebook' | ...,
 *     linkedProviders?: string[]
 *   }
 *   -> 200 { ok, verified, verificationStatus, verificationMethod }
 *
 * Writes users/{uid}.verified (Admin SDK only) + verificationRequests/{uid} audit doc.
 * Identity path: auto-verifies on complete self-attested KYC (18+).
 * External path: requires provider to appear in linkedProviders (Cognito identities).
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { applyCors } from '../http/cors';
import { checkRateLimit, RateLimitOptions } from '../platform/rateLimit';

initFirebaseAdmin();

const RATE: RateLimitOptions = { windowMs: 60_000, max: 8, failOpen: false };

const ID_TYPES = new Set(['passport', 'national_id', 'drivers_license']);
const EXTERNAL_PROVIDERS = new Set(['google', 'apple', 'facebook', 'tiktok']);

type IdentityBody = {
  legalFullName?: unknown;
  dateOfBirth?: unknown;
  addressLine1?: unknown;
  addressLine2?: unknown;
  city?: unknown;
  region?: unknown;
  postalCode?: unknown;
  country?: unknown;
  idDocumentType?: unknown;
  idDocumentLast4?: unknown;
};

function trimStr(v: unknown, max: number): string {
  return String(v ?? '')
    .trim()
    .slice(0, max);
}

function ageFromDob(dateOfBirth: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [y, m, d] = dateOfBirth.split('-').map((n) => Number(n));
  const dob = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

function parseIdentity(raw: IdentityBody | undefined) {
  const legalFullName = trimStr(raw?.legalFullName, 120);
  const dateOfBirth = trimStr(raw?.dateOfBirth, 32);
  const addressLine1 = trimStr(raw?.addressLine1, 160);
  const addressLine2 = trimStr(raw?.addressLine2, 160);
  const city = trimStr(raw?.city, 80);
  const region = trimStr(raw?.region, 80);
  const postalCode = trimStr(raw?.postalCode, 32);
  const country = trimStr(raw?.country, 80);
  const idDocumentType = trimStr(raw?.idDocumentType, 40);
  const idDocumentLast4 = trimStr(raw?.idDocumentLast4, 8).replace(/\s+/g, '');

  if (legalFullName.length < 2) return null;
  if (ageFromDob(dateOfBirth) == null || (ageFromDob(dateOfBirth) as number) < 18) return null;
  if (addressLine1.length < 3) return null;
  if (city.length < 2) return null;
  if (postalCode.length < 2) return null;
  if (country.length < 2) return null;
  if (!ID_TYPES.has(idDocumentType)) return null;
  if (!/^[A-Za-z0-9]{4}$/.test(idDocumentLast4)) return null;

  return {
    legalFullName,
    dateOfBirth,
    addressLine1,
    addressLine2,
    city,
    region,
    postalCode,
    country,
    idDocumentType,
    idDocumentLast4,
  };
}

function providerMatches(requested: string, linked: string[]): boolean {
  const want = requested.toLowerCase();
  return linked.some((p) => {
    const have = String(p || '').toLowerCase();
    return have === want || have.includes(want) || want.includes(have);
  });
}

async function requireAuth(req: functions.https.Request): Promise<string | null> {
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!idToken) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid || null;
  } catch {
    return null;
  }
}

export const blypVerificationSubmit = functions
  .runWith({ memory: '256MB', timeoutSeconds: 30 })
  .https.onRequest(async (req, res) => {
    applyCors(req, res, { methods: 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, reason: 'method' });
      return;
    }

    const uid = await requireAuth(req);
    if (!uid) {
      res.status(401).json({ ok: false, reason: 'unauthenticated' });
      return;
    }

    const rl = await checkRateLimit('verification_submit_' + uid, RATE);
    if (!rl.allowed) {
      res.set('Retry-After', String(rl.retryAfterSec || 60));
      res.status(429).json({ ok: false, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec });
      return;
    }

    const methodRaw = String(req.body?.method || '').trim();
    const method = methodRaw === 'external_auth' ? 'external_auth' : 'identity';
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const requestRef = db.collection('verificationRequests').doc(uid);
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
      const existing = await userRef.get();
      const existingData = existing.exists ? existing.data() || {} : {};
      if (existingData.verified === true || existingData.verificationStatus === 'verified') {
        res.status(200).json({
          ok: true,
          verified: true,
          verificationStatus: 'verified',
          verificationMethod: existingData.verificationMethod || null,
          alreadyVerified: true,
        });
        return;
      }

      if (method === 'identity') {
        const identity = parseIdentity(req.body?.identity);
        if (!identity) {
          res.status(400).json({
            ok: false,
            reason: 'incomplete_identity',
            message: 'Complete legal name, DOB (18+), address, and ID details.',
          });
          return;
        }

        await requestRef.set(
          {
            uid,
            method: 'identity',
            status: 'verified',
            identity,
            createdAt: existing.exists ? existingData.verificationSubmittedAt || now : now,
            updatedAt: now,
            verifiedAt: now,
          },
          { merge: true }
        );

        await userRef.set(
          {
            verified: true,
            isVerified: true,
            verificationStatus: 'verified',
            verificationMethod: 'identity',
            verificationSubmittedAt: now,
            verifiedAt: now,
            verificationRejectionReason: admin.firestore.FieldValue.delete(),
            updatedAt: now,
          },
          { merge: true }
        );

        res.status(200).json({
          ok: true,
          verified: true,
          verificationStatus: 'verified',
          verificationMethod: 'identity',
        });
        return;
      }

      // external_auth
      const provider = trimStr(req.body?.provider, 40);
      const linkedProviders = Array.isArray(req.body?.linkedProviders)
        ? req.body.linkedProviders.map((p: unknown) => trimStr(p, 40)).filter(Boolean).slice(0, 8)
        : [];

      if (!provider || !EXTERNAL_PROVIDERS.has(provider.toLowerCase())) {
        res.status(400).json({ ok: false, reason: 'invalid_provider' });
        return;
      }
      if (!providerMatches(provider, linkedProviders)) {
        res.status(403).json({
          ok: false,
          reason: 'provider_not_linked',
          message:
            'That provider is not linked on this session. Sign in with it, then retry — or submit identity info.',
        });
        return;
      }

      await requestRef.set(
        {
          uid,
          method: 'external_auth',
          status: 'verified',
          provider,
          linkedProviders,
          createdAt: now,
          updatedAt: now,
          verifiedAt: now,
        },
        { merge: true }
      );

      await userRef.set(
        {
          verified: true,
          isVerified: true,
          verificationStatus: 'verified',
          verificationMethod: 'external_auth',
          verificationLinkedProvider: provider,
          verificationSubmittedAt: now,
          verifiedAt: now,
          verificationRejectionReason: admin.firestore.FieldValue.delete(),
          updatedAt: now,
        },
        { merge: true }
      );

      res.status(200).json({
        ok: true,
        verified: true,
        verificationStatus: 'verified',
        verificationMethod: 'external_auth',
        provider,
      });
    } catch (e: any) {
      console.error('[blypVerificationSubmit]', e?.message || String(e));
      res.status(500).json({ ok: false, reason: 'server_error' });
    }
  });
