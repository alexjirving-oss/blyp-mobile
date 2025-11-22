// src/config/VideoBackendFlag.js
// Minimal flag module to toggle future expo-video backend.
// Default is false (safety-first) unless explicitly enabled via env.
export function isExpoVideoEnabled() {
  try {
    const raw = process.env.EXPO_PUBLIC_ENABLE_EXPO_VIDEO;
    if (raw === '1' || raw === 'true' || raw === 'TRUE') {
      return true;
    }
  } catch (e) {
    // swallow — default remains false
  }
  return false;
}
