/**
 * Call media warm-path (LiveKit mint / audio session prep).
 * Optional - callService soft-requires this; stub keeps Metro bundling green
 * until the full call-media session module lands.
 */

export async function prepareCallMedia(callId, opts) {
  opts = opts || {};
  var mintPromise = opts.mintPromise;
  if (mintPromise && typeof mintPromise.then === 'function') {
    try {
      await mintPromise;
    } catch (e) {
      // warm path is best-effort
    }
  }
  return { ok: true, callId: String(callId || ''), role: opts.role || null };
}

export default {
  prepareCallMedia: prepareCallMedia,
};