// SegmentBandwidthEstimatorService
// Purpose: Provide lightweight rolling bandwidth estimation (kbps) based on sampled segment downloads.
// Non-breaking: Sampling occurs only when playlist viewer & variants enabled.
// Strategy: Attempt HEAD for content-length; if unavailable, perform ranged GET (first 12KB) and measure time.
// To limit overhead, sample at most one segment every SAMPLE_INTERVAL segments.

const SAMPLE_INTERVAL = 3; // sample every N segments to reduce overhead
const MAX_SAMPLES = 20; // rolling window size
const EWMA_ALPHA = 0.25; // weight of new sample in EWMA (tunable)

class SegmentBandwidthEstimatorService {
  constructor() {
    this.samples = []; // { kbps, timestamp }
    this.segmentCounter = 0;
    this.ewma = null; // exponential weighted moving average (kbps)
  }

  shouldSample() {
    return (this.segmentCounter++ % SAMPLE_INTERVAL) === 0;
  }

  async sample(url) {
    try {
      // Always perform a small ranged GET for a real throughput sample.
      const rangeBytes = 16384; // 16KB chunk for timing
      const start = Date.now();
      const resp = await fetch(url, { headers: { Range: `bytes=0-${rangeBytes - 1}` } });
      const buf = await resp.arrayBuffer();
      const bytes = buf.byteLength;
      const durationMs = Date.now() - start;
      if (durationMs <= 0 || bytes <= 0) return;
      const kbps = (bytes * 8) / (durationMs / 1000) / 1000; // bytes -> bits -> kbps
      this.record(kbps);
    } catch {}
  }

  record(kbps) {
    const ts = Date.now();
    this.samples.push({ kbps, timestamp: ts });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    // EWMA update
    if (this.ewma == null) {
      this.ewma = kbps;
    } else {
      this.ewma = (EWMA_ALPHA * kbps) + ((1 - EWMA_ALPHA) * this.ewma);
    }
  }

  getEstimatedBandwidthKbps() {
    if (this.samples.length === 0) return null;
    // Prefer EWMA for smoother decisions.
    return Math.round(this.ewma != null ? this.ewma : this.samples[this.samples.length - 1].kbps);
  }

  getStats() {
    const count = this.samples.length;
    const lastTs = count ? this.samples[count - 1].timestamp : null;
    const now = Date.now();
    let mean = null;
    let stddev = null;
    if (count > 0) {
      const vals = this.samples.map(s => s.kbps);
      const sum = vals.reduce((a, b) => a + b, 0);
      mean = sum / count;
      if (count > 1) {
        const sqSum = vals.reduce((a, b) => a + b * b, 0);
        const variance = Math.max(0, sqSum / count - mean * mean);
        stddev = Math.sqrt(variance);
      } else {
        stddev = 0;
      }
    }
    let coefficientOfVariation = null;
    if (mean && mean > 0 && typeof stddev === 'number') {
      coefficientOfVariation = stddev / mean; // raw ratio (not rounded)
    }
    // Confidence score: combines sample sufficiency, freshness, and volatility stability.
    // Range 0..1. Threshold for upgrade decisions ~0.6 (tunable).
    let confidenceScore = null;
    if (count > 0) {
      if (count < 3) {
        confidenceScore = 0;
      } else {
        let score = 0.4; // base once minimal sample count reached
        const ageMs = lastTs ? (now - lastTs) : null;
        if (ageMs != null) {
          if (ageMs <= 10000) score += 0.3; // fresh samples
          else if (ageMs <= 20000) score += 0.15; // slightly stale
        }
        if (coefficientOfVariation != null) {
          if (coefficientOfVariation < 0.3) score += 0.3; // stable
          else if (coefficientOfVariation < 0.5) score += 0.15; // moderately stable
        }
        confidenceScore = Math.min(1, parseFloat(score.toFixed(2)));
      }
    }
    return {
      count,
      lastSampleAgeMs: lastTs ? (now - lastTs) : null,
      ewmaKbps: this.ewma != null ? Math.round(this.ewma) : null,
      meanKbps: mean != null ? Math.round(mean) : null,
      stddevKbps: stddev != null ? Math.round(stddev) : null,
      coefficientOfVariation: coefficientOfVariation != null ? parseFloat(coefficientOfVariation.toFixed(3)) : null,
      confidenceScore,
    };
  }
}

export default new SegmentBandwidthEstimatorService();
