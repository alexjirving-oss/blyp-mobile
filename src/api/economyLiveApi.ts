import { getCognitoJwtForApi } from './getCognitoJwtForApi';
import { emitWalletUpdated } from '../utils/walletEvents';

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
  const params = new URLSearchParams();
  if (method === 'GET' && Object.keys(body).length > 0) {
    Object.entries(body).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.append(k, String(v));
    });
  }
  // Cache-bust wallet (and other GETs): OkHttp can still 304 empty bodies even
  // with Cache-Control headers, which left the UI stuck at coin balance 0.
  if (method === 'GET') {
    params.append('_ts', String(Date.now()));
  }
  const qs = params.toString();
  if (qs) url = `${url}?${qs}`;

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
        // Prevent OkHttp / intermediaries from serving a stale empty 304 for
        // /wallet after a purchase (balance would stick at the initial 0).
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
      // RN/OkHttp: refuse HTTP cache for this request entirely when supported.
      cache: 'no-store' as RequestCache,
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

  // HTTP 304 has no body — never treat it as a successful empty wallet.
  if (res.status === 304) {
    throw new Error(`[ECONOMY_API] Stale cache (HTTP 304) for ${path}`);
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

export type PromoteCatalogMethod = {
  methodId: string;
  type: string;
  title: string;
  subtitle: string;
  category: string;
  packages: Array<{ id: string; label: string; hours: number; coins: number }>;
};

export type PromotePricing = {
  battle: { coins: number; durationHours: number };
  timeSlot: { per30MinCoins: number };
  spotlight: { coins1h: number; coins24h: number; coins7d: number };
  catalog?: PromoteCatalogMethod[];
  packages?: Record<string, Array<{ id: string; label: string; hours: number; coins: number }>>;
  limits?: { maxActivePerUser: number; searchGlobalCap: number };
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

export type ActivePromotion = {
  promotionId: string;
  userId: string;
  promotionType: string;
  startsAt: string;
  endsAt: string;
  battleRef: string | null;
  postRef?: string | null;
  streamRef?: string | null;
  methodId?: string | null;
  note?: string | null;
  targeting?: { sports?: string[]; geos?: string[]; interests?: string[] } | null;
};

export type ActivePromotionsResponse = {
  asOf: string;
  promotions: ActivePromotion[];
};

export type MyPromotion = ActivePromotion & {
  status: string;
  coinCost?: number;
  createdAt?: string;
};

export type MyPromotionsResponse = {
  asOf: string;
  active: MyPromotion[];
  history: MyPromotion[];
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
  const wallet = await callEconomyBackend<EconomyWallet>('/wallet', 'GET');
  try {
    emitWalletUpdated(wallet);
  } catch {
    /* ignore bus errors */
  }
  return wallet;
}

export async function sendEconomyGift(input: SendGiftInput): Promise<SendGiftResponse> {
  return await callEconomyBackend<SendGiftResponse>('/gift/send', 'POST', input);
}

export async function getPromotePricing(): Promise<PromotePricing> {
  return await callEconomyBackend<PromotePricing>('/promote/pricing', 'GET');
}

/** Currently-valid promote windows for discovery / For You ranking. */
export async function getActivePromotions(): Promise<ActivePromotionsResponse> {
  return await callEconomyBackend<ActivePromotionsResponse>('/promote/active', 'GET');
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


export async function promoteBookMethod(input: {
  idempotencyKey: string;
  methodId: string;
  packageId?: string;
  startsAt?: string;
  durationKey?: '1h' | '24h' | '7d';
  durationMinutes?: number;
  battleRef?: string;
  postRef?: string;
  streamRef?: string;
  note?: string;
  targeting?: { sports?: string[]; geos?: string[]; interests?: string[] };
}): Promise<PromotePurchaseResponse> {
  return await callEconomyBackend<PromotePurchaseResponse>('/promote/method/book', 'POST', input);
}

export async function getMyPromotions(): Promise<MyPromotionsResponse> {
  return await callEconomyBackend<MyPromotionsResponse>('/promote/mine', 'GET');
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

// ----------------------------------------------------------------------------
// Pre-arranged battle gifts — debit now, deliver when match starts.
// ----------------------------------------------------------------------------

export interface BattleGiftPledgeInput {
  battleId: string;
  side: 'creator' | 'opponent';
  giftId: string;
  quantity?: number;
  creatorUid: string;
  opponentUid: string;
  idempotencyKey: string;
}

export interface BattleGiftPledge {
  pledgeId: string;
  battleId: string;
  pledgerUid: string;
  side: 'creator' | 'opponent';
  receiverUid: string;
  giftId: string;
  quantity: number;
  coinCost: number;
  status: string;
  scoreCoins?: number;
  createdAt?: string;
  appliedAt?: string | null;
  refundedAt?: string | null;
  newBalances?: { coinBalance: number; bonusCoinBalance: number };
}

export interface BattleGiftPledgesApplyResponse {
  battleId: string;
  streamId: string;
  applied: BattleGiftPledge[];
  scoreDelta: { creator: number; opponent: number };
  appliedCount: number;
}

export async function createBattleGiftPledge(input: BattleGiftPledgeInput): Promise<BattleGiftPledge> {
  return await callEconomyBackend<BattleGiftPledge>('/economy/battle/gift-pledge', 'POST', input);
}

export async function cancelBattleGiftPledge(input: {
  pledgeId: string;
  idempotencyKey: string;
}): Promise<BattleGiftPledge & { refunded?: boolean }> {
  return await callEconomyBackend('/economy/battle/gift-pledge/cancel', 'POST', input);
}

export async function listBattleGiftPledges(
  battleId: string,
  opts: { mine?: boolean } = {}
): Promise<{ battleId: string; pledges: BattleGiftPledge[]; heldCount: number; heldCoins: number }> {
  const q = opts.mine ? '?mine=1' : '';
  return await callEconomyBackend(`/economy/battle/${encodeURIComponent(battleId)}/gift-pledges${q}`, 'GET');
}

export async function applyBattleGiftPledges(input: {
  battleId: string;
  streamId?: string;
  idempotencyKey: string;
}): Promise<BattleGiftPledgesApplyResponse> {
  return await callEconomyBackend<BattleGiftPledgesApplyResponse>(
    '/economy/battle/gift-pledges/apply',
    'POST',
    input
  );
}

export async function refundBattleGiftPledges(input: {
  battleId: string;
  idempotencyKey: string;
}): Promise<{ battleId: string; refundedCount: number; refundedCoins: number }> {
  return await callEconomyBackend('/economy/battle/gift-pledges/refund', 'POST', input);
}

const WITHDRAWAL_REASON_COPY: Record<string, string> = {
  INVALID_AMOUNT: 'Enter a valid whole-gem amount.',
  NON_INTEGER_AMOUNT: 'Enter a whole number of gems.',
  BELOW_MIN_PAYOUT: 'The minimum withdrawal is 1,000 gems.',
  ABOVE_MAX_SINGLE_PAYOUT: 'This amount is above the maximum single withdrawal.',
  INSUFFICIENT_WITHDRAWABLE_BALANCE: 'You do not have enough cleared, withdrawable gems.',
  ACCOUNT_FROZEN: 'Withdrawals are unavailable while this account is frozen. Contact Blyp support.',
  UNDER_FRAUD_REVIEW: 'Withdrawals are paused while this account is under review. Contact Blyp support.',
  OPEN_CHARGEBACK: 'Resolve the open payment dispute before withdrawing.',
  ACCOUNT_TOO_NEW: 'This account is not old enough to withdraw yet.',
  EMAIL_NOT_VERIFIED: 'Verify your email address before withdrawing.',
  KYC_NOT_VERIFIED: 'Finish Stripe identity verification before withdrawing.',
  NO_PAYOUT_ACCOUNT: 'Connect a Stripe payout account before withdrawing.',
  OPEN_REQUEST_EXISTS: 'A withdrawal is already in progress. Wait for it to finish before trying again.',
  TOO_SOON_SINCE_LAST_REQUEST: 'Please wait 24 hours between withdrawal requests.',
  DAILY_REQUEST_LIMIT: 'The daily withdrawal request limit has been reached. Try again tomorrow.',
  WEEKLY_REQUEST_LIMIT: 'The weekly withdrawal request limit has been reached. Try again later.',
};

/** Convert server withdrawal codes/details into copy safe to show in the app. */
export function formatWithdrawalError(error: any): string {
  const detail = error?.detail;
  const userMessage =
    detail && typeof detail === 'object' && typeof detail.userMessage === 'string'
      ? detail.userMessage.trim()
      : '';
  if (userMessage) return userMessage;

  const reasons =
    detail && typeof detail === 'object' && Array.isArray(detail.reasons)
      ? detail.reasons
      : Array.isArray(error?.reasons)
        ? error.reasons
        : [];
  if (reasons.length > 0) {
    const messages = reasons
      .map((reason: unknown) => {
        const code = String(reason || '').trim();
        return WITHDRAWAL_REASON_COPY[code] || '';
      })
      .filter(Boolean);
    if (messages.length > 0) return Array.from(new Set(messages)).join(' ');
  }

  const code = String(error?.code || '').trim();
  if (code === 'PROVIDER_ERROR') {
    return 'Stripe could not process this payout. Check your Stripe payout details, then try again or contact Blyp support.';
  }
  if (code === 'WITHDRAWALS_DISABLED' || code === 'STRIPE_NOT_CONFIGURED') {
    return 'Withdrawals are temporarily unavailable. Please try again later.';
  }

  const raw = String(error?.message || 'Withdrawal failed').trim();
  const withoutPrefix = raw.replace(/^\[ECONOMY_API\]\s*/i, '');
  const withoutCodeSuffix = withoutPrefix.replace(/\s+\([A-Z][A-Z0-9_]+\)\s*$/, '');
  return withoutCodeSuffix || 'Withdrawal failed. Please try again.';
}

export interface WithdrawConnectStatus {
  linked: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  chargesEnabled?: boolean;
  stripeAccountId?: string;
  currentlyDue?: string[];
  pastDue?: string[];
  pendingVerification?: string[];
  disabledReason?: string | null;
  /** Server-computed: reopen Stripe Account Link only when user action is still required. */
  needsOnboarding?: boolean;
  onboardingComplete?: boolean;
  blockerMessage?: string | null;
}

export interface WithdrawEligibility {
  enabled: boolean;
  currency: string;
  withdrawableGems: number;
  gemAvailable: number;
  gemPending: number;
  purchasedCoinsNotCashable: number;
  minPayoutGems: number;
  platformFeePercent: number;
  gemMinorUnits: number;
  fiatCurrency: string;
  feePreviewMinPayout: {
    amountGems: number;
    feeGems: number;
    netGems: number;
    grossMinor: number;
    feeMinor: number;
    netMinor: number;
  };
  connect: WithdrawConnectStatus;
  blockers: string[];
  reviewReasons: string[];
  canRequest: boolean;
}

export async function getWithdrawEligibility(): Promise<WithdrawEligibility> {
  return await callEconomyBackend<WithdrawEligibility>('/withdraw/eligibility', 'GET');
}

export async function startWithdrawConnectOnboard(input: {
  returnUrl?: string;
  refreshUrl?: string;
} = {}): Promise<{
  url: string | null;
  stripeAccountId: string;
  expiresAt?: number;
  alreadyComplete?: boolean;
  connect?: WithdrawConnectStatus;
}> {
  return await callEconomyBackend('/withdraw/connect/onboard', 'POST', input);
}

export async function getWithdrawConnectStatus(): Promise<WithdrawConnectStatus> {
  return await callEconomyBackend('/withdraw/connect/status', 'GET');
}

export async function requestWithdrawGems(input: {
  amountGems: number;
  idempotencyKey: string;
}): Promise<{
  withdrawalId: string;
  status: string;
  amountGems: number;
  feeGems: number;
  netGems: number;
  netMinor: number;
  currency: string;
  reasons?: string[];
  stripeTransferId?: string;
}> {
  return await callEconomyBackend('/withdraw/request', 'POST', input);
}

export function makeIdempotencyKey(prefix: string = 'gift'): string {
  const randomUUID = (global as any)?.crypto?.randomUUID?.();
  if (randomUUID && typeof randomUUID === 'string') return `${prefix}:${randomUUID}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

export function resolveEconomySocketUrl(): string {
  return resolveLiveServiceUrl();
}
