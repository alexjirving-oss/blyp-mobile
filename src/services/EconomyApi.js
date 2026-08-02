import { getCognitoBearerToken } from './CognitoSession';
import { getLiveApiBaseUrl, isLiveApiConfigured } from './liveApiBase';

export { isLiveApiConfigured };

async function economyFetch(path, options = {}) {
  const base = getLiveApiBaseUrl();
  if (!base) {
    throw new Error('LIVE_API_NOT_CONFIGURED');
  }
  // Use the CognitoUserPool session (same path as AuthScreen), not Amplify.
  const token = await getCognitoBearerToken();
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const code = payload?.code || payload?.error || `HTTP_${response.status}`;
    const detail = payload?.detail || payload?.error || response.statusText;
    const error = new Error(String(detail || code));
    error.code = code;
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function fetchServerWallet() {
  return economyFetch('/wallet', { method: 'GET' });
}

export async function sendServerGift({
  streamId,
  receiverUserId,
  giftId,
  quantity = 1,
  idempotencyKey,
}) {
  const key =
    idempotencyKey ||
    `gift-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return economyFetch('/gift/send', {
    method: 'POST',
    body: JSON.stringify({
      streamId,
      receiverUserId,
      giftId,
      quantity,
      idempotencyKey: key,
    }),
  });
}
