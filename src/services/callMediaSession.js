/**
 * Call media warm-path (LiveKit mint / audio session prep).
 * Optional — callService soft-requires this; stub keeps Metro bundling green
 * until the full call-media session module lands.
 */

/**
 * @param {string} callId
 * @param {{ role?: string, mintPromise?: Promise<unknown> }} [opts]
 */
export async function prepareCallMedia(callId, opts = {}) {
  const { mintPromise } = opts;
  if (mintPromise && typeof mintPromise.then === 'function') {
    try {
      await mintPromise;
    } catch {
      // warm path is best-effort
    }
  }
  return { ok: true, callId: String(callId || ''), role: opts.role || null };
}

export default {
  prepareCallMedia,
};
