/**
 * Pure debit allocation for Tokens → coins Instant convert.
 * Mirrors gems convert: available-first, then pending.
 * Grid 9 victory credits only token_available; pending is latent/defense-in-depth.
 */
export function allocateTokenConvertDebit(
  available: number,
  pending: number,
  need: number,
):
  | { ok: true; fromAvailable: number; fromPending: number; convertible: number }
  | { ok: false; fromAvailable: 0; fromPending: 0; convertible: number } {
  const avail = Math.max(0, Math.floor(Number(available) || 0));
  const pend = Math.max(0, Math.floor(Number(pending) || 0));
  const want = Math.floor(Number(need) || 0);
  const convertible = avail + pend;
  if (!Number.isFinite(want) || want < 1 || convertible < want) {
    return { ok: false, fromAvailable: 0, fromPending: 0, convertible };
  }
  const fromAvailable = want <= avail ? want : avail;
  const fromPending = want - fromAvailable;
  return { ok: true, fromAvailable, fromPending, convertible };
}
