// Periodic live-frame safety sample hook. Thin overlay — does not touch media connect.
import { useEffect, useRef } from 'react';
import {
  scanLiveSample,
  shouldAutoKill,
  resolveScannerProvider,
} from '../services/safety/LiveSafetyScanner';

const DEFAULT_INTERVAL_MS = 45000;

/**
 * @param {object} opts
 * @param {boolean} opts.enabled - typically isHost && isLive
 * @param {string} [opts.streamId]
 * @param {string} [opts.hostUserId]
 * @param {number} [opts.intervalMs]
 * @param {(result: object) => void} [opts.onResult]
 * @param {(result: object) => void} [opts.onHighSeverity] - kill-path hook when provider says so
 */
export function useLiveSafetyScanner({
  enabled,
  streamId,
  hostUserId,
  intervalMs = DEFAULT_INTERVAL_MS,
  onResult,
  onHighSeverity,
} = {}) {
  const onResultRef = useRef(onResult);
  const onHighRef = useRef(onHighSeverity);
  onResultRef.current = onResult;
  onHighRef.current = onHighSeverity;

  useEffect(() => {
    if (!enabled || !streamId) return undefined;

    let cancelled = false;
    const provider = resolveScannerProvider();

    const tick = async () => {
      if (cancelled) return;
      try {
        const result = await scanLiveSample({
          streamId,
          hostUserId,
          sampleKind: 'frame',
          hint: provider === 'none' ? 'periodic_stub' : undefined,
        });
        if (cancelled) return;
        onResultRef.current?.(result);
        if (shouldAutoKill(result)) {
          onHighRef.current?.(result);
        }
      } catch (e) {
        console.warn('[useLiveSafetyScanner]', e?.message || String(e));
      }
    };

    // First sample after a short delay so go-live settles.
    const startTimer = setTimeout(tick, 8000);
    const interval = setInterval(tick, Math.max(15000, intervalMs));

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      clearInterval(interval);
    };
  }, [enabled, streamId, hostUserId, intervalMs]);
}

export default useLiveSafetyScanner;
