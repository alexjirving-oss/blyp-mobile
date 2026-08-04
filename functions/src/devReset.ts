/**
 * DEV-ONLY Firestore Reset Function
 * 
 * DANGER: This function deletes ALL documents from specified collections.
 * 
 * Safety Features:
 * - Hard-blocks in production environment
 * - Requires secret header x-admin-reset-key matching ADMIN_DEV_RESET_KEY env var
 * - Uses safe batching to avoid Firestore limits
 * - Comprehensive logging for audit trail
 * 
 * Collections Wiped:
 * - users
 * - userProfiles
 * - posts
 * - liveStreams
 * 
 * Usage:
 * curl -X POST \
 *   -H "x-admin-reset-key: your-secret-key" \
 *   "https://<region>-<project>.cloudfunctions.net/devResetFirestore"
 */

import * as functions from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';

export const devResetFirestore = functions
  .runWith({ 
    timeoutSeconds: 540,  // 9 minutes for large datasets
    memory: '1GB' 
  })
  .https.onRequest(async (req, res) => {
    // Detect environment
    const env = 
      process.env.BLYP_ENV || 
      process.env.NODE_ENV || 
      (process.env.FUNCTIONS_EMULATOR ? 'emulator' : 'unknown');

    console.log('[DEV_RESET][START]', { 
      env,
      timestamp: new Date().toISOString(),
      method: req.method 
    });

    // CRITICAL: Hard block in production
    if (env === 'production' || env === 'prod') {
      console.error('[DEV_RESET][BLOCKED] Refused in production environment', { env });
      res.status(403).json({
        ok: false,
        error: 'devResetFirestore is disabled in production',
        env,
      });
      return;
    }

    // Verify admin reset key (sourced from functions/.env; functions.config() is deprecated)
    const expectedKey = process.env.ADMIN_DEV_RESET_KEY;
    const providedKey = req.headers['x-admin-reset-key'];

    if (!expectedKey) {
      console.error('[DEV_RESET][CONFIG_ERROR] ADMIN_DEV_RESET_KEY not set');
      res.status(500).json({ 
        ok: false, 
        error: 'Server configuration error: ADMIN_DEV_RESET_KEY not set' 
      });
      return;
    }

    if (!providedKey || providedKey !== expectedKey) {
      console.warn('[DEV_RESET][AUTH_FAIL] Invalid or missing admin key', {
        hasExpected: !!expectedKey,
        hasProvided: !!providedKey,
        keysMatch: providedKey === expectedKey,
      });
      res.status(403).json({ ok: false, error: 'Forbidden: Invalid admin key' });
      return;
    }

    console.log('[DEV_RESET][AUTH_OK] Admin key verified');

    const db = getFirestore();
    const collectionsToWipe = [
      'users',
      'userProfiles', 
      'posts',
      'liveStreams',
    ];

    const results: Record<string, { deleted: number; batches: number }> = {};
    const startTime = Date.now();

    try {
      for (const collectionName of collectionsToWipe) {
        let totalDeleted = 0;
        let batchCount = 0;

        console.log(`[DEV_RESET][COLLECTION_START] ${collectionName}`);

        // Delete in batches to avoid Firestore 500-operation limit
        while (true) {
          // Fetch up to 400 docs (leaving room for batch overhead)
          const snapshot = await db.collection(collectionName).limit(400).get();
          
          if (snapshot.empty) {
            console.log(`[DEV_RESET][COLLECTION_EMPTY] ${collectionName} - no more docs`);
            break;
          }

          // Create batch and queue deletes
          const batch = db.batch();
          snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
          });

          // Commit batch
          await batch.commit();

          totalDeleted += snapshot.size;
          batchCount++;

          console.log(`[DEV_RESET][BATCH_COMPLETE] ${collectionName}`, {
            batchSize: snapshot.size,
            totalDeleted,
            batchNumber: batchCount,
          });

          // Small delay to avoid overwhelming Firestore
          if (snapshot.size === 400) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        results[collectionName] = { 
          deleted: totalDeleted,
          batches: batchCount,
        };

        console.log(`[DEV_RESET][COLLECTION_COMPLETE] ${collectionName}`, {
          deleted: totalDeleted,
          batches: batchCount,
        });
      }

      const duration = Date.now() - startTime;

      console.log('[DEV_RESET][SUCCESS] Reset completed', { 
        results,
        durationMs: duration,
        durationSec: (duration / 1000).toFixed(2),
      });

      res.json({ 
        ok: true, 
        results,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      });

    } catch (err) {
      const duration = Date.now() - startTime;
      console.error('[DEV_RESET][ERROR] Reset failed', { 
        err, 
        results,
        durationMs: duration,
      });

      res.status(500).json({ 
        ok: false, 
        error: 'Reset failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        partialResults: results,
      });
    }
  });
