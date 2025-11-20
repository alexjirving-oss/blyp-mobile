// QualityAdaptationService
// Incremental heuristic-based adaptive bitrate controller.
// Non-breaking: operates only when multiple variants & playlist viewer enabled.
// Metrics input is lightweight until deeper telemetry exists.
// Future: replace with throughput/buffer-based ABR algorithm.

/**
 * decideNextQuality determines if we should switch quality variant.
 * @param {string} current - current quality label (e.g., '480p').
 * @param {Array<{name:string, bandwidth?:number}>} variants - available quality variants.
 * @param {Object} metrics - adaptation metrics snapshot.
 * @param {number} metrics.bufferSegments - count of buffered segments ahead.
 * @param {number} metrics.bufferSeconds - summed duration of buffered segments ahead.
 * @param {number} metrics.stallCountWindow - stalls observed in recent window.
 * @param {string} metrics.networkType - NetInfo type ('wifi','cellular','unknown','none').
 * @param {number} metrics.timeSinceLastSegmentMs - ms since last segment appended.
 * @param {number} [metrics.estimatedBandwidthKbps] - naive estimated throughput (kbps).
 * @returns {{target:string, reason:string}|null} recommendation or null if no change.
 */
const MIN_DELTA_FACTOR = 1.15; // require next variant bandwidth to exceed current by 15%

export function decideNextQuality(current, variants, metrics) {
  if (!variants || variants.length < 2) return null;
  const ordered = orderVariants(variants);
  const currentIndex = ordered.findIndex(v => v.name === current);
  if (currentIndex === -1) return null;

  const { bufferSegments, stallCountWindow, networkType, timeSinceLastSegmentMs, bufferSeconds, estimatedBandwidthKbps, bwSampleCount, bwLastSampleAgeMs, bwMeanKbps, bwStddevKbps } = metrics;

  // Downgrade conditions.
  if (stallCountWindow >= 2) {
    if (currentIndex > 0) {
      return { target: ordered[currentIndex - 1].name, reason: 'multiple_stalls' };
    }
    return null;
  }
  if ((bufferSegments < 1 || (bufferSeconds !== undefined && bufferSeconds < 2.5)) && currentIndex > 0) {
    return { target: ordered[currentIndex - 1].name, reason: 'low_buffer' };
  }
  if (timeSinceLastSegmentMs > 8000 && currentIndex > 0) {
    return { target: ordered[currentIndex - 1].name, reason: 'segment_latency' };
  }

  // Upgrade conditions (bandwidth gating if available).
  const nextVariant = ordered[currentIndex + 1];
  if (nextVariant) {
    const currentVariant = ordered[currentIndex];
    const deltaOk = currentVariant.bandwidth && nextVariant.bandwidth
      ? nextVariant.bandwidth >= currentVariant.bandwidth * MIN_DELTA_FACTOR
      : true;
    const requireBandwidth = nextVariant.bandwidth ? (nextVariant.bandwidth / 1000) * 1.15 : null; // safety factor 15%
    const bandwidthOk = requireBandwidth ? estimatedBandwidthKbps && estimatedBandwidthKbps >= requireBandwidth : true;
    const confidenceProvided = typeof bwSampleCount === 'number' || typeof bwLastSampleAgeMs === 'number';
    // Compute confidence score locally (mirrors estimator service logic) if sample meta present.
    let confidenceScore = null;
    if (confidenceProvided && (bwSampleCount || 0) > 0) {
      if ((bwSampleCount || 0) < 3) {
        confidenceScore = 0;
      } else {
        let base = 0.4;
        if (bwLastSampleAgeMs != null) {
          if (bwLastSampleAgeMs <= 10000) base += 0.3; else if (bwLastSampleAgeMs <= 20000) base += 0.15;
        }
        if (typeof bwMeanKbps === 'number' && typeof bwStddevKbps === 'number' && bwMeanKbps > 0) {
          const cv = bwStddevKbps / bwMeanKbps;
          if (cv < 0.3) base += 0.3; else if (cv < 0.5) base += 0.15;
          // volatility blocked check below still applies with cv >= 0.5
        }
        confidenceScore = Math.min(1, parseFloat(base.toFixed(2)));
      }
    }
    const confidenceOk = confidenceProvided ? (confidenceScore == null || confidenceScore >= 0.6) : true;
    const wifiCond = networkType === 'wifi' && stallCountWindow === 0 && bandwidthOk && (bufferSegments >= 3 || (bufferSeconds !== undefined && bufferSeconds >= 6));
    const cellCond = networkType === 'cellular' && stallCountWindow === 0 && bandwidthOk && (bufferSegments >= 4 || (bufferSeconds !== undefined && bufferSeconds >= 8)) && currentIndex < ordered.length - 2;
    // Volatility gating: if estimator shows high variance, skip upgrades despite otherwise healthy conditions
    let volatilityBlocked = false;
    if ((wifiCond || cellCond) && deltaOk && confidenceProvided) {
      if ((bwSampleCount || 0) >= 3 && (bwLastSampleAgeMs == null || bwLastSampleAgeMs <= 20000) && typeof bwMeanKbps === 'number' && typeof bwStddevKbps === 'number' && bwMeanKbps > 0) {
        const ratio = bwStddevKbps / bwMeanKbps; // coefficient of variation
        if (ratio >= 0.5) { // threshold tuned conservatively
          volatilityBlocked = true;
        }
      }
    }
    if (wifiCond && deltaOk && confidenceOk && !volatilityBlocked) {
      return { target: nextVariant.name, reason: bandwidthOk ? 'healthy_wifi' : 'healthy_wifi_no_bw' };
    }
    if (cellCond && deltaOk && confidenceOk && !volatilityBlocked) {
      return { target: nextVariant.name, reason: bandwidthOk ? 'healthy_cellular' : 'healthy_cellular_no_bw' };
    }
    // Delta blocked upgrade scenario: conditions for upgrade met except deltaOk.
    if ((wifiCond || cellCond) && !deltaOk) {
      return { target: nextVariant.name, reason: 'delta_blocked', skipped: true };
    }
    // Confidence blocked upgrade scenario: conditions met but insufficient samples or stale.
    if ((wifiCond || cellCond) && deltaOk && !confidenceOk) {
      return { target: nextVariant.name, reason: 'confidence_blocked', skipped: true };
    }
    // Volatility blocked upgrade scenario: conditions met but estimator variance too high.
    if ((wifiCond || cellCond) && deltaOk && confidenceOk && volatilityBlocked) {
      return { target: nextVariant.name, reason: 'volatility_blocked', skipped: true };
    }
  }
  return null;
}

