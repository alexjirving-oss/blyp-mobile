/**
 * Grid9Board dramatic roulette helper — unit-testable without RN.
 */
export function dramaticRouletteHighlightIndex(
  progress01: number,
  candidateCount: number,
  selectedOffset: number,
): number {
  const n = Math.max(1, candidateCount);
  const t = Math.max(0, Math.min(1, progress01));
  const revolutions = 4 + (1 - t) * (1 - t) * 6;
  const eased = 1 - Math.pow(1 - t, 2.6);
  const pos = revolutions * n * eased;
  const raw = t >= 0.999 ? selectedOffset : Math.floor(pos + selectedOffset) % n;
  return ((raw % n) + n) % n;
}
