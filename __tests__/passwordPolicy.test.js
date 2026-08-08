/**
 * @jest-environment node
 */
import {
  getPasswordRequirementChecks,
  isPasswordPolicySatisfied,
  PASSWORD_REQUIREMENTS_SUMMARY,
} from '../src/lib/auth/passwordPolicy';

describe('passwordPolicy (Cognito eu-west-2_ITX07Zvnt)', () => {
  test('rejects missing symbol even when other rules pass', () => {
    expect(isPasswordPolicySatisfied('Abcdefg1')).toBe(false);
    const symbol = getPasswordRequirementChecks('Abcdefg1').find((r) => r.id === 'symbol');
    expect(symbol.ok).toBe(false);
  });

  test('accepts full Cognito policy', () => {
    expect(isPasswordPolicySatisfied('Abcdefg1!')).toBe(true);
  });

  test('summary mentions special character', () => {
    expect(PASSWORD_REQUIREMENTS_SUMMARY.toLowerCase()).toMatch(/special/);
  });
});
