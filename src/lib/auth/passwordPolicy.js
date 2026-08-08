/**
 * Cognito password policy for pool eu-west-2_ITX07Zvnt (live AWS describe).
 * Keep client validation + UI copy in lockstep with RequireSymbols=true.
 */
export const COGNITO_PASSWORD_POLICY = Object.freeze({
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSymbols: true,
});

/** Cognito-style symbol class (non-alphanumeric ASCII). */
const SYMBOL_RE = /[^A-Za-z0-9]/;

export function getPasswordRequirementChecks(password) {
  const pw = String(password || '');
  return [
    {
      id: 'length',
      label: `At least ${COGNITO_PASSWORD_POLICY.minLength} characters`,
      ok: pw.length >= COGNITO_PASSWORD_POLICY.minLength,
    },
    {
      id: 'upper',
      label: 'One uppercase letter (A–Z)',
      ok: /[A-Z]/.test(pw),
    },
    {
      id: 'lower',
      label: 'One lowercase letter (a–z)',
      ok: /[a-z]/.test(pw),
    },
    {
      id: 'number',
      label: 'One number (0–9)',
      ok: /[0-9]/.test(pw),
    },
    {
      id: 'symbol',
      label: 'One special character (e.g. !@#$%)',
      ok: SYMBOL_RE.test(pw),
    },
  ];
}

export function isPasswordPolicySatisfied(password) {
  return getPasswordRequirementChecks(password).every((c) => c.ok);
}

export const PASSWORD_REQUIREMENTS_SUMMARY =
  'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character (e.g. !@#$%).';

export default {
  COGNITO_PASSWORD_POLICY,
  getPasswordRequirementChecks,
  isPasswordPolicySatisfied,
  PASSWORD_REQUIREMENTS_SUMMARY,
};
