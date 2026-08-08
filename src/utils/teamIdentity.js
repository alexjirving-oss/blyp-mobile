import { looksLikeRawId, pickPublicLabel } from './publicLabel';

const EMBEDDED_UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const GENERATED_TEAM_RE = /^(.+?)(?:['’]s)\s+team$/i;

function optionalLabel(fields, uid) {
  const label = pickPublicLabel(fields, { uid, fallback: '' });
  return label === 'Someone' ? '' : label;
}

/**
 * Resolve a human-facing team identity from profile-like sources.
 * Display names are preferred; usernames remain available for @handle surfaces.
 */
export function resolveTeamIdentity(sources, uid, fallback = 'Member') {
  const rows = (Array.isArray(sources) ? sources : [sources]).filter(
    (row) => row && typeof row === 'object'
  );

  let displayName = '';
  let username = '';

  for (const row of rows) {
    displayName =
      optionalLabel(
        {
          displayName: row.displayName,
          name: row.name,
          title: row.fullName,
        },
        uid
      ) || displayName;
    if (displayName) break;
  }

  for (const row of rows) {
    username =
      optionalLabel(
        {
          username: row.username,
          handle: row.handle,
          preferredUsername: row.preferredUsername || row.preferred_username,
        },
        uid
      ) || username;
    if (username) break;
  }

  const safeFallback =
    optionalLabel({ displayName: fallback }, uid) || (fallback === 'Team owner' ? fallback : 'Member');
  const label = displayName || username || safeFallback;

  return {
    displayName: label,
    username,
    label,
  };
}

/** True when a team name was generated from an internal account identifier. */
export function teamNameNeedsResolution(value, leaderId = '') {
  const name = String(value || '').trim();
  const uid = String(leaderId || '').trim();
  if (!name) return true;
  if (uid && name.includes(uid)) return true;
  if (EMBEDDED_UUID_RE.test(name)) return true;
  if (looksLikeRawId(name)) return true;

  const generated = name.match(GENERATED_TEAM_RE);
  if (!generated) return false;
  const ownerToken = generated[1].trim();
  return (
    looksLikeRawId(ownerToken) ||
    /^blyp[_-]\d+/i.test(ownerToken) ||
    /^user_/i.test(ownerToken)
  );
}

/** Preserve custom names; replace generated ID names with a public owner label. */
export function resolveTeamName(value, ownerLabel, leaderId = '') {
  const name = String(value || '').trim();
  if (!teamNameNeedsResolution(name, leaderId)) return name.slice(0, 80);

  const safeOwner = resolveTeamIdentity(
    [{ displayName: ownerLabel }],
    leaderId,
    'Team owner'
  ).label;
  return `${safeOwner}'s Team`;
}

export default {
  resolveTeamIdentity,
  teamNameNeedsResolution,
  resolveTeamName,
};
