import { emitQualitySwitchEvent } from '../src/services/QualityAdaptationService';

// Mock analytics service with addEvent capture
class MockAnalyticsService {
  constructor() { this.events = []; }
  addEvent(e) { this.events.push(e); }
}

describe('emitQualitySwitchEvent', () => {
  test('emits upgrade event with correct payload', async () => {
    const mock = new MockAnalyticsService();
    await emitQualitySwitchEvent(Promise.resolve(mock), 'upgrade', 'stream123', '480p', '720p', 'healthy_wifi', 'expA');
    expect(mock.events.length).toBe(1);
    const evt = mock.events[0];
    expect(evt.type).toBe('quality_upgrade');
    expect(evt.from).toBe('480p');
    expect(evt.to).toBe('720p');
    expect(evt.reason).toBe('healthy_wifi');
    expect(evt.experimentId).toBe('expA');
  });

  test('emits downgrade event with correct payload', async () => {
    const mock = new MockAnalyticsService();
    await emitQualitySwitchEvent(Promise.resolve(mock), 'downgrade', 'stream123', '720p', '480p', 'low_buffer', 'expB');
    expect(mock.events.length).toBe(1);
    const evt = mock.events[0];
    expect(evt.type).toBe('quality_downgrade');
    expect(evt.from).toBe('720p');
    expect(evt.to).toBe('480p');
    expect(evt.reason).toBe('low_buffer');
    expect(evt.experimentId).toBe('expB');
  });
});
