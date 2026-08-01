import { createIdempotencyKey, platformApi } from './platformApiClient';

function mutationOptions(operation, idempotencyKey) {
  return {
    idempotencyKey: idempotencyKey || createIdempotencyKey(operation),
    retries: 2,
  };
}

const TrustApiService = {
  async getSnapshot() {
    const response = await platformApi.get('/api/v1/trust/me');
    return response.data;
  },

  async acceptConsent(input, options = {}) {
    const response = await platformApi.post(
      '/api/v1/trust/me/consent/accept',
      input,
      mutationOptions('trust-consent-accept', options.idempotencyKey)
    );
    return response.data;
  },

  async withdrawConsent(input, options = {}) {
    const response = await platformApi.post(
      '/api/v1/trust/me/consent/withdraw',
      input,
      mutationOptions('trust-consent-withdraw', options.idempotencyKey)
    );
    return response.data;
  },

  async updatePrivacy(input, options = {}) {
    const response = await platformApi.post(
      '/api/v1/trust/me/privacy',
      input,
      mutationOptions('trust-privacy-update', options.idempotencyKey)
    );
    return response.data;
  },

  async listRelationshipControls(controlType) {
    const suffix = controlType ? `?type=${encodeURIComponent(controlType)}` : '';
    const response = await platformApi.get(`/api/v1/trust/me/relationships${suffix}`);
    return response.data;
  },

  async setRelationshipControl(input, options = {}) {
    const response = await platformApi.post(
      '/api/v1/trust/me/relationships',
      input,
      mutationOptions(`trust-${input.controlType || 'relationship'}-set`, options.idempotencyKey)
    );
    return response.data;
  },

  async removeRelationshipControl(controlType, targetUserId, options = {}) {
    const path = `/api/v1/trust/me/relationships/${encodeURIComponent(controlType)}/${encodeURIComponent(targetUserId)}`;
    const response = await platformApi.delete(
      path,
      mutationOptions(`trust-${controlType}-remove`, options.idempotencyKey)
    );
    return response.data;
  },

  async evaluatePolicy(input) {
    const response = await platformApi.post('/api/v1/trust/decisions', input);
    return response.data;
  },
};

export default TrustApiService;
