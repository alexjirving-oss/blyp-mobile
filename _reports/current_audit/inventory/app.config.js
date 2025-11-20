// Dynamic app config to inject build-time metadata (e.g., git SHA) into Constants.expoConfig
// Keep this implementation simple and robust for EAS "Read app config" phase.

module.exports = () => {
  let base;
  try {
    // Use require so it works reliably in EAS build environment
    base = require('./app.json');
  } catch (e) {
    // Fallback to an empty shape if app.json cannot be read for any reason
    base = { expo: {} };
  }

  const expo = base.expo || {};

  // Merge extra with dynamic gitSha (non-breaking if not set)
  const extra = { ...(expo.extra || {}) };
  if (process.env.EXPO_PUBLIC_GIT_SHA) {
    extra.gitSha = process.env.EXPO_PUBLIC_GIT_SHA;
  }

  // Return the resolved Expo config object
  return { ...expo, extra };
};
