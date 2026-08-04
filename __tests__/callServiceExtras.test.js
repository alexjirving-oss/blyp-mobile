import { messengerExtrasService } from '../src/services/messaging/messengerExtrasService';

describe('messengerExtrasService call helpers', () => {
  test('exports call APIs', () => {
    expect(typeof messengerExtrasService.subscribeToCalls).toBe('function');
    expect(typeof messengerExtrasService.createCall).toBe('function');
    expect(typeof messengerExtrasService.updateCallStatus).toBe('function');
    expect(typeof messengerExtrasService.subscribeToIncomingCalls).toBe('function');
  });

  test('updateCallStatus rejects invalid status', async () => {
    await expect(
      messengerExtrasService.updateCallStatus({}, 'call-1', 'bogus'),
    ).rejects.toThrow(/Invalid call status/);
  });
});
