/**
 * Stable ladder identity for For You cells.
 * Parent FlatList re-renders allocate a fresh fallbackUris array every time;
 * comparing by content avoids false URI resets (poster→video flash twice).
 */
export function buildLadderKey(uri, fallbackUris) {
  const primary = typeof uri === 'string' && uri.trim() ? uri.trim() : '';
  const extras = Array.isArray(fallbackUris)
    ? fallbackUris
        .filter((u) => typeof u === 'string' && u.trim())
        .map((u) => u.trim())
    : [];
  const parts = [];
  if (primary) parts.push(primary);
  for (const u of extras) {
    if (u && !parts.includes(u)) parts.push(u);
  }
  return parts.join('\0');
}

export function ladderFromKey(ladderKey) {
  if (!ladderKey) return [];
  return String(ladderKey).split('\0').filter(Boolean);
}
