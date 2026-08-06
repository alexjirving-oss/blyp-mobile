/**
 * Pure helpers for the For You / MediaViewer on-video comment marquee.
 * Kept separate so loop/dedupe behavior can be unit-tested without RN.
 */

/** Max comments pulled into the marquee cycle. */
export const LOOP_CAP = 24;
/** Visible comment slots (~3–4 high). */
export const VISIBLE_ROWS = 4;
/** Approx row height incl. margin. */
export const ROW_ESTIMATE = 48;

/**
 * Deduplicate by id (first wins). Drops empty text.
 * @param {Array<{id?: string, text?: string}>} comments
 */
export function dedupeCommentsById(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const c of comments) {
    const id = String(c?.id || '').trim();
    const text = String(c?.text || '').trim();
    if (!id || !text) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...c, id, text });
  }
  return out;
}

/**
 * Chronological for the rise (oldest first → newest); cap for perf.
 * Input is expected newest-first (Firestore orderBy desc).
 */
export function buildLoopItems(comments, loopCap = LOOP_CAP) {
  const unique = dedupeCommentsById(comments);
  if (unique.length === 0) return [];
  return unique.slice(0, loopCap).slice().reverse();
}

/**
 * Only marquee-loop when there is enough content that the clone sits at or
 * below the clip edge at translateY=0. Otherwise cloning puts two copies of
 * the same comment on screen at once (the 1-comment duplicate bug).
 */
export function shouldMarqueeLoop(itemCount, cycleHeight, viewportHeight) {
  const n = Number(itemCount) || 0;
  const cycle = Number(cycleHeight) || 0;
  const view = Number(viewportHeight) || 0;
  return n >= 2 && view > 0 && cycle >= view;
}

/**
 * Build the list rendered inside the animated column.
 * When not looping: one instance each.
 * When looping: duplicate once for seamless wrap (clone starts off-screen).
 *
 * @returns {Array<{ item: object, key: string }>}
 */
export function buildMarqueeRenderItems(loopItems, looping) {
  if (!Array.isArray(loopItems) || loopItems.length === 0) return [];
  if (!looping) {
    return loopItems.map((item, index) => ({
      item,
      key: `${item.id}-static-${index}`,
    }));
  }
  return [...loopItems, ...loopItems].map((item, index) => ({
    item,
    key: `${item.id}-${index}`,
  }));
}

/**
 * Drop an optimistic comment once a server comment matches (same user + text + parent).
 */
export function reconcileOptimisticComments(serverComments, previousComments) {
  const server = Array.isArray(serverComments) ? serverComments : [];
  const prev = Array.isArray(previousComments) ? previousComments : [];
  const pending = prev.filter((c) => c?._optimistic);

  const stillPending = pending.filter((p) => {
    const pUser = String(p?.userId || '').trim();
    const pText = String(p?.text || '').trim();
    const pParent = String(p?.parentId || '').trim() || null;
    if (!pText) return false;
    return !server.some((s) => {
      if (String(s?.text || '').trim() !== pText) return false;
      if (pUser && String(s?.userId || '').trim() !== pUser) return false;
      const sParent = String(s?.parentId || '').trim() || null;
      return sParent === pParent;
    });
  });

  const seen = new Set();
  const out = [];
  for (const c of [...stillPending, ...server]) {
    const id = String(c?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(c);
  }
  return out;
}
