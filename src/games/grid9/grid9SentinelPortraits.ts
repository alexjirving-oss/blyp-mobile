/**
 * Static gruesome-style sentinel portraits (local assets — not live cam).
 * Mapped by characterId from server sentinel templates.
 */
export const GRID9_SENTINEL_PORTRAITS: Record<string, number> = {
  ember: require('./assets/sentinels/ember.png'),
  nova: require('./assets/sentinels/nova.png'),
  vex: require('./assets/sentinels/vex.png'),
  echo: require('./assets/sentinels/echo.png'),
  onyx: require('./assets/sentinels/onyx.png'),
  pulse: require('./assets/sentinels/pulse.png'),
  rift: require('./assets/sentinels/rift.png'),
  aegis: require('./assets/sentinels/aegis.png'),
  flux: require('./assets/sentinels/flux.png'),
};

export function grid9SentinelPortrait(characterId?: string | null): number | null {
  if (!characterId) return null;
  return GRID9_SENTINEL_PORTRAITS[String(characterId)] ?? null;
}
