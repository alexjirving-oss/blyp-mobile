/**
 * Cognito User Pool `sub` values are UUID-*shaped* but are not always RFC 4122
 * (version/variant nibbles). Newer pools issue v7-looking ids whose variant
 * nibble is not restricted to 8/9/a/b — e.g. 26522274-e001-70aa-51b6-….
 *
 * After JWT signature + issuer verification, accept any 8-4-4-4-12 hex UUID shape.
 */
export const COGNITO_SUB_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalCognitoSub(value: unknown): boolean {
  return COGNITO_SUB_REGEX.test(String(value || '').trim());
}
