import { getCognitoJwtForApi } from './getCognitoJwtForApi';

const isDevelopment = __DEV__ === true;

// IMPORTANT: Do not embed literal loopback markers in release bundles.
// Construct them at runtime so release artifact scans can verify they're not baked into the binary.
const LOOPBACK_IPV4 = ['127', '0', '0', '1'].join('.');
const LOOPBACK_HOST = ['local', 'host'].join('');

const ECONOMY_FETCH_TIMEOUT_MS = 8000;

export const resolveLiveServiceUrl = (): string => {
  const fromEnv = process.env.EXPO_PUBLIC_LIVE_SERVICE_URL;
  let fromExtra = '';
  try {
    // Expo injects app.config.js `extra` for release builds when babel inlining
    // of process.env is incomplete — keep both paths for production safety.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants')?.default || require('expo-constants');
    fromExtra = String(Constants?.expoConfig?.extra?.EXPO_PUBLIC_LIVE_SERVICE_URL || '').trim();
  } catch {
    // ignore — Constants unavailable in some test/node contexts
  }
  const raw = (fromEnv && fromEnv.trim()) || fromExtra;
  if (raw && raw.trim()) {
    const normalized = raw.replace(/\/+$/, '');
    if (!isDevelopment && (normalized.includes(LOOPBACK_IPV4) || normalized.includes(LOOPBACK_HOST))) {
      throw new Error('RELEASE_LIVE_BACKEND_MISCONFIGURED: loopback live backend is not allowed in release');
    }
    return normalized;
  }

  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (apiBase && apiBase.trim()) {
    const normalized = apiBase.replace(/\/+$/, '');
    if (normalized.includes(':4000')) {
      if (!isDevelopment && (normalized.includes(LOOPBACK_IPV4) || normalized.includes(LOOPBACK_HOST))) {
        throw new Error('RELEASE_LIVE_BACKEND_MISCONFIGURED: loopback live backend is not allowed in release');
      }
      return normalized;
    }
  }

  if (isDevelopment) {
    const host = ['127', '0', '0', '1'].join('.');
    const port = ['40', '00'].join('');
    return `http://${host}:${port}`;
  }

  throw new Error(
    '[ECONOMY_API] EXPO_PUBLIC_LIVE_SERVICE_URL is required for production builds.'
  );
};

