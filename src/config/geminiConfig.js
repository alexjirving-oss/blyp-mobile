// Canonical Gemini configuration.
// Provides single source of truth for base URL, default model, key access, availability check, and endpoint builder.

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
// Live model alias (do NOT use retired 1.5 variants)
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export const getGeminiApiKey = () => {
  return (
    process.env.EXPO_PUBLIC_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ''
  );
};

// IMPORTANT: must remain a direct function export for existing callers expecting callable property.
export const hasGeminiKey = () => {
  return !!getGeminiApiKey();
};

// Unified availability helper (preferred for future callers).
// Returns true only if a non-empty key is present; never throws.
export const isGeminiAvailable = () => {
  try {
    return !!getGeminiApiKey();
  } catch {
    return false;
  }
};

// Normalizes away any leading `models/` prefix and appends key if present.
export const buildGeminiUrl = (modelOverride) => {
  const apiKey = getGeminiApiKey();
  const modelId = (modelOverride || DEFAULT_GEMINI_MODEL).replace(/^models\//, '');

  if (!apiKey) {
    // Build URL without key; caller can decide fallback behavior.
    return `${GEMINI_BASE_URL}/models/${modelId}:generateContent`;
  }
  return `${GEMINI_BASE_URL}/models/${modelId}:generateContent?key=${apiKey}`;
};

// Backward compatible default export (object style)
const geminiConfig = {
  GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  getGeminiApiKey,
  hasGeminiKey,
  isGeminiAvailable,
  buildGeminiUrl,
};

// Legacy alias exports for backward compatibility with older import patterns.
export const GEMINI_API_BASE = GEMINI_BASE_URL;
export const GEMINI_MODEL_DEFAULT = DEFAULT_GEMINI_MODEL;

export default geminiConfig;

