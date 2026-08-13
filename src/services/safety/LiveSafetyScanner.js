// LiveSafetyScanner — real-time vision/audio safety pipeline for live frames.
 //
 // When provider keys exist (Rekognition / Google Vision / Hive), samples call
 // the configured API. Without keys, the pipeline still runs: heuristic stub
 // returns pending_review with providerNeeded=true (never pretends we scanned).
 // High-severity results can auto-flag for kill-path consumers.

import { db, firebaseEnabled } from '../../config/firebase';
import { appendSafetyAudit } from './SafetyAuditLog';

export const SCANNER_PROVIDERS = {
  none: 'none',
  aws_rekognition: 'aws_rekognition',
  google_vision: 'google_vision',
  hive: 'hive',
};

/**
 * Resolve which provider is configured from Expo public env.
 * Keys themselves live server-side; client only knows which provider to hit.
 */
export function resolveScannerProvider() {
  const named = String(process.env.EXPO_PUBLIC_LIVE_SAFETY_PROVIDER || '').trim().toLowerCase();
  if (named && SCANNER_PROVIDERS[named]) return named;

  if (process.env.EXPO_PUBLIC_AWS_REKOGNITION_ENABLED === '1') {
    return SCANNER_PROVIDERS.aws_rekognition;
  }
  if (process.env.EXPO_PUBLIC_GOOGLE_VISION_ENABLED === '1') {
    return SCANNER_PROVIDERS.google_vision;
  }
  if (process.env.EXPO_PUBLIC_HIVE_MODERATION_ENABLED === '1') {
    return SCANNER_PROVIDERS.hive;
  }
  return SCANNER_PROVIDERS.none;
}

/**
 * @typedef {object} SafetyScanResult
 * @property {'clear'|'pending_review'|'flagged'|'high_severity'} severity
 * @property {string} provider
 * @property {boolean} providerNeeded
 * @property {string[]} categories
 * @property {number} confidence 0..1
 * @property {string} [detail]
 * @property {boolean} [canAutoKill]
 */

/**
 * Heuristic stub — used when no provider keys. Does NOT claim a real scan.
 * @param {{ streamId?: string, sampleKind?: 'frame'|'audio', hint?: string }} input
 * @returns {Promise<SafetyScanResult>}
 */
async function heuristicStubScan(input = {}) {
  const hint = String(input.hint || '').toLowerCase();
  // Extremely narrow client-side heuristic for obvious text overlays only.
  if (/\b(csam|child\s*porn|rape\s*live)\b/i.test(hint)) {
    return {
      severity: 'high_severity',
      provider: SCANNER_PROVIDERS.none,
      providerNeeded: true,
      categories: ['child_safety_heuristic'],
      confidence: 0.55,
      detail: 'Heuristic text hint only — needs vision provider key for confirmation',
      canAutoKill: false,
    };
  }
  return {
    severity: 'pending_review',
    provider: SCANNER_PROVIDERS.none,
    providerNeeded: true,
    categories: [],
    confidence: 0,
    detail: 'needs provider key (AWS Rekognition / Google Vision / Hive)',
    canAutoKill: false,
  };
}

/**
 * Call backend moderation sample endpoint when a provider is configured.
 * Backend is responsible for holding API secrets.
 */
async function callProviderApi(provider, input) {
  const base = String(process.env.EXPO_PUBLIC_LIVE_API_BASE || process.env.EXPO_PUBLIC_API_BASE || '').replace(/\/$/, '');
  if (!base) {
    return heuristicStubScan(input);
  }
  try {
    const res = await fetch(`${base}/internal/live-safety/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        streamId: input.streamId || null,
        sampleKind: input.sampleKind || 'frame',
        // Frame bytes should be uploaded separately; this hook sends metadata.
        sampleRef: input.sampleRef || null,
        hint: input.hint || null,
      }),
    });
    if (!res.ok) {
      return {
        ...(await heuristicStubScan(input)),
        detail: `provider HTTP ${res.status} — fell back to stub`,
      };
    }
    const json = await res.json();
    return {
      severity: json.severity || 'pending_review',
      provider,
      providerNeeded: false,
      categories: Array.isArray(json.categories) ? json.categories : [],
      confidence: Number(json.confidence) || 0,
      detail: json.detail || null,
      canAutoKill: !!json.canAutoKill || json.severity === 'high_severity',
    };
  } catch (e) {
    return {
      ...(await heuristicStubScan(input)),
      detail: `provider call failed: ${e?.message || String(e)}`,
    };
  }
}

/**
 * Scan one live sample. Always returns a structured result.
 * @param {{ streamId?: string, sampleKind?: 'frame'|'audio', sampleRef?: string, hint?: string, hostUserId?: string }} input
 * @returns {Promise<SafetyScanResult>}
 */
export async function scanLiveSample(input = {}) {
  const provider = resolveScannerProvider();
  const result =
    provider === SCANNER_PROVIDERS.none
      ? await heuristicStubScan(input)
      : await callProviderApi(provider, input);

  if (result.severity === 'flagged' || result.severity === 'high_severity') {
    await flagLiveForReview({
      streamId: input.streamId,
      hostUserId: input.hostUserId,
      result,
    });
  }

  return result;
}

/**
 * Persist a pending_review / flagged mark on the live stream + audit log.
 */
export async function flagLiveForReview({ streamId, hostUserId, result }) {
  if (!streamId) return;
  const payload = {
    status: result?.severity === 'high_severity' ? 'high_severity' : 'pending_review',
    provider: result?.provider || SCANNER_PROVIDERS.none,
    providerNeeded: !!result?.providerNeeded,
    categories: result?.categories || [],
    confidence: result?.confidence || 0,
    detail: result?.detail || null,
    updatedAt: Date.now(),
  };

  if (firebaseEnabled && db?.collection) {
    try {
      await db.collection('liveStreams').doc(String(streamId)).set(
        { safetyScan: payload },
        { merge: true },
      );
      await db.collection('moderationFlags').add({
        targetType: 'stream',
        targetId: String(streamId),
        hostUserId: hostUserId || null,
        source: 'live_safety_scanner',
        ...payload,
        createdAt: Date.now(),
      });
    } catch (e) {
      console.warn('[LiveSafetyScanner] flag write failed', e?.message || String(e));
    }
  }

  await appendSafetyAudit({
    action: 'live_scan_flag',
    targetType: 'stream',
    targetId: String(streamId),
    metadata: {
      severity: payload.status,
      provider: payload.provider,
      providerNeeded: payload.providerNeeded,
      categories: payload.categories,
    },
  });
}

/**
 * Whether a scan result should trigger an automated kill attempt.
 * Stub/heuristic never auto-kills without a real provider.
 */
export function shouldAutoKill(result) {
  return !!(result && result.canAutoKill && result.severity === 'high_severity' && !result.providerNeeded);
}

export default {
  SCANNER_PROVIDERS,
  resolveScannerProvider,
  scanLiveSample,
  flagLiveForReview,
  shouldAutoKill,
};