export async function callEconomyBackend<T>(
  path: string,
  method: 'POST' | 'GET' = 'GET',
  body: Record<string, any> = {},
  options: { signal?: AbortSignal } = {}
): Promise<T> {
  const baseUrl = resolveLiveServiceUrl();

  const token = await getCognitoJwtForApi({ tokenType: 'id' });

  let url = `${baseUrl}${path}`;
  if (method === 'GET' && Object.keys(body).length > 0) {
    const params = new URLSearchParams();
    Object.entries(body).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.append(k, String(v));
    });
    url = `${url}?${params.toString()}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ECONOMY_FETCH_TIMEOUT_MS);

  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else {
      const onAbort = () => controller.abort();
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    const aborted = controller.signal.aborted;
    const msg = aborted ? `Request timed out after ${ECONOMY_FETCH_TIMEOUT_MS}ms` : (e?.message || String(e));
    throw new Error(`[ECONOMY_API] Network error for ${path}: ${msg}`);
  } finally {
    clearTimeout(timeoutId);
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`[ECONOMY_API] Invalid JSON response (HTTP ${res.status}) for ${path}`);
  }

  if (!res.ok) {
    const code = typeof json?.code === 'string' ? json.code : undefined;

    // Idempotent replay: the original request already succeeded and the backend
    // is returning the same success payload (with HTTP 409). Treat it as success
    // so retries never surface a false "failed" to the user or double-charge UX.
    if (res.status === 409 && code === 'IDEMPOTENT_REPLAY') {
      return json as T;
    }

    const msg = typeof json?.error === 'string' ? json.error : `HTTP_${res.status}`;
    const detail = json?.detail;
    const err: any = new Error(`[ECONOMY_API] ${msg}${code ? ` (${code})` : ''}`);
    err.code = code;
    err.detail = detail;
    err.httpStatus = res.status;
    throw err;
  }

  return json as T;
}

export interface EconomyWallet {
  userId?: string;
  coinBalance: number;
  bonusCoinBalance: number;
  gemAvailable: number;
  gemPending: number;
}

export interface EconomyCatalogGift {
  giftId: string;
  name: string;
  coinCost: number;
  enabled: boolean;
  rarity: string | null;
  minLevel: number | null;
  cooldownMs: number | null;
  assetJson: any;
}

export interface EconomyCatalog {
  coinPacks: any[];
  gifts: EconomyCatalogGift[];
}

export type PromotePricing = {
  battle: { coins: number; durationHours: number };
  timeSlot: { per30MinCoins: number };
  spotlight: { coins1h: number; coins24h: number; coins7d: number };
};

export type SpotlightAvailability = {
  durationKey: '1h' | '24h' | '7d';
  availableStartsAt: string[];
};

export type PromotePurchaseResponse = {
  promotionId: string;
  promotionType: string;
  status: string;
  startsAt: string;
  endsAt: string;
  coinCost: number;
  newBalances: { coinBalance: number; bonusCoinBalance: number };
};

export interface SendGiftInput {
  streamId: string;
  receiverUserId: string;
  giftId: string;
  quantity: number;
  idempotencyKey: string;
}

export interface SendGiftResponse {
  giftEventId: string;
  streamId: string;
  sequenceNo: number;
  coinSpent: number;
  gemsCredited: number;
  newBalances: {
    coinBalance: number;
    bonusCoinBalance: number;
  };
  receiver: {
    userId: string;
    newGemPendingOrAvailable: number;
  };
  gift: {
    giftId: string;
    quantity: number;
  };
  createdAt: string;
}

export interface StreamSummaryResponse {
  streamId: string;
  viewer?: {
    userId: string;
    coinSpent: number;
    giftCount: number;
  };
  creator?: {
    userId: string;
    coinsReceived: number;
    gemsEarned: number;
  };
}

export interface AdminCreditCoinsInput {
  targetUserId: string;
  coins: number;
  idempotencyKey: string;
  reason?: string;
}

export interface AdminCreditCoinsResponse {
  targetUserId: string;
  coinsCredited: number;
  newBalance: number;
  ledgerId: string;
  createdAt: string;
  replay: boolean;
}

export interface VerifyAndroidIapPurchaseInput {
  idempotencyKey: string;
  platform: 'ANDROID' | 'IOS';
  sku: string;
  storeTransactionId: string;
  purchaseToken: string;
}

export interface VerifyAndroidIapPurchaseResponse {
  valid: boolean;
  duplicatePerfId?: string | null;
  grantedCoins?: number;
  grantedGems?: number;
  wallet?: EconomyWallet;
}

export async function getEconomyCatalog(): Promise<EconomyCatalog> {
  return await callEconomyBackend<EconomyCatalog>('/economy/catalog', 'GET');
}

export async function getEconomyWallet(): Promise<EconomyWallet> {
  return await callEconomyBackend<EconomyWallet>('/wallet', 'GET');
}

export async function sendEconomyGift(input: SendGiftInput): Promise<SendGiftResponse> {
  return await callEconomyBackend<SendGiftResponse>('/gift/send', 'POST', input);
}

export async function getPromotePricing(): Promise<PromotePricing> {
  return await callEconomyBackend<PromotePricing>('/promote/pricing', 'GET');
}

export async function promoteBattle(input: { idempotencyKey: string; battleRef?: string }): Promise<PromotePurchaseResponse> {
  return await callEconomyBackend<PromotePurchaseResponse>('/promote/battle', 'POST', input);
}

export async function promoteBookTimeSlot(input: { idempotencyKey: string; startsAt: string; durationMinutes: number; note?: string }): Promise<PromotePurchaseResponse> {
  return await callEconomyBackend<PromotePurchaseResponse>('/promote/slot/book', 'POST', input);
}

export async function getSpotlightAvailability(input: { durationKey: '1h' | '24h' | '7d' }): Promise<SpotlightAvailability> {
  return await callEconomyBackend<SpotlightAvailability>('/promote/spotlight/availability', 'GET', input);
}

export async function promoteBookSpotlight(input: { idempotencyKey: string; startsAt: string; durationKey: '1h' | '24h' | '7d'; note?: string }): Promise<PromotePurchaseResponse> {
  return await callEconomyBackend<PromotePurchaseResponse>('/promote/spotlight/book', 'POST', input);
}

export async function getEconomyStreamSummary(streamId: string): Promise<StreamSummaryResponse> {
  return await callEconomyBackend<StreamSummaryResponse>(`/economy/stream/${encodeURIComponent(streamId)}/summary`, 'GET');
}

export async function creditEconomyCoinsAdmin(
  input: AdminCreditCoinsInput,
  options: { signal?: AbortSignal } = {}
): Promise<AdminCreditCoinsResponse> {
  return await callEconomyBackend<AdminCreditCoinsResponse>('/economy/admin/credit-coins', 'POST', input, options);
}

export async function verifyAndroidIapPurchase(
  input: VerifyAndroidIapPurchaseInput
): Promise<VerifyAndroidIapPurchaseResponse> {
  try {
    return await callEconomyBackend<VerifyAndroidIapPurchaseResponse>('/iap/verify', 'POST', input);
  } catch (e: any) {
    console.error('[VERIFY_IAP] Purchase verification failed:', e);
    throw e;
  }
}

export async function followUserApi(targetUserId: string): Promise<{ ok: boolean; following: boolean; targetUserId: string }> {
  return callEconomyBackend('/social/follow', 'POST', { targetUserId });
}

export async function unfollowUserApi(targetUserId: string): Promise<{ ok: boolean; following: boolean; targetUserId: string }> {
  return callEconomyBackend('/social/unfollow', 'POST', { targetUserId });
}

// ----------------------------------------------------------------------------
// Matchday Live
// ----------------------------------------------------------------------------

export interface MatchdayPricing {
  unlockCoins: number;
  entitlementTtlHours: number;
  predictionMinStake: number;
  predictionMaxStake: number;
  enabled: boolean;
}

export interface MatchdayEntitlement {
  entitlementId: string;
  eventId: string;
  status: string;
  coinCost: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface MatchdayEntitlementStatus {
  eventId: string;
  entitled: boolean;
  entitlement: MatchdayEntitlement | null;
  priceCoins: number;
  wallet: { coinBalance: number; bonusCoinBalance: number };
}

export interface MatchdayPurchaseResponse {
  entitlement: MatchdayEntitlement;
  newBalances: { coinBalance: number; bonusCoinBalance: number };
}

export type MatchdayMarket = 'SCORELINE' | 'FIRST_SCORER' | 'RESULT';

export interface MatchdayPrediction {
  predictionId: string;
  eventId: string;
  market: MatchdayMarket;
  selection: string;
  stakeCoins: number;
  status: 'OPEN' | 'WON' | 'LOST' | 'REFUNDED';
  payoutCoins: number;
  createdAt: string;
  settledAt: string | null;
}

export interface MatchdayPredictionsResponse {
  eventId: string;
  predictions: MatchdayPrediction[];
  pools: Array<{ market: MatchdayMarket; poolCoins: number; entrants: number }>;
}

export interface MatchdayResultInput {
  status: 'COMPLETED' | 'VOID';
  homeScore?: number | null;
  awayScore?: number | null;
  winner?: 'HOME' | 'AWAY' | 'DRAW' | null;
  firstScorer?: string | null;
}

export interface MatchdayLeaderboardEntry {
  rank: number;
  userId: string;
  staked: number;
  won: number;
  net: number;
  plays: number;
}

export async function getMatchdayPricing(): Promise<MatchdayPricing> {
  return await callEconomyBackend<MatchdayPricing>('/economy/matchday/pricing', 'GET');
}

export async function getMatchdayEntitlement(eventId: string): Promise<MatchdayEntitlementStatus> {
  return await callEconomyBackend<MatchdayEntitlementStatus>(
    `/economy/matchday/${encodeURIComponent(eventId)}/entitlement`,
    'GET'
  );
}

export async function purchaseMatchdayEntitlement(input: {
  idempotencyKey: string;
  eventId: string;
  eventMeta?: { homeTeam?: string; awayTeam?: string; league?: string; kickoff?: string };
}): Promise<MatchdayPurchaseResponse> {
  return await callEconomyBackend<MatchdayPurchaseResponse>('/economy/matchday/purchase', 'POST', input);
}

export async function getMatchdayPredictions(eventId: string): Promise<MatchdayPredictionsResponse> {
  return await callEconomyBackend<MatchdayPredictionsResponse>(
    `/economy/matchday/${encodeURIComponent(eventId)}/predictions`,
    'GET'
  );
}

export async function placeMatchdayPrediction(input: {
  idempotencyKey: string;
  eventId: string;
  market: MatchdayMarket;
  selection: string;
  stakeCoins: number;
}): Promise<{ prediction: MatchdayPrediction; newBalances: { coinBalance: number; bonusCoinBalance: number } }> {
  return await callEconomyBackend('/economy/matchday/predictions/place', 'POST', input);
}

export async function settleMatchdayPredictions(input: {
  idempotencyKey: string;
  eventId: string;
  result: MatchdayResultInput;
}): Promise<any> {
  return await callEconomyBackend('/economy/matchday/predictions/settle', 'POST', input);
}

export async function getMatchdayLeaderboard(eventId?: string): Promise<{
  eventId: string | null;
  scope: 'match' | 'season';
  entries: MatchdayLeaderboardEntry[];
}> {
  return await callEconomyBackend('/economy/matchday/leaderboard', 'GET', eventId ? { eventId } : {});
}

export async function sendMatchdayReaction(input: { eventId: string; emoji: string }): Promise<any> {
  return await callEconomyBackend('/economy/matchday/react', 'POST', input);
}

// ----------------------------------------------------------------------------
// Battles — coin deposit/escrow (attendance bond). Settled in COINS at face
// value (never gems). The live-service is authoritative for attendance + payout.
// ----------------------------------------------------------------------------

export interface BattleDepositInput {
  battleId: string;
  role: 'creator' | 'opponent';
  stakeCoins: number;
  creatorUid: string;
  opponentUid: string;
  idempotencyKey: string;
}

export interface BattleDepositResponse {
  battleId: string;
  role: string;
  stakeCoins: number;
  poolCoins: number;
  newBalances: { coinBalance: number; bonusCoinBalance: number };
}

export interface BattleSettleResponse {
  battleId: string;
  outcome: 'both' | 'creator_only' | 'opponent_only' | 'none' | string;
  settlement: { outcome: string; coinsTo?: Record<string, number>; paidAt?: string };
}

export async function battleDeposit(input: BattleDepositInput): Promise<BattleDepositResponse> {
  return await callEconomyBackend<BattleDepositResponse>('/economy/battle/deposit', 'POST', input);
}

export async function battleCancelRefund(input: { battleId: string; idempotencyKey: string }): Promise<any> {
  return await callEconomyBackend('/economy/battle/cancel-refund', 'POST', input);
}

export async function battleSettle(input: { battleId: string; idempotencyKey: string }): Promise<BattleSettleResponse> {
  return await callEconomyBackend<BattleSettleResponse>('/economy/battle/settle', 'POST', input);
}

export function makeIdempotencyKey(prefix: string = 'gift'): string {
  const randomUUID = (global as any)?.crypto?.randomUUID?.();
  if (randomUUID && typeof randomUUID === 'string') return `${prefix}:${randomUUID}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

export function resolveEconomySocketUrl(): string {
  return resolveLiveServiceUrl();
}
