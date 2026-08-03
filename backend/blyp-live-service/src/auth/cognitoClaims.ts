export type CognitoClaims = {
  sub?: unknown;
  token_use?: unknown;
  client_id?: unknown;
  aud?: unknown;
};

/**
 * Fail-closed claim checks for Cognito access/id tokens after signature verify.
 */
export function validateCognitoClaims(
  decoded: CognitoClaims | null | undefined,
  appClientIds: string[],
): asserts decoded is CognitoClaims & { sub: string } {
  const tokenUse = String(decoded?.token_use || '').trim().toLowerCase();
  if (tokenUse !== 'access' && tokenUse !== 'id') {
    throw new Error('INVALID_TOKEN_USE');
  }

  const clientId = String(decoded?.client_id || decoded?.aud || '').trim();
  if (!clientId || !appClientIds.includes(clientId)) {
    throw new Error('INVALID_TOKEN_CLIENT');
  }

  const sub = String(decoded?.sub || '').trim();
  if (!sub) {
    throw new Error('INVALID_TOKEN_SUB');
  }
}
