import {
  createIdempotencyKey,
  platformApi,
  PlatformApiError,
} from './platformApiClient';

function requireFirebaseUser(firebaseUser) {
  if (!firebaseUser || typeof firebaseUser.getIdToken !== 'function') {
    throw new PlatformApiError({
      code: 'LEGACY_IDENTITY_PROOF_REQUIRED',
      message: 'A signed-in legacy Firebase account is required to link this identity.',
    });
  }
  return firebaseUser;
}

export async function getIdentityLinks() {
  const response = await platformApi.get('/api/v1/platform/identity-links');
  return response.data?.links || [];
}

export async function linkFirebaseIdentity(firebaseUser, options = {}) {
  const user = requireFirebaseUser(firebaseUser);
  const firebaseIdToken = await user.getIdToken(true);
  const response = await platformApi.post(
    '/api/v1/platform/identity-links/firebase',
    { firebaseIdToken },
    {
      idempotencyKey:
        options.idempotencyKey || createIdempotencyKey('identity-link-firebase'),
      retries: 2,
    }
  );
  return response.data;
}

export async function revokeFirebaseIdentityLink(options = {}) {
  const response = await platformApi.delete('/api/v1/platform/identity-links/firebase', {
    idempotencyKey:
      options.idempotencyKey || createIdempotencyKey('identity-revoke-firebase'),
    retries: 2,
  });
  return response.data;
}
