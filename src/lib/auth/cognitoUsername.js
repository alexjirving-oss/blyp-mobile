// Helpers for Cognito pools that use email as an alias instead of the username.

export function generateOpaqueCognitoUsername() {
  const randomUUID = global?.crypto?.randomUUID?.();
  if (randomUUID && typeof randomUUID === 'string') return randomUUID;
  return `blyp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function isEmailAliasUsernameError(err) {
  const code = err?.code || err?.name || '';
  if (code !== 'InvalidParameterException') return false;
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('email alias') || msg.includes('cannot be of email format');
}

export function isSignupAttributeRejection(err) {
  const code = err?.code || err?.name || '';
  if (code !== 'InvalidParameterException') return false;
  return !isEmailAliasUsernameError(err);
}
