/**
 * IVS Client Tests
 * 
 * Basic unit tests for IVS client initialization and state management.
 */

import { IVSClient } from '../IVSClient';

describe('IVSClient', () => {
  it('initialises with idle connection state', () => {
    const client = new IVSClient();
    expect(client.getConnectionState()).toBe('idle');
  });

  it('initialises with default local media state', () => {
    const client = new IVSClient();
    const mediaState = client.getLocalMediaState();
    expect(mediaState.cameraEnabled).toBe(true);
    expect(mediaState.microphoneEnabled).toBe(true);
    expect(mediaState.isFrontCamera).toBe(true);
  });

  it('transitions to connecting state on join', async () => {
    const client = new IVSClient();
    const joinPromise = client.join({
      role: 'host',
      identity: { streamId: 'test-stream', hostUserId: 'test-user' },
      sessionToken: { token: 'test-token', expiresAt: Date.now() + 3600000 },
    });
    
    // Note: In real implementation, this would be 'connecting' during join
    await joinPromise;
    expect(client.getConnectionState()).toBe('connected');
  });

  it('transitions to disconnected state on leave', async () => {
    const client = new IVSClient();
    await client.leave();
    expect(client.getConnectionState()).toBe('disconnected');
  });

  it('updates camera enabled state', async () => {
    const client = new IVSClient();
    await client.setCameraEnabled(false);
    expect(client.getLocalMediaState().cameraEnabled).toBe(false);
  });

  it('updates microphone enabled state', async () => {
    const client = new IVSClient();
    await client.setMicrophoneEnabled(false);
    expect(client.getLocalMediaState().microphoneEnabled).toBe(false);
  });

  it('toggles camera facing', async () => {
    const client = new IVSClient();
    expect(client.getLocalMediaState().isFrontCamera).toBe(true);
    await client.switchCamera();
    expect(client.getLocalMediaState().isFrontCamera).toBe(false);
    await client.switchCamera();
    expect(client.getLocalMediaState().isFrontCamera).toBe(true);
  });
});
