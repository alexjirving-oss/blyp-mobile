import { InteractionManager, AppState } from 'react-native';

export async function waitForRuntimeReady() {
  // 1) Ensure RN interactions are set up
  await new Promise<void>(resolve => {
    InteractionManager.runAfterInteractions(() => resolve());
  });

  // 2) Optional: wait until app is 'active' (guards background launch)
  if (AppState.currentState !== 'active') {
    await new Promise<void>((resolve) => {
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') {
          // @ts-ignore RN < 0.65 returned subscription with remove()
          if (typeof (sub as any)?.remove === 'function') {
            // Newer RN returns subscription with remove method
            (sub as any).remove();
          } else {
            // No-op fallback for older RN
          }
          resolve();
        }
      });
    });
  }

  // 3) Final guard: WebSocket must exist
  if (typeof (global as any).WebSocket === 'undefined') {
    throw new Error('Runtime not ready: WebSocket still undefined');
  }
}
