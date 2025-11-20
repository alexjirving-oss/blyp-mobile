import { decideNextQuality } from '../src/services/QualityAdaptationService';

describe('QualityAdaptationService.decideNextQuality', () => {
  const variants = [
    { name: '240p', bandwidth: 300000 },
    { name: '480p', bandwidth: 800000 },
    { name: '720p', bandwidth: 1500000 },
  ];

  test('downgrades on multiple stalls', () => {
    const metrics = { bufferSegments: 2, stallCountWindow: 3, networkType: 'wifi', timeSinceLastSegmentMs: 1000 };
    const res = decideNextQuality('480p', variants, metrics);
    expect(res).toBeTruthy();
    expect(res.target).toBe('240p');
    expect(res.reason).toBe('multiple_stalls');
  });

  test('upgrades on healthy wifi', () => {
    const metrics = { bufferSegments: 2, bufferSeconds: 7, stallCountWindow: 0, networkType: 'wifi', timeSinceLastSegmentMs: 1000, estimatedBandwidthKbps: 2000 };
    const res = decideNextQuality('480p', variants, metrics);
    expect(res).toBeTruthy();
    expect(res.target).toBe('720p');
    expect(res.reason).toBe('healthy_wifi');
  });

  test('no change when already highest on healthy wifi', () => {
    const metrics = { bufferSegments: 5, stallCountWindow: 0, networkType: 'wifi', timeSinceLastSegmentMs: 500 };
    const res = decideNextQuality('720p', variants, metrics);
    expect(res).toBeNull();
  });

  test('downgrades on low buffer', () => {
    const metrics = { bufferSegments: 2, bufferSeconds: 1.8, stallCountWindow: 0, networkType: 'cellular', timeSinceLastSegmentMs: 2000, estimatedBandwidthKbps: 500 };
    const res = decideNextQuality('720p', variants, metrics);
    expect(res).toBeTruthy();
    expect(res.target).toBe('480p');
    expect(res.reason).toBe('low_buffer');
  });

  test('cellular upgrade requires sufficient bufferSeconds', () => {
    const insufficient = decideNextQuality('240p', variants, { bufferSegments: 1, bufferSeconds: 3, stallCountWindow: 0, networkType: 'cellular', timeSinceLastSegmentMs: 500, estimatedBandwidthKbps: 400 });
    expect(insufficient).toBeNull();
    const sufficient = decideNextQuality('240p', variants, { bufferSegments: 1, bufferSeconds: 9, stallCountWindow: 0, networkType: 'cellular', timeSinceLastSegmentMs: 500, estimatedBandwidthKbps: 1200 });
    expect(sufficient).toBeTruthy();
    expect(sufficient.target).toBe('480p');
    expect(sufficient.reason).toBe('healthy_cellular');
  });

  test('wifi upgrade blocked by insufficient bandwidth', () => {
    const blocked = decideNextQuality('480p', variants, { bufferSegments: 5, bufferSeconds: 12, stallCountWindow: 0, networkType: 'wifi', timeSinceLastSegmentMs: 500, estimatedBandwidthKbps: 1000 });
    // Need ~1500000 bps *1.15 => 1725 kbps; we only have 1000 so null
    expect(blocked).toBeNull();
  });

  test('upgrade blocked by insufficient delta factor', () => {
    const closeVariants = [
      { name: '240p', bandwidth: 300000 },
      { name: '360p', bandwidth: 340000 }, // <15% delta from 240p (requires >=345000)
    ];
    const metrics = { bufferSegments: 5, bufferSeconds: 10, stallCountWindow: 0, networkType: 'wifi', timeSinceLastSegmentMs: 500, estimatedBandwidthKbps: 2000 };
    const res = decideNextQuality('240p', closeVariants, metrics);
    expect(res).toBeTruthy();
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('delta_blocked');
  });

  test('upgrade skipped due to low confidence when samples insufficient', () => {
    const metrics = { bufferSegments: 5, bufferSeconds: 10, stallCountWindow: 0, networkType: 'wifi', timeSinceLastSegmentMs: 500, estimatedBandwidthKbps: 2000, bwSampleCount: 1, bwLastSampleAgeMs: 5000 };
    const res = decideNextQuality('480p', variants, metrics);
    expect(res).toBeTruthy();
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('confidence_blocked');
  });

  test('upgrade skipped due to low confidence from stale samples despite sufficient count', () => {
    // Samples >=3 but very stale age; omit mean/stddev to avoid volatility bonus, leaving base 0.4 < threshold
    const metrics = { bufferSegments: 5, bufferSeconds: 10, stallCountWindow: 0, networkType: 'wifi', timeSinceLastSegmentMs: 500, estimatedBandwidthKbps: 2500, bwSampleCount: 4, bwLastSampleAgeMs: 30000 };
    const res = decideNextQuality('480p', variants, metrics);
    expect(res).toBeTruthy();
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('confidence_blocked');
  });

  test('upgrade skipped due to high volatility despite bandwidth', () => {
    const metrics = {
      bufferSegments: 5,
      bufferSeconds: 10,
      stallCountWindow: 0,
      networkType: 'wifi',
      timeSinceLastSegmentMs: 500,
      estimatedBandwidthKbps: 2500, // sufficient for 720p
      bwSampleCount: 5,
      bwLastSampleAgeMs: 3000,
      bwMeanKbps: 1200,
      bwStddevKbps: 800, // cv ~0.67 -> block
    };
    const res = decideNextQuality('480p', variants, metrics);
    expect(res).toBeTruthy();
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('volatility_blocked');
  });
});
