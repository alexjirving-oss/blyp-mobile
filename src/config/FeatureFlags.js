import { platformApi } from '../services/platformApiClient';

const SERVER_KEYS = Object.freeze({
  manifestEnabled: 'live.manifest',
  playlistViewerEnabled: 'live.playlist_viewer',
  playlistExperimentId: 'live.playlist_experiment',
});

const listeners = new Set();
let state = Object.freeze({
  loaded: false,
  manifestEnabled: false,
  playlistViewerEnabled: false,
  playlistExperimentId: null,
});

function notify() {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {}
  }
}

function enabled(flags, key) {
  return flags?.[key]?.enabled === true;
}

export function isManifestEnabled() {
  return state.manifestEnabled === true;
}

export function isPlaylistViewerEnabled() {
  return state.playlistViewerEnabled === true;
}

export function getFeatureFlags() {
  return state;
}

export function subscribeFeatureFlags(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function refreshFeatureFlags() {
  const keys = Object.values(SERVER_KEYS).join(',');
  try {
    const response = await platformApi.get(
      `/api/v1/platform/feature-flags?keys=${encodeURIComponent(keys)}`,
      { retries: 1 }
    );
    const flags = response.data?.flags || {};
    state = Object.freeze({
      loaded: true,
      manifestEnabled: enabled(flags, SERVER_KEYS.manifestEnabled),
      playlistViewerEnabled: enabled(flags, SERVER_KEYS.playlistViewerEnabled),
      playlistExperimentId: enabled(flags, SERVER_KEYS.playlistExperimentId)
        ? String(flags[SERVER_KEYS.playlistExperimentId]?.variant || 'enabled')
        : null,
    });
  } catch {
    // Remote configuration is security-sensitive: unavailable or malformed
    // configuration always resolves to disabled rather than an environment fallback.
    state = Object.freeze({
      loaded: false,
      manifestEnabled: false,
      playlistViewerEnabled: false,
      playlistExperimentId: null,
    });
  }
  notify();
  return state;
}
