const mockSignInWithRedirect = jest.fn();
const mockFetchAuthSession = jest.fn();
const mockGetCurrentUser = jest.fn();

jest.mock('aws-amplify/auth', () => ({
  signInWithRedirect: (...args) => mockSignInWithRedirect(...args),
  fetchAuthSession: (...args) => mockFetchAuthSession(...args),
  getCurrentUser: (...args) => mockGetCurrentUser(...args),
}));

jest.mock('../src/lib/auth/cognitoStorage', () => ({
  hydrateCognitoStorageCache: jest.fn(async () => {}),
  flushCognitoStorageWrites: jest.fn(async () => {}),
}));

jest.mock('../src/hooks/useCommon', () => ({
  userPool: {
    getCurrentUser: jest.fn(() => null),
  },
}));

jest.mock('../src/aws-exports', () => ({
  __esModule: true,
  default: {
    aws_user_pools_id: 'eu-west-2_ITX07Zvnt',
    aws_user_pools_web_client_id: '4a7r115hllaedriqsjlsa00snj',
    oauth: {},
  },
}));

const {
  isSocialAuthUiEnabled,
  isSocialProviderEnabled,
  isSocialProviderVisible,
  listSocialProvidersForUi,
  getSocialProviderSetupMessage,
  signInWithTikTok,
  signInWithGoogle,
} = require('../src/services/socialAuthService');

describe('socialAuthService UI + TikTok federation', () => {
  beforeEach(() => {
    mockSignInWithRedirect.mockReset();
    mockFetchAuthSession.mockReset();
    mockGetCurrentUser.mockReset();
    delete process.env.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH;
    delete process.env.EXPO_PUBLIC_COGNITO_DOMAIN;
    delete process.env.EXPO_PUBLIC_SOCIAL_PROVIDERS;
    delete process.env.EXPO_PUBLIC_SOCIAL_UI_PROVIDERS;
    delete process.env.EXPO_PUBLIC_COGNITO_IDP_PROVIDERS;
  });

  it('shows Google/Facebook/TikTok in the UI without a feature flag', () => {
    expect(isSocialAuthUiEnabled()).toBe(true);
    const providers = listSocialProvidersForUi().map((p) => p.toLowerCase());
    expect(providers).toEqual(expect.arrayContaining(['google', 'facebook', 'tiktok']));
    expect(isSocialProviderVisible('Google')).toBe(true);
    expect(isSocialProviderEnabled('Google')).toBe(false);
  });

  it('can hide the social UI with an explicit off flag', () => {
    process.env.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH = 'false';
    expect(isSocialAuthUiEnabled()).toBe(false);
    expect(listSocialProvidersForUi()).toEqual([]);
  });

  it('starts OAuth when Hosted UI domain is set (no IdP allowlist required)', async () => {
    process.env.EXPO_PUBLIC_COGNITO_DOMAIN = 'eu-west-2itx07zvnt.auth.eu-west-2.amazoncognito.com';
    process.env.EXPO_PUBLIC_SOCIAL_PROVIDERS = 'Google,Facebook,TikTok';
    expect(isSocialProviderEnabled('Google')).toBe(true);
    expect(isSocialProviderEnabled('TikTok')).toBe(true);
    await signInWithGoogle();
    expect(mockSignInWithRedirect).toHaveBeenCalledWith({ provider: 'Google' });
  });

  it('starts the case-sensitive Cognito custom provider when ready', async () => {
    process.env.EXPO_PUBLIC_COGNITO_DOMAIN = 'example.auth.eu-west-2.amazoncognito.com';
    process.env.EXPO_PUBLIC_SOCIAL_PROVIDERS = 'Google,Facebook,TikTok';
    expect(isSocialProviderEnabled('TikTok')).toBe(true);
    await signInWithTikTok();
    expect(mockSignInWithRedirect).toHaveBeenCalledWith({
      provider: { custom: 'TikTok' },
    });
  });

  it('explains missing Hosted UI domain instead of starting OAuth', async () => {
    await expect(signInWithGoogle()).rejects.toThrow(/COGNITO_DOMAIN|Hosted UI/i);
    expect(getSocialProviderSetupMessage('Google')).toMatch(/Hosted UI/i);
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  it('does not start TikTok when the build has not enabled it', async () => {
    process.env.EXPO_PUBLIC_COGNITO_DOMAIN = 'example.auth.eu-west-2.amazoncognito.com';
    process.env.EXPO_PUBLIC_SOCIAL_PROVIDERS = 'Google,Facebook';
    await expect(signInWithTikTok()).rejects.toThrow(
      /not listed/i,
    );
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  it('honours an explicit IdP allowlist when set', () => {
    process.env.EXPO_PUBLIC_COGNITO_DOMAIN = 'example.auth.eu-west-2.amazoncognito.com';
    process.env.EXPO_PUBLIC_SOCIAL_PROVIDERS = 'Google,Facebook,TikTok';
    process.env.EXPO_PUBLIC_COGNITO_IDP_PROVIDERS = 'Google';
    expect(isSocialProviderEnabled('Google')).toBe(true);
    expect(isSocialProviderEnabled('Facebook')).toBe(false);
  });
});
