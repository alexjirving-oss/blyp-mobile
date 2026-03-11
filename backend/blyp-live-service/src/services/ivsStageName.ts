export function buildSafeStageName(params: {
  appPrefix: string;
  userId: string;
  rawTitle?: string;
  sessionId?: string;
}): string {
  const { appPrefix, userId, rawTitle, sessionId } = params;

  const baseParts = [appPrefix, userId];

  if (sessionId) {
    baseParts.push(sessionId);
  }

  let base = baseParts.join('-');

  if (rawTitle) {
    const slug = rawTitle
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (slug) {
      base += '-' + slug;
    }
  }

  let safe = base.replace(/[^a-zA-Z0-9-_]/g, '-');

  if (safe.length > 64) {
    safe = safe.slice(0, 64);
  }

  if (!safe) {
    safe = `blyp-${Date.now()}`;
  }

  return safe;
}
