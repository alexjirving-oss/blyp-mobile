import SegmentBandwidthEstimatorService from '../src/services/SegmentBandwidthEstimatorService';

describe('SegmentBandwidthEstimatorService', () => {
  beforeEach(() => {
    SegmentBandwidthEstimatorService.samples = [];
    SegmentBandwidthEstimatorService.segmentCounter = 0;
  });

  test('records and computes weighted average', () => {
    SegmentBandwidthEstimatorService.record(1000);
    SegmentBandwidthEstimatorService.record(500);
    const est = SegmentBandwidthEstimatorService.getEstimatedBandwidthKbps();
    expect(est).toBeGreaterThan(500);
    expect(est).toBeLessThanOrEqual(1000);
  });

  test('decays older samples weight', () => {
    const now = Date.now();
    SegmentBandwidthEstimatorService.samples = [
      { kbps: 2000, timestamp: now - 59000 }, // almost 59s old
      { kbps: 1000, timestamp: now },
    ];
    const est = SegmentBandwidthEstimatorService.getEstimatedBandwidthKbps();
    // Newer lower sample should pull average below 1500 due to decay
    expect(est).toBeLessThan(1500);
  });

  test('returns null when no samples', () => {
    expect(SegmentBandwidthEstimatorService.getEstimatedBandwidthKbps()).toBeNull();
  });

  test('EWMA smoothing trends toward recent samples', () => {
    SegmentBandwidthEstimatorService.record(4000); // initial high
    for (let i = 0; i < 5; i++) SegmentBandwidthEstimatorService.record(1000);
    const est = SegmentBandwidthEstimatorService.getEstimatedBandwidthKbps();
    // Should be above 1000 but below 4000 due to smoothing
    expect(est).toBeGreaterThan(1000);
    expect(est).toBeLessThan(4000);
  });

  test('stats include mean and stddev', () => {
    // Known values: mean=2000, stddev≈816.5 for [1000, 2000, 3000]
    SegmentBandwidthEstimatorService.samples = [];
    SegmentBandwidthEstimatorService.ewma = null;
    SegmentBandwidthEstimatorService.record(1000);
    SegmentBandwidthEstimatorService.record(2000);
    SegmentBandwidthEstimatorService.record(3000);
    const stats = SegmentBandwidthEstimatorService.getStats();
    expect(stats.count).toBe(3);
    expect(stats.meanKbps).toBeGreaterThanOrEqual(1990);
    expect(stats.meanKbps).toBeLessThanOrEqual(2010);
    expect(stats.stddevKbps).toBeGreaterThanOrEqual(800);
    expect(stats.stddevKbps).toBeLessThanOrEqual(830);
    expect(typeof stats.ewmaKbps === 'number' || stats.ewmaKbps === null).toBe(true);
    expect(stats.coefficientOfVariation).toBeGreaterThan(0.3);
    expect(stats.coefficientOfVariation).toBeLessThan(0.5);
    expect(stats.confidenceScore).toBeGreaterThanOrEqual(0); // score now computed
    expect(stats.confidenceScore).toBeLessThanOrEqual(1);
  });

  test('confidence score is 0 when insufficient samples', () => {
    SegmentBandwidthEstimatorService.samples = [];
    SegmentBandwidthEstimatorService.ewma = null;
    SegmentBandwidthEstimatorService.record(1500);
    const stats = SegmentBandwidthEstimatorService.getStats();
    expect(stats.count).toBe(1);
    expect(stats.confidenceScore).toBe(0);
  });
});