function orderVariants(variants) {
  // Attempt to sort by numeric resolution extracted from name (e.g., '720p'). Fallback to original.
  const withMetric = variants.map(v => {
    const match = /([0-9]{3,4})p/.exec(v.name);
    return { ...v, _res: match ? parseInt(match[1], 10) : 0 };
  });
  withMetric.sort((a, b) => a._res - b._res);
  return withMetric;
}

/**
 * slidingWindowCounter creates a counter with time-based window resets.
 */
export function createSlidingWindowCounter(windowMs) {
  let timestamps = [];
  return {
    incr() {
      const now = Date.now();
      timestamps.push(now);
      timestamps = timestamps.filter(t => now - t <= windowMs);
    },
    count() {
      const now = Date.now();
      timestamps = timestamps.filter(t => now - t <= windowMs);
      return timestamps.length;
    }
  };
}

/**
 * emitQualitySwitchEvent: centralized analytics emission for quality changes (testable isolation).
 */
export async function emitQualitySwitchEvent(analyticsServicePromise, direction, streamId, fromQuality, toQuality, reason, experimentId) {
  try {
    const EnterpriseAnalyticsService = await analyticsServicePromise;
    EnterpriseAnalyticsService.addEvent({
      type: direction === 'upgrade' ? 'quality_upgrade' : 'quality_downgrade',
      streamId,
      from: fromQuality,
      to: toQuality,
      reason,
      experimentId,
      timestamp: Date.now(),
    });
  } catch (e) {
    // Swallow to avoid user-impacting crashes; error analytics could be added here.
  }
}
