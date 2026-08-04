// broadcastService.js
//
// "How to watch" resolver.
//
// HARD RULE: never fabricate. Broadcast rights are region-specific and are NOT
// provided by the current free data tier (the event TV fields come back empty),
// so we ONLY surface a broadcaster when the data source actually gives us one.
// When it doesn't, we return available:false and the UI shows a clearly-marked
// "not available" state — we never guess or hard-code a plausible-looking channel.

/**
 * @param {object} opts
 * @param {string} [opts.tvStation] live TV/channel field from the event
 * @returns {{ label: string, available: boolean }}
 */
export function getHowToWatch({ tvStation } = {}) {
  const live = (tvStation || '').trim();
  if (live) {
    return { label: live, available: true };
  }
  return { label: 'Not available', available: false };
}

export default { getHowToWatch };
