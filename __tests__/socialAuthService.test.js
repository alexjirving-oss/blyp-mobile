const mockSignInWithRedirect = jest.fn();

jest.mock('aws-amplify/auth', () => ({
  signInWithRedirect: (...args) => mockSignInWithRedirect(...args),
}));

const {
  isSocialProviderEnabled,
  signInWithTikTok,
} = require('../src/services/socialAuthService');

describe('socialAuthService TikTok federation', () => {
  beforeEach(() => {
    mockSignInWithRedirect.mockReset();
    process.env.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH = 'true';
    process.env.EXPO_PUBLIC_COGNITO_DOMAIN = 'example.auth.eu-west-2.amazoncognito.com';
    process.env.EXPO_PUBLIC_SOCIAL_PROVIDERS = 'Google,Facebook,TikTok';
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH;
    delete process.env.EXPO_PUBLIC_COGNITO_DOMAIN;
    delete process.env.EXPO_PUBLIC_SOCIAL_PROVIDERS;
  });

  it('starts the case-sensitive Cognito custom provider', async () => {
    expect(isSocialProviderEnabled('TikTok')).toBe(true);
    await signInWithTikTok();
    expect(mockSignInWithRedirect).toHaveBeenCalledWith({
      provider: { custom: 'TikTok' },
    });
  });

  it('does not start TikTok when the build has not enabled it', async () => {
    process.env.EXPO_PUBLIC_SOCIAL_PROVIDERS = 'Google,Facebook';
    await expect(signInWithTikTok()).rejects.toThrow(
      'TikTok sign-in is not configured for this build.',
    );
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });
});
