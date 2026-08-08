import {
  normalizeVerificationStatus,
  isProfileVerified,
  validateIdentityPayload,
  VERIFICATION_STATUS,
} from '../verificationService';

describe('verificationService', () => {
  test('normalizes verified flag and status', () => {
    expect(normalizeVerificationStatus('pending', false)).toBe(VERIFICATION_STATUS.PENDING);
    expect(normalizeVerificationStatus('unverified', true)).toBe(VERIFICATION_STATUS.VERIFIED);
    expect(isProfileVerified({ verified: true })).toBe(true);
    expect(isProfileVerified({ verificationStatus: 'verified' })).toBe(true);
    expect(isProfileVerified({})).toBe(false);
  });

  test('validates identity payload', () => {
    const bad = validateIdentityPayload({});
    expect(bad.ok).toBe(false);

    const year = new Date().getFullYear() - 25;
    const good = validateIdentityPayload({
      legalFullName: 'Alex Example',
      dateOfBirth: `${year}-06-15`,
      addressLine1: '1 High Street',
      city: 'London',
      postalCode: 'SW1A',
      country: 'United Kingdom',
      idDocumentType: 'passport',
      idDocumentLast4: 'AB12',
    });
    expect(good.ok).toBe(true);
    expect(good.identity.legalFullName).toBe('Alex Example');
  });
});
