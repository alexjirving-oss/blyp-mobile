// Centralized feature flags (client-side) with environment sourcing.
// Non-destructive: reads env injected via Expo (EXPO_PUBLIC_* variables).

export function isManifestEnabled() {
  return process.env.EXPO_PUBLIC_MANIFEST_ENABLED === '1';
}

export function isPlaylistViewerEnabled() {
  return process.env.EXPO_PUBLIC_PLAYLIST_VIEWER_ENABLED === '1';
}

export function getFeatureFlags() {
  return {
    manifestEnabled: isManifestEnabled(),
    playlistViewerEnabled: isPlaylistViewerEnabled(),
    playlistExperimentId: process.env.EXPO_PUBLIC_PLAYLIST_EXPERIMENT_ID || null,
  };
}
