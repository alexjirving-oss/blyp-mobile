/**
 * Public labels for people in Activity / Notifications.
 *
 * Cognito `sub` values are UUID-shaped; legacy writes sometimes stored that raw
 * id as username/displayName. Never surface those as the primary human label.
 */

export function looksLikeRawId(value) {
  const t = String(value || '').trim();
  if (!t) return true;
  if (/\s/.test(t)) return false; // spaces => real display name
  // UUID / Cognito sub, e.g. 96b24294-6051-70bb-3f4c-a40185e033cf
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return true;
  }
  // Longer opaque hex/hyphen tokens
  if (t.length >= 20 && /[0-9]/.test(t) && /[a-f]/i.test(t) && /[-_]/.test(t)) {
    return true;
  }
  return false;
}

function cleanCandidate(value) {
  const t = String(value || '').trim();
  if (!t) return '';
  return t.startsWith('@') ? t.slice(1).trim() : t;
}

/**
 * Pick the best public label from profile-ish fields.
 * Prefers @username / handle, then displayName / name. Never returns a raw uid.
 *
 * @param {object} fields
 * @param {{ uid?: string|null, fallback?: string }} [opts]
 * @returns {string}
 */
export function pickPublicLabel(fields = {}, opts = {}) {
  const uid = opts.uid != null ? String(opts.uid).trim() : '';
  const ordered = [
    fields.username,
    fields.handle,
    fields.preferredUsername,
    fields.actorUsername,
    fields.userName,
    fields.displayName,
    fields.actorDisplayName,
    fields.name,
    fields.senderName,
    fields.title,
  ];
  for (const raw of ordered) {
    const t = cleanCandidate(raw);
    if (!t) continue;
    if (uid && t === uid) continue;
    if (looksLikeRawId(t)) continue;
    if (/^user_/i.test(t)) continue;
    return t;
  }
  const fb = cleanCandidate(opts.fallback != null ? opts.fallback : 'Someone');
  if (fb && !(uid && fb === uid) && !looksLikeRawId(fb) && !/^user_/i.test(fb)) {
    return fb;
  }
  return 'Someone';
}

/** True when a notification title is (or starts with) a raw id that needs resolving. */
export function notificationTitleNeedsResolve(title, actorId) {
  const t = String(title || '').trim();
  if (!t) return true;
  if (looksLikeRawId(t)) return true;
  const id = String(actorId || '').trim();
  if (id && t.includes(id)) return true;
  const first = t.split(/[\s·|]/)[0] || '';
  if (looksLikeRawId(first)) return true;
  if (id && first === id) return true;
  return false;
}

export function replaceActorInText(text, actorId, label) {
  const src = String(text || '');
  const id = String(actorId || '').trim();
  const name = String(label || '').trim();
  if (!src || !name) return src;
  let out = src;
  if (id) out = out.split(id).join(name);
  // Replace a leading opaque-id token (e.g. "uuid is live")
  out = out.replace(/^([^\s·|]+)(\s|·|$)/, (full, token, sep) => {
    if (looksLikeRawId(token) || (id && token === id)) return `${name}${sep}`;
    return full;
  });
  return out;
}

export default {
  looksLikeRawId,
  pickPublicLabel,
  notificationTitleNeedsResolve,
  replaceActorInText,
};
