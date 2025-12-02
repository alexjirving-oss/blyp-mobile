// Structured logging helper with size & key guards.
// Ensures we never emit excessively large strings or sensitive markers.
export const logStructured = (event, data = {}) => {
  try {
    const allowedKeys = [
      'eventType',
      'status',
      'errorCode',
      'captionLength',
      'tokenCount',
      'hasKey',
      'ok'
    ];
    const scrub = { ...data };

    // Dedicated transcript suppression for error marker patterns.
    if (typeof scrub.transcript === 'string' && scrub.transcript.startsWith('[ERROR:Gemini API error')) {
      scrub.transcript = 'ERROR_TRANSCRIPT_SUPPRESSED';
    }

    // Generic truncation & guard for all string fields except whitelisted keys.
    for (const k of Object.keys(scrub)) {
      const v = scrub[k];
      if (typeof v === 'string') {
        // Existing explicit caption rule preserved (merged into generic logic).
        const needsTruncate = v.length > 300 && !allowedKeys.includes(k);
        if (needsTruncate) {
          scrub[k] = v.slice(0, 300) + '…[truncated]';
        }
        // Basic safeguard: mask any accidental secret-like value if key name hints it.
        if (!allowedKeys.includes(k) && /api[_-]?key|token|secret/i.test(k)) {
          scrub[k] = '[REDACTED]';
        }
      }
    }

    console.log('[EVT]', event, { ...scrub, ts: Date.now() });
  } catch {
    // Swallow any unexpected logging failure.
  }
};

export default logStructured;
