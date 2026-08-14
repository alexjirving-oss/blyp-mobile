/**
 * Creator earnings withdrawals (GEM → Stripe Connect Express and/or PayPal Payouts).
 * Purchased COIN balances are never cashable.
 */

import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import type { Knex } from 'knex';
import { getEconomyEnv } from '../config/economyEnv';
import { logger } from '../config/logger';
import {
  EconomyError,
  isStripeConnectSetupError,
  stripeConnectSetupRequiredError,
} from './economyErrors';
import { getEconomyInfra } from './infra';
import { creditWebStripeCoins, getWallet } from './economyService';
import { findWebCoinPack } from './webCoinCatalog';
import { assessWithdrawal, type KycStatus, type WithdrawalContext } from './withdrawalGuard';
import { WITHDRAWAL_POLICY as P } from './withdrawalPolicy';
import { isWithdrawLaunchTestUser } from './withdrawLaunchTest';
import {
  asReqList,
  deriveConnectFlags,
  humanizeConnectBlocker,
  type ConnectStatus,
} from './connectStatus';
import {
  getPayPalReadiness,
  isValidPaypalEmail,
  paypalConfigured,
  sendPaypalPayout,
} from './paypalPayouts';

export type { ConnectStatus } from './connectStatus';
export { deriveConnectFlags } from './connectStatus';

function mapStripeConnectError(err: any): never {
  if (isStripeConnectSetupError(err)) {
    throw stripeConnectSetupRequiredError(err);
  }
  // Preserve Stripe provider failures as actionable PROVIDER_ERROR (not opaque INTERNAL).
  const msg = typeof err?.message === 'string' ? err.message : 'Stripe Connect request failed';
  throw new EconomyError('PROVIDER_ERROR', 502, msg.slice(0, 280), {
    stripeType: err?.type || err?.rawType || null,
    stripeCode: err?.code || null,
  });
}

type StripeTransferFailureReason =
  | 'PLATFORM_BALANCE_INSUFFICIENT'
  | 'CONNECT_ACCOUNT_NOT_READY'
  | 'PAYOUT_BANK_REQUIRED'
  | 'PAYOUT_CURRENCY_UNSUPPORTED'
  | 'STRIPE_TRANSFER_FAILED';

type StripeTransferFailureDetail = {
  reason: StripeTransferFailureReason;
  userMessage: string;
  action: string;
  retryable: boolean;
  providerMessage: string;
  stripeType: string | null;
  stripeCode: string | null;
};

function describeStripeTransferFailure(
  err: any,
  gemsRestored = false,
): StripeTransferFailureDetail {
  const providerMessage = String(
    err?.raw?.message || err?.message || 'Stripe could not create the payout transfer',
  ).slice(0, 500);
  const normalized = providerMessage.toLowerCase();
  const restoredCopy = gemsRestored ? ' Your gems were restored.' : '';
  const common = {
    providerMessage,
    stripeType: String(err?.type || err?.rawType || err?.raw?.type || '').trim() || null,
    stripeCode: String(err?.code || err?.raw?.code || '').trim() || null,
  };

  if (/insufficient funds|insufficient.*balance|balance.*insufficient/.test(normalized)) {
    return {
      ...common,
      reason: 'PLATFORM_BALANCE_INSUFFICIENT',
      userMessage:
        `Blyp's Stripe payout balance is temporarily too low.${restoredCopy} Please retry after the payout balance is funded.`,
      action: 'Fund the Blyp Stripe GBP balance, then retry the withdrawal.',
      retryable: true,
    };
  }

  if (
    /external account|bank account|payout method/.test(normalized) &&
    /missing|required|invalid|disabled|not.*available|no /.test(normalized)
  ) {
    return {
      ...common,
      reason: 'PAYOUT_BANK_REQUIRED',
      userMessage:
        'Stripe needs a valid payout bank account. Open your Stripe payout details, add or fix the bank account, then retry.',
      action: 'Add or repair the connected Stripe bank account.',
      retryable: true,
    };
  }

  if (
    /currency/.test(normalized) &&
    /not supported|unsupported|cannot|invalid|does not support/.test(normalized)
  ) {
    return {
      ...common,
      reason: 'PAYOUT_CURRENCY_UNSUPPORTED',
      userMessage:
        'Your Stripe payout account cannot receive this GBP payout. Add a GBP-capable bank account in Stripe, then retry.',
      action: 'Configure a GBP-capable bank account for the connected Stripe account.',
      retryable: true,
    };
  }

  if (
    /account|destination|transfer|payout/.test(normalized) &&
    /disabled|not enabled|restricted|requirements|verification|cannot receive/.test(normalized)
  ) {
    return {
      ...common,
      reason: 'CONNECT_ACCOUNT_NOT_READY',
      userMessage:
        'Your Stripe payout account is not ready to receive funds. Open Stripe, finish any verification or payout requirements, then retry.',
      action: 'Complete the connected account payout requirements in Stripe.',
      retryable: true,
    };
  }

  return {
    ...common,
    reason: 'STRIPE_TRANSFER_FAILED',
    userMessage:
      `Stripe could not process this payout.${restoredCopy} Check your Stripe payout details, then try again or contact Blyp support.`,
    action: 'Check the connected Stripe account and retry, or contact Blyp support.',
    retryable: true,
  };
}

function stripeTransferProviderError(detail: StripeTransferFailureDetail): EconomyError {
  return new EconomyError('PROVIDER_ERROR', 502, detail.userMessage, {
    reason: detail.reason,
    userMessage: detail.userMessage,
    action: detail.action,
    retryable: detail.retryable,
    stripeType: detail.stripeType,
    stripeCode: detail.stripeCode,
  });
}

/** Stripe Account Links reject custom schemes (e.g. blyp://) with url_invalid. */
const DEFAULT_CONNECT_RETURN_URL = 'https://blyp.world/withdraw/connect-return';
const DEFAULT_CONNECT_REFRESH_URL = 'https://blyp.world/withdraw/connect-refresh';

function resolveStripeConnectHttpsUrl(
  requested: string | undefined,
  envValue: string | undefined,
  fallbackHttps: string,
): string {
  for (const candidate of [requested, envValue, fallbackHttps]) {
    const u = String(candidate || '').trim();
    if (/^https:\/\//i.test(u)) return u;
  }
  return fallbackHttps;
}

function connectStatusFromAccount(
  accountId: string,
  account: Stripe.Account,
): ConnectStatus {
  const req = account.requirements;
  return deriveConnectFlags({
    linked: true,
    stripeAccountId: accountId,
    payoutsEnabled: !!account.payouts_enabled,
    detailsSubmitted: !!account.details_submitted,
    chargesEnabled: !!account.charges_enabled,
    currentlyDue: asReqList(req?.currently_due),
    pastDue: asReqList(req?.past_due),
    pendingVerification: asReqList(req?.pending_verification),
    disabledReason: typeof req?.disabled_reason === 'string' ? req.disabled_reason : null,
  });
}

function stripeSecretConfigured(): boolean {
  return Boolean(String(getEconomyEnv().STRIPE_SECRET_KEY || '').trim());
}

/** Safe readiness for admin/ops — never returns key material. */
export type StripeKeyMode = 'absent' | 'test' | 'live' | 'unknown';

export function getStripeReadiness(): {
  secretConfigured: boolean;
  webhookConfigured: boolean;
  keyMode: StripeKeyMode;
  liveKeyPresent: boolean;
  connectRequired: true;
  note: string;
} {
  const env = getEconomyEnv();
  const secret = String(env.STRIPE_SECRET_KEY || '').trim();
  const webhook = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  let keyMode: StripeKeyMode = 'absent';
  if (secret) {
    if (secret.startsWith('sk_live_')) keyMode = 'live';
    else if (secret.startsWith('sk_test_')) keyMode = 'test';
    else keyMode = 'unknown';
  }
  const liveKeyPresent = keyMode === 'live';
  let note = 'Stripe secret not configured';
  if (keyMode === 'live' && webhook) {
    note = 'Live Stripe secret + webhook signing secret present (Connect Express payouts)';
  } else if (keyMode === 'live' && !webhook) {
    note = 'Live Stripe secret present but STRIPE_WEBHOOK_SECRET missing';
  } else if (keyMode === 'test') {
    note = 'Test Stripe secret (sk_test_) — replace with sk_live_ before enabling withdrawals';
  } else if (keyMode === 'unknown') {
    note = 'STRIPE_SECRET_KEY set but not a recognizable sk_live_/sk_test_ prefix';
  }
  return {
    secretConfigured: Boolean(secret),
    webhookConfigured: Boolean(webhook),
    keyMode,
    liveKeyPresent,
    connectRequired: true,
    note,
  };
}

/**
 * Kill-switch + settle-rail gate. ENABLE_WITHDRAWALS=1 alone is not enough —
 * at least one of Stripe secret or PayPal client credentials must be present
 * so we can settle (or queue for admin PayPal send when secrets exist).
 */
export function withdrawalsEnabled(): boolean {
  const env = getEconomyEnv();
  return (
    Number(env.ENABLE_WITHDRAWALS || 0) === 1 &&
    (stripeSecretConfigured() || paypalConfigured())
  );
}

function assertWithdrawalsEnabled() {
  if (Number(getEconomyEnv().ENABLE_WITHDRAWALS || 0) !== 1) {
    throw new EconomyError('WITHDRAWALS_DISABLED', 403, 'Withdrawals are disabled');
  }
  if (!stripeSecretConfigured() && !paypalConfigured()) {
    throw new EconomyError(
      'PAYOUT_RAIL_NOT_CONFIGURED',
      503,
      'No payout rail configured (Stripe or PayPal)',
    );
  }
  if (!withdrawalsEnabled()) {
    throw new EconomyError('WITHDRAWALS_DISABLED', 403, 'Withdrawals are disabled');
  }
}

function gemMinorUnits(): number {
  const env = getEconomyEnv();
  return Math.max(1, Number(env.WITHDRAW_GEM_MINOR_UNITS || env.WITHDRAW_COIN_MINOR_UNITS || 1));
}

function platformCurrency(): string {
  return String(getEconomyEnv().STRIPE_PLATFORM_CURRENCY || 'gbp').toLowerCase();
}

function getStripe(): Stripe {
  const key = String(getEconomyEnv().STRIPE_SECRET_KEY || '').trim();
  if (!key) {
    throw new EconomyError('STRIPE_NOT_CONFIGURED', 503, 'Stripe is not configured');
  }
  return new Stripe(key);
}

function feeSplit(amountGems: number) {
  const units = gemMinorUnits();
  const grossMinor = amountGems * units;
  const feeMinor = Math.floor((grossMinor * P.PLATFORM_FEE_PERCENT) / 100);
  const netMinor = grossMinor - feeMinor;
  const feeGems = Math.floor((amountGems * P.PLATFORM_FEE_PERCENT) / 100);
  const netGems = amountGems - feeGems;
  return { units, grossMinor, feeMinor, netMinor, feeGems, netGems };
}

async function ensureWalletRow(trx: Knex.Transaction, userId: string) {
  await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
  const row = await trx('wallets').where({ user_id: userId }).first();
  if (!row) throw new EconomyError('INTERNAL', 500, 'Wallet missing');
  return row;
}

/**
 * Withdrawable = cleared gem_available.
 * Self-funded purchased COIN is never included (gems come from gifts/earnings only).
 */
export async function computeWithdrawableGems(userId: string): Promise<{
  withdrawableGems: number;
  gemAvailable: number;
  gemPending: number;
  coinBalance: number;
  selfFundedCoins: number;
}> {
  const wallet = await getWallet(userId);
  const open = await getEconomyInfra()
    .db('withdrawal_requests')
    .where({ user_id: userId })
    .whereIn('status', ['pending', 'pending_review', 'processing'])
    .sum({ reserved: 'amount_gems' })
    .first();
  const reserved = Number(open?.reserved || 0);
  const available = Math.max(0, Math.floor(wallet.gemAvailable) - Math.max(0, reserved));
  return {
    withdrawableGems: available,
    gemAvailable: wallet.gemAvailable,
    gemPending: wallet.gemPending,
    coinBalance: wallet.coinBalance + wallet.bonusCoinBalance,
    // Purchased coins are never cashable; gems are earnings — treat self-funded cashable as 0.
    selfFundedCoins: 0,
  };
}

async function buildContext(
  userId: string,
  amountGems: number,
  claims: { emailVerified?: boolean },
): Promise<WithdrawalContext> {
  const { db } = getEconomyInfra();
  const now = Date.now();
  const bal = await computeWithdrawableGems(userId);
  const walletRow = await db('wallets').where({ user_id: userId }).first();
  const createdAt = walletRow?.created_at ? new Date(walletRow.created_at).getTime() : now;
  const payout = await db('payout_accounts').where({ user_id: userId }).first();
  const payoutCreated = payout?.created_at ? new Date(payout.created_at).getTime() : 0;

  const openRows = await db('withdrawal_requests')
    .where({ user_id: userId })
    .whereIn('status', ['pending', 'pending_review', 'processing'])
    .select('withdrawal_id', 'created_at', 'amount_gems', 'status');

  const recent = await db('withdrawal_requests')
    .where({ user_id: userId })
    .andWhere('created_at', '>=', new Date(now - 30 * 24 * 60 * 60 * 1000))
    .select('created_at', 'amount_gems', 'status');

  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

  let lastRequestAt: number | null = null;
  let requestsLast24h = 0;
  let requestsLast7d = 0;
  let paidOutLast24hCoins = 0;
  let paidOutLast7dCoins = 0;
  let paidOutLast30dCoins = 0;
  for (const r of recent) {
    const t = new Date(r.created_at).getTime();
    if (!lastRequestAt || t > lastRequestAt) lastRequestAt = t;
    if (t >= dayAgo) requestsLast24h += 1;
    if (t >= weekAgo) requestsLast7d += 1;
    if (String(r.status) === 'paid' || String(r.status) === 'processing') {
      const amt = Number(r.amount_gems || 0);
      if (t >= dayAgo) paidOutLast24hCoins += amt;
      if (t >= weekAgo) paidOutLast7dCoins += amt;
      if (t >= monthAgo) paidOutLast30dCoins += amt;
    }
  }

  const kycStatus: KycStatus =
    payout && payout.payouts_enabled && payout.details_submitted ? 'verified' : payout ? 'pending' : 'unverified';

  // Fraud / chargeback flags from admin console (user_admin_state.metadata.fraud).
  // Stripe dispute webhooks increment openChargebackCount; Play IAP chargebacks stay manual.
  let accountFrozen = false;
  let underFraudReview = false;
  let openChargebackCount = 0;
  try {
    const adminRow = await db('user_admin_state').where({ user_id: userId }).first();
    const meta =
      typeof adminRow?.metadata === 'string'
        ? JSON.parse(adminRow.metadata)
        : adminRow?.metadata && typeof adminRow.metadata === 'object'
          ? adminRow.metadata
          : {};
    const fraud = meta?.fraud && typeof meta.fraud === 'object' ? meta.fraud : {};
    accountFrozen = fraud.accountFrozen === true;
    underFraudReview = fraud.underFraudReview === true;
    openChargebackCount = Math.max(0, Math.floor(Number(fraud.openChargebackCount) || 0));
  } catch {
    // Prefer fail-open on missing admin table so withdraw path still works.
  }

  return {
    now,
    amountCoins: amountGems,
    withdrawableCoins: bal.withdrawableGems,
    accountAgeMs: Math.max(0, now - createdAt),
    emailVerified: !!claims.emailVerified,
    kycStatus,
    accountFrozen,
    underFraudReview,
    openChargebackCount,
    hasPayoutAccount: !!payout?.stripe_account_id,
    payoutAccountAgeMs: payoutCreated ? Math.max(0, now - payoutCreated) : 0,
    openRequestCount: openRows.length,
    lastRequestAt,
    requestsLast24h,
    requestsLast7d,
    paidOutLast24hCoins,
    paidOutLast7dCoins,
    paidOutLast30dCoins,
    selfFundedCoins: bal.selfFundedCoins,
    launchTestBypass: isWithdrawLaunchTestUser(userId),
  };
}

export async function getWithdrawEligibility(
  userId: string,
  claims: { emailVerified?: boolean } = {},
) {
  assertWithdrawalsEnabled();
  // Always re-fetch Stripe Connect flags before deciding Connect vs withdraw UI.
  // Relying on stale payout_accounts rows (webhook lag) caused a Connect loop.
  const connect = stripeSecretConfigured()
    ? await getConnectStatus(userId)
    : deriveConnectFlags({
        linked: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        chargesEnabled: false,
      });
  const bal = await computeWithdrawableGems(userId);
  const { db } = getEconomyInfra();
  const payoutRow = await db('payout_accounts').where({ user_id: userId }).first();
  const savedPaypalEmail = String(payoutRow?.paypal_email || '').trim().toLowerCase() || null;
  const paypalReady = paypalConfigured();
  const paypalReadiness = getPayPalReadiness();

  const previewAmount = Math.max(P.MIN_PAYOUT_COINS, Math.min(bal.withdrawableGems, P.MIN_PAYOUT_COINS));
  const ctx = await buildContext(userId, previewAmount > 0 ? previewAmount : P.MIN_PAYOUT_COINS, claims);
  // Stripe eligibility probe (Connect KYC).
  const stripeAssessment = assessWithdrawal({
    ...ctx,
    amountCoins: Math.min(Math.max(bal.withdrawableGems, 0), P.MIN_PAYOUT_COINS) || P.MIN_PAYOUT_COINS,
  });
  // PayPal probe: treat a saved/valid PayPal email as the payout destination + KYC rail.
  const paypalCtx: WithdrawalContext = {
    ...ctx,
    hasPayoutAccount: true,
    kycStatus: 'verified',
    payoutAccountAgeMs: Math.max(ctx.payoutAccountAgeMs, P.NEW_PAYOUT_ACCOUNT_HOLD_MS),
  };
  const paypalAssessment = assessWithdrawal({
    ...paypalCtx,
    amountCoins: Math.min(Math.max(bal.withdrawableGems, 0), P.MIN_PAYOUT_COINS) || P.MIN_PAYOUT_COINS,
  });

  const fee = feeSplit(P.MIN_PAYOUT_COINS);
  const connectBlocker = humanizeConnectBlocker(connect);
  const balanceOk = bal.withdrawableGems >= P.MIN_PAYOUT_COINS;

  return {
    enabled: true,
    currency: 'GEM',
    withdrawableGems: bal.withdrawableGems,
    gemAvailable: bal.gemAvailable,
    gemPending: bal.gemPending,
    purchasedCoinsNotCashable: bal.coinBalance,
    minPayoutGems: P.MIN_PAYOUT_COINS,
    platformFeePercent: P.PLATFORM_FEE_PERCENT,
    gemMinorUnits: gemMinorUnits(),
    fiatCurrency: platformCurrency(),
    holdDaysNormalUsers: Math.round(P.HOLD_DURATION_MS / (24 * 60 * 60 * 1000)),
    accountAgeDaysNormalUsers: Math.round(P.MIN_ACCOUNT_AGE_MS / (24 * 60 * 60 * 1000)),
    launchTestBypass: !!ctx.launchTestBypass,
    feePreviewMinPayout: {
      amountGems: P.MIN_PAYOUT_COINS,
      feeGems: fee.feeGems,
      netGems: fee.netGems,
      grossMinor: fee.grossMinor,
      feeMinor: fee.feeMinor,
      netMinor: fee.netMinor,
    },
    connect: {
      ...connect,
      blockerMessage: connectBlocker,
      stripeAvailable: stripeSecretConfigured(),
    },
    paypal: {
      available: true, // request path always accepted when withdrawals enabled; settle needs credentials or manual
      configured: paypalReady,
      mode: paypalReadiness.mode,
      note: paypalReadiness.note,
      savedEmail: savedPaypalEmail,
    },
    methods: [
      'paypal',
      ...(stripeSecretConfigured() ? (['stripe'] as const) : []),
    ],
    blockers: stripeAssessment.decision === 'deny' ? stripeAssessment.reasons : [],
    reviewReasons: stripeAssessment.decision === 'review' ? stripeAssessment.reasons : [],
    canRequest:
      balanceOk &&
      stripeAssessment.decision !== 'deny' &&
      !!connect.payoutsEnabled,
    canRequestPaypal:
      balanceOk && paypalAssessment.decision !== 'deny',
    policyCopy: {
      coinsNotCashable: true,
      gemsFromGiftsCashable: true,
      minPayoutGems: P.MIN_PAYOUT_COINS,
      platformFeePercent: P.PLATFORM_FEE_PERCENT,
      pendingHoldDays: Math.round(P.HOLD_DURATION_MS / (24 * 60 * 60 * 1000)),
    },
  };
}

export async function createConnectOnboardLink(
  userId: string,
  opts: { email?: string; returnUrl?: string; refreshUrl?: string } = {},
) {
  assertWithdrawalsEnabled();
  const stripe = getStripe();
  const { db } = getEconomyInfra();
  const env = getEconomyEnv();

  let row = await db('payout_accounts').where({ user_id: userId }).first();
  let accountId = row?.stripe_account_id as string | undefined;

  try {
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'GB',
        email: opts.email || undefined,
        capabilities: {
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: { blyp_user_id: userId },
      });
      accountId = account.id;
      await db('payout_accounts')
        .insert({
          user_id: userId,
          stripe_account_id: accountId,
          payouts_enabled: !!account.payouts_enabled,
          details_submitted: !!account.details_submitted,
          charges_enabled: !!account.charges_enabled,
          updated_at: db.fn.now(),
        })
        .onConflict('user_id')
        .merge({
          stripe_account_id: accountId,
          payouts_enabled: !!account.payouts_enabled,
          details_submitted: !!account.details_submitted,
          charges_enabled: !!account.charges_enabled,
          updated_at: db.fn.now(),
        });
    } else {
      // Existing Express account: refresh from Stripe and skip a new Account Link
      // when onboarding is already complete (breaks the Connect → return → Connect loop).
      const status = await getConnectStatus(userId);
      if (!status.needsOnboarding) {
        return {
          url: undefined as string | undefined,
          stripeAccountId: status.stripeAccountId || accountId,
          alreadyComplete: true as const,
          connect: status,
          expiresAt: undefined as number | undefined,
        };
      }
    }

    const returnUrl = resolveStripeConnectHttpsUrl(
      opts.returnUrl,
      env.STRIPE_CONNECT_RETURN_URL,
      DEFAULT_CONNECT_RETURN_URL,
    );
    const refreshUrl = resolveStripeConnectHttpsUrl(
      opts.refreshUrl,
      env.STRIPE_CONNECT_REFRESH_URL,
      DEFAULT_CONNECT_REFRESH_URL,
    );

    const link = await stripe.accountLinks.create({
      account: accountId!,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return {
      url: link.url as string | undefined,
      stripeAccountId: accountId,
      alreadyComplete: false as const,
      expiresAt: link.expires_at as number | undefined,
    };
  } catch (e: any) {
    if (e instanceof EconomyError) throw e;
    mapStripeConnectError(e);
  }
}

export async function getConnectStatus(userId: string): Promise<ConnectStatus> {
  assertWithdrawalsEnabled();
  const { db } = getEconomyInfra();
  const row = await db('payout_accounts').where({ user_id: userId }).first();
  if (!row?.stripe_account_id) {
    return deriveConnectFlags({
      linked: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      chargesEnabled: false,
    });
  }

  // PayPal-only deployments may still have legacy Connect rows — never call Stripe
  // when the secret is absent.
  if (!stripeSecretConfigured()) {
    return deriveConnectFlags({
      linked: true,
      stripeAccountId: row.stripe_account_id,
      payoutsEnabled: !!row.payouts_enabled,
      detailsSubmitted: !!row.details_submitted,
      chargesEnabled: !!row.charges_enabled,
    });
  }

  try {
    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(row.stripe_account_id);
    await db('payout_accounts')
      .where({ user_id: userId })
      .update({
        payouts_enabled: !!account.payouts_enabled,
        details_submitted: !!account.details_submitted,
        charges_enabled: !!account.charges_enabled,
        updated_at: db.fn.now(),
      });
    return connectStatusFromAccount(row.stripe_account_id, account);
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e) }, '[withdraw] connect status refresh failed');
    return deriveConnectFlags({
      linked: true,
      stripeAccountId: row.stripe_account_id,
      payoutsEnabled: !!row.payouts_enabled,
      detailsSubmitted: !!row.details_submitted,
      chargesEnabled: !!row.charges_enabled,
    });
  }
}

export async function requestWithdrawal(
  userId: string,
  input: { amountGems: number; idempotencyKey: string; method?: 'stripe' | 'paypal'; paypalEmail?: string },
  claims: { emailVerified?: boolean } = {},
) {
  assertWithdrawalsEnabled();
  const amountGems = Math.floor(Number(input.amountGems));
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  const method = input.method === 'paypal' ? 'paypal' : 'stripe';
  const paypalEmail = String(input.paypalEmail || '').trim().toLowerCase();
  if (!idempotencyKey) {
    throw new EconomyError('INVALID_INPUT', 400, 'idempotencyKey required');
  }
  if (!Number.isFinite(amountGems) || amountGems <= 0) {
    throw new EconomyError('INVALID_INPUT', 400, 'amountGems invalid');
  }
  if (method === 'paypal') {
    if (!isValidPaypalEmail(paypalEmail)) {
      throw new EconomyError('INVALID_INPUT', 400, 'Valid paypalEmail required');
    }
  } else if (!stripeSecretConfigured()) {
    throw new EconomyError(
      'STRIPE_NOT_CONFIGURED',
      503,
      'Stripe bank withdraw is unavailable — use PayPal',
    );
  }

  const { db } = getEconomyInfra();
  const existing = await db('withdrawal_requests')
    .where({ user_id: userId, idempotency_key: idempotencyKey })
    .first();
  if (existing) {
    return {
      kind: 'replay' as const,
      response: {
        withdrawalId: existing.withdrawal_id,
        status: existing.status,
        amountGems: Number(existing.amount_gems),
        feeGems: Number(existing.fee_gems),
        netGems: Number(existing.net_gems),
        netMinor: Number(existing.net_minor),
        currency: existing.currency,
        reasons: existing.reasons,
        method: existing.payout_method || 'stripe',
      },
    };
  }

  let stripeAccountId: string | null = null;
  if (method === 'stripe') {
    await getConnectStatus(userId).catch(() => undefined);
  }

  const baseCtx = await buildContext(userId, amountGems, claims);
  const ctx: WithdrawalContext =
    method === 'paypal'
      ? {
          ...baseCtx,
          hasPayoutAccount: true,
          kycStatus: 'verified',
          payoutAccountAgeMs: Math.max(baseCtx.payoutAccountAgeMs, P.NEW_PAYOUT_ACCOUNT_HOLD_MS),
        }
      : baseCtx;
  const assessment = assessWithdrawal(ctx);
  if (assessment.decision === 'deny') {
    throw new EconomyError('WITHDRAWAL_DENIED', 403, 'Withdrawal denied', {
      reasons: assessment.reasons,
    });
  }

  const splits = feeSplit(amountGems);
  if (method === 'stripe') {
    const payout = await db('payout_accounts').where({ user_id: userId }).first();
    if (!payout?.stripe_account_id) {
      throw new EconomyError('WITHDRAWAL_DENIED', 403, 'No payout account', {
        reasons: ['NO_PAYOUT_ACCOUNT'],
      });
    }
    if (!payout.payouts_enabled) {
      throw new EconomyError('WITHDRAWAL_DENIED', 403, 'Stripe payouts not enabled', {
        reasons: ['KYC_NOT_VERIFIED'],
      });
    }
    stripeAccountId = String(payout.stripe_account_id);
  } else {
    await db('payout_accounts')
      .insert({
        user_id: userId,
        stripe_account_id: null,
        paypal_email: paypalEmail,
        payouts_enabled: false,
        details_submitted: false,
        charges_enabled: false,
        updated_at: db.fn.now(),
      })
      .onConflict('user_id')
      .merge({
        paypal_email: paypalEmail,
        updated_at: db.fn.now(),
      });
  }

  const withdrawalId = randomUUID();
  const status =
    method === 'paypal' || assessment.requiresManualReview ? 'pending_review' : 'processing';

  await db.transaction(async (trx) => {
    const wallet = await ensureWalletRow(trx, userId);
    const available = BigInt(wallet.gem_available || 0);
    const need = BigInt(amountGems);
    if (available < need) {
      throw new EconomyError('INSUFFICIENT_FUNDS', 402, 'Insufficient withdrawable gems');
    }

    await trx('wallets')
      .where({ user_id: userId })
      .update({
        gem_available: (available - need).toString(),
        updated_at: trx.fn.now(),
      });

    await trx('ledger_entries').insert({
      ledger_id: randomUUID(),
      user_id: userId,
      entry_type: 'WITHDRAWAL_RESERVE',
      currency: 'GEM',
      amount: (-need).toString(),
      status: 'POSTED',
      reference_type: 'WITHDRAWAL',
      reference_id: withdrawalId,
      idempotency_key: `withdraw-reserve:${userId}:${idempotencyKey}`,
      metadata: trx.raw('?::jsonb', [
        JSON.stringify({ withdrawalId, status, reasons: assessment.reasons, method }),
      ]),
    });

    await trx('withdrawal_requests').insert({
      withdrawal_id: withdrawalId,
      user_id: userId,
      amount_gems: amountGems.toString(),
      fee_gems: splits.feeGems.toString(),
      net_gems: splits.netGems.toString(),
      gross_minor: splits.grossMinor.toString(),
      fee_minor: splits.feeMinor.toString(),
      net_minor: splits.netMinor.toString(),
      currency: platformCurrency(),
      status,
      reasons: trx.raw('?::jsonb', [JSON.stringify(assessment.reasons)]),
      stripe_account_id: stripeAccountId,
      payout_method: method,
      paypal_email: method === 'paypal' ? paypalEmail : null,
      idempotency_key: idempotencyKey,
      metadata: trx.raw('?::jsonb', [
        JSON.stringify({
          requiresManualReview: method === 'paypal' ? true : assessment.requiresManualReview,
          method,
          paypalEmail: method === 'paypal' ? paypalEmail : undefined,
        }),
      ]),
    });
  });

  if (status === 'pending_review') {
    return {
      kind: 'ok' as const,
      response: {
        withdrawalId,
        status,
        amountGems,
        feeGems: splits.feeGems,
        netGems: splits.netGems,
        netMinor: splits.netMinor,
        currency: platformCurrency(),
        reasons: assessment.reasons,
        method,
      },
    };
  }

  try {
    const settled = await settleStripeTransfer({
      withdrawalId,
      userId,
      amountGems,
      netMinor: splits.netMinor,
      stripeAccountId: stripeAccountId!,
      idempotencyKey,
    });
    return {
      kind: 'ok' as const,
      response: {
        withdrawalId,
        status: 'paid',
        amountGems,
        feeGems: splits.feeGems,
        netGems: splits.netGems,
        netMinor: splits.netMinor,
        currency: platformCurrency(),
        stripeTransferId: settled.stripeTransferId,
        reasons: assessment.reasons,
        method,
      },
    };
  } catch (e: any) {
    const provider = describeStripeTransferFailure(e, true);
    logger.error(
      {
        err: provider.providerMessage,
        providerReason: provider.reason,
        stripeType: provider.stripeType,
        stripeCode: provider.stripeCode,
        withdrawalId,
      },
      '[withdraw] stripe transfer failed',
    );
    await reverseWithdrawalReserve({
      withdrawalId,
      userId,
      amountGems,
      idempotencyKey,
      error: provider.providerMessage,
      nextStatus: 'failed',
    });
    throw stripeTransferProviderError(provider);
  }
}

async function settleStripeTransfer(input: {
  withdrawalId: string;
  userId: string;
  amountGems: number;
  netMinor: number;
  stripeAccountId: string;
  idempotencyKey: string;
}) {
  const { db } = getEconomyInfra();
  const stripe = getStripe();
  const transfer = await stripe.transfers.create(
    {
      amount: input.netMinor,
      currency: platformCurrency(),
      destination: input.stripeAccountId,
      transfer_group: input.withdrawalId,
      metadata: {
        blyp_user_id: input.userId,
        withdrawal_id: input.withdrawalId,
        amount_gems: String(input.amountGems),
      },
    },
    { idempotencyKey: `blyp-withdraw-${input.idempotencyKey}` },
  );

  await db('withdrawal_requests')
    .where({ withdrawal_id: input.withdrawalId })
    .update({
      status: 'paid',
      stripe_transfer_id: transfer.id,
      settled_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

  await db('ledger_entries').insert({
    ledger_id: randomUUID(),
    user_id: input.userId,
    entry_type: 'WITHDRAWAL_SETTLEMENT',
    currency: 'GEM',
    amount: '0',
    status: 'POSTED',
    reference_type: 'WITHDRAWAL',
    reference_id: input.withdrawalId,
    idempotency_key: `withdraw-settle:${input.userId}:${input.idempotencyKey}`,
    metadata: db.raw('?::jsonb', [
      JSON.stringify({ stripeTransferId: transfer.id, netMinor: input.netMinor }),
    ]),
  });

  return { stripeTransferId: transfer.id };
}

async function reverseWithdrawalReserve(input: {
  withdrawalId: string;
  userId: string;
  amountGems: number;
  idempotencyKey: string;
  error?: string;
  nextStatus: 'failed' | 'rejected';
  actorUserId?: string;
  reason?: string;
}) {
  const { db } = getEconomyInfra();
  await db.transaction(async (trx) => {
    const wallet = await ensureWalletRow(trx, input.userId);
    await trx('wallets')
      .where({ user_id: input.userId })
      .update({
        gem_available: (BigInt(wallet.gem_available || 0) + BigInt(input.amountGems)).toString(),
        updated_at: trx.fn.now(),
      });
    await trx('withdrawal_requests')
      .where({ withdrawal_id: input.withdrawalId })
      .update({
        status: input.nextStatus,
        updated_at: trx.fn.now(),
        metadata: trx.raw(
          `COALESCE(metadata, '{}'::jsonb) || ?::jsonb`,
          [
            JSON.stringify({
              ...(input.actorUserId ? { reviewedBy: input.actorUserId } : {}),
              ...(input.reason ? { rejectReason: input.reason } : {}),
              ...(input.error ? { error: input.error } : {}),
              reviewedAt: new Date().toISOString(),
            }),
          ],
        ),
      });
    await trx('ledger_entries').insert({
      ledger_id: randomUUID(),
      user_id: input.userId,
      entry_type: input.nextStatus === 'rejected' ? 'WITHDRAWAL_REJECT' : 'WITHDRAWAL_REVERSE',
      currency: 'GEM',
      amount: input.amountGems.toString(),
      status: 'POSTED',
      reference_type: 'WITHDRAWAL',
      reference_id: input.withdrawalId,
      idempotency_key: `withdraw-${input.nextStatus}:${input.userId}:${input.idempotencyKey}`,
      metadata: trx.raw('?::jsonb', [
        JSON.stringify({
          error: input.error || null,
          actorUserId: input.actorUserId || null,
          reason: input.reason || null,
        }),
      ]),
    });
  });
}

function mapWithdrawalRow(row: any) {
  return {
    withdrawalId: String(row.withdrawal_id),
    userId: String(row.user_id),
    amountGems: Number(row.amount_gems),
    feeGems: Number(row.fee_gems),
    netGems: Number(row.net_gems),
    netMinor: Number(row.net_minor),
    currency: String(row.currency || platformCurrency()),
    status: String(row.status),
    reasons: row.reasons,
    method: String(row.payout_method || row.metadata?.method || 'stripe'),
    paypalEmail: row.paypal_email || row.metadata?.paypalEmail || null,
    paypalPayoutBatchId: row.paypal_payout_batch_id || null,
    stripeAccountId: row.stripe_account_id || null,
    stripeTransferId: row.stripe_transfer_id || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
    metadata: row.metadata || {},
  };
}

/** Ops: list withdrawal requests (default: pending_review queue). */
export async function listWithdrawals(opts: {
  status?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const { db } = getEconomyInfra();
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const status = String(opts.status || 'pending_review').trim();

  let q = db('withdrawal_requests').select('*').orderBy('created_at', 'desc').limit(limit).offset(offset);
  if (status && status !== 'all') {
    q = q.where({ status });
  }
  const rows = await q;
  return { items: rows.map(mapWithdrawalRow), limit, offset, status };
}

/**
 * Ops: approve a pending_review withdrawal and settle via Stripe or PayPal.
 * Gems were already reserved at request time.
 */
export async function approveWithdrawal(withdrawalId: string, actorUserId: string) {
  const { db } = getEconomyInfra();
  const id = String(withdrawalId || '').trim();
  if (!id) throw new EconomyError('INVALID_INPUT', 400, 'withdrawalId required');

  const row = await db('withdrawal_requests').where({ withdrawal_id: id }).first();
  if (!row) throw new EconomyError('NOT_FOUND', 404, 'Withdrawal not found');
  if (String(row.status) === 'paid') {
    return mapWithdrawalRow(row);
  }
  if (String(row.status) !== 'pending_review') {
    throw new EconomyError('INVALID_STATE', 409, `Cannot approve status=${row.status}`);
  }

  const method =
    String(row.payout_method || row.metadata?.method || 'stripe').toLowerCase() === 'paypal'
      ? 'paypal'
      : 'stripe';
  const paypalEmail = String(row.paypal_email || row.metadata?.paypalEmail || '').trim().toLowerCase();

  if (method === 'stripe') {
    if (!row.stripe_account_id) {
      throw new EconomyError('WITHDRAWAL_DENIED', 403, 'No payout account on request');
    }
    if (!stripeSecretConfigured()) {
      throw new EconomyError('STRIPE_NOT_CONFIGURED', 503, 'Stripe is not configured');
    }
  } else if (!isValidPaypalEmail(paypalEmail)) {
    throw new EconomyError('WITHDRAWAL_DENIED', 403, 'No PayPal email on request');
  }

  await db('withdrawal_requests')
    .where({ withdrawal_id: id })
    .update({
      status: 'processing',
      updated_at: db.fn.now(),
      metadata: db.raw(`COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, [
        JSON.stringify({
          approvedBy: actorUserId,
          approvedAt: new Date().toISOString(),
          method,
        }),
      ]),
    });

  const amountGems = Number(row.amount_gems);
  const netMinor = Number(row.net_minor);
  const idempotencyKey = String(row.idempotency_key);

  if (method === 'paypal') {
    try {
      const settled = await settlePaypalTransfer({
        withdrawalId: id,
        userId: row.user_id,
        amountGems,
        netMinor,
        paypalEmail,
        currency: String(row.currency || platformCurrency()),
        idempotencyKey: `approve:${idempotencyKey}`,
        actorUserId,
      });
      const updated = await db('withdrawal_requests').where({ withdrawal_id: id }).first();
      return {
        ...mapWithdrawalRow(updated || row),
        status: 'paid',
        paypalPayoutBatchId: settled.batchId,
      };
    } catch (e: any) {
      const detail = e instanceof EconomyError ? e.detail : null;
      const msg = e?.message || String(e);
      logger.error(
        { err: msg, detail, withdrawalId: id },
        '[withdraw] admin approve PayPal payout failed',
      );
      await db('withdrawal_requests')
        .where({ withdrawal_id: id })
        .update({
          status: 'pending_review',
          updated_at: db.fn.now(),
          metadata: db.raw(`COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, [
            JSON.stringify({
              lastApproveError: msg,
              lastApproveErrorReason: detail?.reason || 'PAYPAL_PAYOUT_FAILED',
              lastApproveAttemptAt: new Date().toISOString(),
              lastApproveBy: actorUserId,
              manualPaypalHint:
                'If Payouts API is not enabled yet: send GBP via PayPal Business to paypalEmail, then POST /admin/withdrawals/:id/mark-paid-manual',
            }),
          ]),
        });
      if (e instanceof EconomyError) throw e;
      throw new EconomyError('PROVIDER_ERROR', 502, msg);
    }
  }

  try {
    const settled = await settleStripeTransfer({
      withdrawalId: id,
      userId: row.user_id,
      amountGems,
      netMinor,
      stripeAccountId: row.stripe_account_id,
      idempotencyKey: `approve:${idempotencyKey}`,
    });
    const updated = await db('withdrawal_requests').where({ withdrawal_id: id }).first();
    return {
      ...mapWithdrawalRow(updated || row),
      status: 'paid',
      stripeTransferId: settled.stripeTransferId,
    };
  } catch (e: any) {
    const provider = describeStripeTransferFailure(e);
    logger.error(
      {
        err: provider.providerMessage,
        providerReason: provider.reason,
        stripeType: provider.stripeType,
        stripeCode: provider.stripeCode,
        withdrawalId: id,
      },
      '[withdraw] admin approve transfer failed',
    );
    await db('withdrawal_requests')
      .where({ withdrawal_id: id })
      .update({
        status: 'pending_review',
        updated_at: db.fn.now(),
        metadata: db.raw(`COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, [
          JSON.stringify({
            lastApproveError: provider.providerMessage,
            lastApproveErrorReason: provider.reason,
            lastApproveAttemptAt: new Date().toISOString(),
            lastApproveBy: actorUserId,
          }),
        ]),
      });
    throw stripeTransferProviderError(provider);
  }
}

/** Ops: mark a PayPal (or other) pending_review withdrawal paid after a manual send. */
export async function markWithdrawalPaidManual(
  withdrawalId: string,
  actorUserId: string,
  opts: { note?: string; externalReference?: string } = {},
) {
  const { db } = getEconomyInfra();
  const id = String(withdrawalId || '').trim();
  if (!id) throw new EconomyError('INVALID_INPUT', 400, 'withdrawalId required');
  const row = await db('withdrawal_requests').where({ withdrawal_id: id }).first();
  if (!row) throw new EconomyError('NOT_FOUND', 404, 'Withdrawal not found');
  if (String(row.status) === 'paid') return mapWithdrawalRow(row);
  if (String(row.status) !== 'pending_review' && String(row.status) !== 'processing') {
    throw new EconomyError('INVALID_STATE', 409, `Cannot mark-paid status=${row.status}`);
  }

  await db('withdrawal_requests')
    .where({ withdrawal_id: id })
    .update({
      status: 'paid',
      settled_at: db.fn.now(),
      updated_at: db.fn.now(),
      metadata: db.raw(`COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, [
        JSON.stringify({
          paidManually: true,
          paidManuallyBy: actorUserId,
          paidManuallyAt: new Date().toISOString(),
          note: opts.note || null,
          externalReference: opts.externalReference || null,
        }),
      ]),
    });

  await db('ledger_entries')
    .insert({
      ledger_id: randomUUID(),
      user_id: row.user_id,
      entry_type: 'WITHDRAWAL_SETTLEMENT',
      currency: 'GEM',
      amount: '0',
      status: 'POSTED',
      reference_type: 'WITHDRAWAL',
      reference_id: id,
      idempotency_key: `withdraw-settle-manual:${row.user_id}:${row.idempotency_key}`,
      metadata: db.raw('?::jsonb', [
        JSON.stringify({
          method: row.payout_method || 'paypal',
          manual: true,
          netMinor: Number(row.net_minor),
          externalReference: opts.externalReference || null,
        }),
      ]),
    })
    .onConflict('idempotency_key')
    .ignore();

  const updated = await db('withdrawal_requests').where({ withdrawal_id: id }).first();
  return mapWithdrawalRow(updated || row);
}

async function settlePaypalTransfer(input: {
  withdrawalId: string;
  userId: string;
  amountGems: number;
  netMinor: number;
  paypalEmail: string;
  currency: string;
  idempotencyKey: string;
  actorUserId: string;
}) {
  const { db } = getEconomyInfra();
  const payout = await sendPaypalPayout({
    withdrawalId: input.withdrawalId,
    paypalEmail: input.paypalEmail,
    amountMinor: input.netMinor,
    currency: input.currency,
    note: `Blyp gems withdrawal ${input.withdrawalId}`,
  });

  await db('withdrawal_requests')
    .where({ withdrawal_id: input.withdrawalId })
    .update({
      status: 'paid',
      paypal_payout_batch_id: payout.batchId,
      settled_at: db.fn.now(),
      updated_at: db.fn.now(),
      metadata: db.raw(`COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, [
        JSON.stringify({
          paypalBatchStatus: payout.status,
          paypalSettledBy: input.actorUserId,
        }),
      ]),
    });

  await db('ledger_entries').insert({
    ledger_id: randomUUID(),
    user_id: input.userId,
    entry_type: 'WITHDRAWAL_SETTLEMENT',
    currency: 'GEM',
    amount: '0',
    status: 'POSTED',
    reference_type: 'WITHDRAWAL',
    reference_id: input.withdrawalId,
    idempotency_key: `withdraw-settle:${input.userId}:${input.idempotencyKey}`,
    metadata: db.raw('?::jsonb', [
      JSON.stringify({
        method: 'paypal',
        paypalPayoutBatchId: payout.batchId,
        netMinor: input.netMinor,
        paypalEmail: input.paypalEmail,
      }),
    ]),
  });

  return { batchId: payout.batchId, status: payout.status };
}

/** Ops: reject pending_review and restore reserved gems. */
export async function rejectWithdrawal(
  withdrawalId: string,
  actorUserId: string,
  reason?: string,
) {
  const { db } = getEconomyInfra();
  const id = String(withdrawalId || '').trim();
  if (!id) throw new EconomyError('INVALID_INPUT', 400, 'withdrawalId required');

  const row = await db('withdrawal_requests').where({ withdrawal_id: id }).first();
  if (!row) throw new EconomyError('NOT_FOUND', 404, 'Withdrawal not found');
  if (String(row.status) === 'rejected') {
    return mapWithdrawalRow(row);
  }
  if (String(row.status) !== 'pending_review') {
    throw new EconomyError('INVALID_STATE', 409, `Cannot reject status=${row.status}`);
  }

  await reverseWithdrawalReserve({
    withdrawalId: id,
    userId: row.user_id,
    amountGems: Number(row.amount_gems),
    idempotencyKey: String(row.idempotency_key),
    nextStatus: 'rejected',
    actorUserId,
    reason: reason ? String(reason).slice(0, 500) : undefined,
  });

  const updated = await db('withdrawal_requests').where({ withdrawal_id: id }).first();
  return mapWithdrawalRow(updated || { ...row, status: 'rejected' });
}

async function resolveUserIdForStripeEvent(input: {
  connectAccountId?: string | null;
  metadataUserId?: string | null;
  stripe?: Stripe;
}): Promise<string | null> {
  const { db } = getEconomyInfra();
  const metaUid = String(input.metadataUserId || '').trim();
  if (metaUid) return metaUid;
  const accountId = String(input.connectAccountId || '').trim();
  if (!accountId) return null;
  const row = await db('payout_accounts').where({ stripe_account_id: accountId }).first();
  if (row?.user_id) return String(row.user_id);
  if (input.stripe) {
    try {
      const account = await input.stripe.accounts.retrieve(accountId);
      const fromMeta = String(account.metadata?.blyp_user_id || '').trim();
      if (fromMeta) return fromMeta;
    } catch (e: any) {
      logger.warn(
        { err: e?.message || String(e), accountId },
        '[stripe-webhook] account retrieve for user map failed',
      );
    }
  }
  return null;
}

/**
 * Apply Stripe dispute / early-fraud signals onto user_admin_state.metadata.fraud
 * so WithdrawalGuard BLOCK_IF_OPEN_CHARGEBACK can deny cash-out.
 */
async function applyStripeChargebackSignal(input: {
  userId: string;
  disputeId: string;
  eventType: string;
  status?: string | null;
  closing: boolean;
}) {
  const { setUserFraudFlags, getUserFraudFlags } = await import('../admin/adminDeferredOps');
  const current = await getUserFraudFlags(input.userId);
  let nextCount = current.openChargebackCount;
  if (input.closing) {
    nextCount = Math.max(0, current.openChargebackCount - 1);
  } else {
    nextCount = Math.min(99, current.openChargebackCount + 1);
  }
  const note = input.closing
    ? `Stripe ${input.eventType} closed ${input.disputeId}${input.status ? ` (${input.status})` : ''}`
    : `Stripe ${input.eventType} ${input.disputeId}${input.status ? ` (${input.status})` : ''}`;
  await setUserFraudFlags({
    actorUserId: 'stripe_webhook',
    userId: input.userId,
    openChargebackCount: nextCount,
    underFraudReview: nextCount > 0 ? true : current.underFraudReview,
    note: note.slice(0, 500),
  });
  logger.info(
    { userId: input.userId, disputeId: input.disputeId, eventType: input.eventType, openChargebackCount: nextCount },
    '[stripe-webhook] chargeback signal applied',
  );
}

export async function handleStripeWebhook(rawBody: Buffer, signature: string | undefined) {
  const env = getEconomyEnv();
  const secret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!secret || !key) {
    throw new EconomyError('STRIPE_NOT_CONFIGURED', 503, 'Stripe webhook not configured');
  }
  const stripe = new Stripe(key);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, String(signature || ''), secret);
  } catch (e: any) {
    throw new EconomyError('VERIFICATION_FAILED', 400, 'Invalid Stripe signature', {
      detail: e?.message || String(e),
    });
  }

  const { db } = getEconomyInfra();
  const connectAccountId =
    typeof (event as { account?: string }).account === 'string'
      ? String((event as { account?: string }).account)
      : null;

  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account;
    await db('payout_accounts')
      .where({ stripe_account_id: account.id })
      .update({
        payouts_enabled: !!account.payouts_enabled,
        details_submitted: !!account.details_submitted,
        charges_enabled: !!account.charges_enabled,
        updated_at: db.fn.now(),
      });
  }

  // blyp.world Stripe Checkout → credit base + web +15% bonus coins (idempotent).
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const meta = session.metadata || {};
    const source = String(meta.source || '').trim();
    const packId = String(meta.packId || '').trim();
    const userId = String(meta.userId || session.client_reference_id || '').trim();
    const paid =
      session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    if (source === 'blyp-world' && packId && userId && paid) {
      if (!findWebCoinPack(packId)) {
        logger.warn(
          { packId, sessionId: session.id },
          '[stripe-webhook] unknown web pack — skipped credit',
        );
      } else {
        try {
          const out = await creditWebStripeCoins({
            userId,
            packId,
            stripeSessionId: session.id,
          });
          logger.info(
            {
              userId,
              packId,
              sessionId: session.id,
              kind: out.kind,
              granted: out.granted,
              baseCoins: out.baseCoins,
              bonusCoins: out.bonusCoins,
            },
            '[stripe-webhook] web coin pack credited',
          );
        } catch (e: any) {
          logger.error(
            { err: e?.message || String(e), userId, packId, sessionId: session.id },
            '[stripe-webhook] web coin credit failed',
          );
          throw e;
        }
      }
    } else if (source === 'blyp-world' || packId.startsWith('web.coinpack.')) {
      logger.warn(
        {
          sessionId: session.id,
          source: source || null,
          packId: packId || null,
          hasUserId: !!userId,
          paymentStatus: session.payment_status,
        },
        '[stripe-webhook] blyp-world checkout completed but credit skipped (missing fields or unpaid)',
      );
    }
  }

  if (event.type === 'transfer.created' || event.type === 'transfer.updated') {
    const transfer = event.data.object as Stripe.Transfer;
    const withdrawalId = transfer.metadata?.withdrawal_id;
    if (withdrawalId) {
      await db('withdrawal_requests')
        .where({ withdrawal_id: withdrawalId })
        .whereIn('status', ['processing', 'pending'])
        .update({
          status: 'paid',
          stripe_transfer_id: transfer.id,
          settled_at: db.fn.now(),
          updated_at: db.fn.now(),
        });
    }
  }

  // Some Stripe API versions omit transfer.failed from the Event union — compare as string.
  if (String(event.type) === 'transfer.failed' || String(event.type) === 'transfer.reversed') {
    const transfer = event.data.object as Stripe.Transfer;
    const withdrawalId = transfer.metadata?.withdrawal_id;
    if (withdrawalId) {
      const row = await db('withdrawal_requests').where({ withdrawal_id: withdrawalId }).first();
      if (row && row.status !== 'failed' && row.status !== 'reversed') {
        await db.transaction(async (trx) => {
          const wallet = await ensureWalletRow(trx, row.user_id);
          const amountGems = BigInt(row.amount_gems || 0);
          await trx('wallets')
            .where({ user_id: row.user_id })
            .update({
              gem_available: (BigInt(wallet.gem_available || 0) + amountGems).toString(),
              updated_at: trx.fn.now(),
            });
          await trx('withdrawal_requests')
            .where({ withdrawal_id: withdrawalId })
            .update({ status: 'failed', updated_at: trx.fn.now() });
        });
      }
    }
  }

  // Chargeback / dispute ingest (Stripe). Play Billing chargebacks remain manual via admin.
  const disputeTypes = new Set([
    'charge.dispute.created',
    'charge.dispute.updated',
    'charge.dispute.closed',
    'charge.dispute.funds_withdrawn',
    'charge.dispute.funds_reinstated',
  ]);
  if (disputeTypes.has(String(event.type))) {
    const dispute = event.data.object as Stripe.Dispute;
    const metaUid =
      (dispute.metadata && (dispute.metadata.blyp_user_id || dispute.metadata.user_id)) || null;
    const userId = await resolveUserIdForStripeEvent({
      connectAccountId,
      metadataUserId: metaUid,
      stripe,
    });
    if (!userId) {
      logger.warn(
        { type: event.type, disputeId: dispute.id, connectAccountId },
        '[stripe-webhook] dispute with no mapped Blyp user — skipped fraud flag',
      );
    } else {
      const typeStr = String(event.type);
      const closing =
        typeStr === 'charge.dispute.closed' ||
        typeStr === 'charge.dispute.funds_reinstated' ||
        String(dispute.status) === 'won';
      // Only bump on create / funds_withdrawn; ignore noisy .updated to avoid double-count.
      const shouldMutate =
        closing ||
        typeStr === 'charge.dispute.created' ||
        typeStr === 'charge.dispute.funds_withdrawn';
      if (shouldMutate) {
        try {
          await applyStripeChargebackSignal({
            userId,
            disputeId: dispute.id,
            eventType: typeStr,
            status: dispute.status ? String(dispute.status) : null,
            closing,
          });
        } catch (e: any) {
          logger.error(
            { err: e?.message || String(e), userId, disputeId: dispute.id },
            '[stripe-webhook] dispute flag failed',
          );
        }
      }
    }
  }

  if (String(event.type) === 'radar.early_fraud_warning.created') {
    const efw = event.data.object as { id?: string; charge?: string; metadata?: Record<string, string> };
    const metaUid = efw.metadata?.blyp_user_id || efw.metadata?.user_id || null;
    const userId = await resolveUserIdForStripeEvent({
      connectAccountId,
      metadataUserId: metaUid,
      stripe,
    });
    if (userId) {
      try {
        await applyStripeChargebackSignal({
          userId,
          disputeId: String(efw.id || efw.charge || 'efw'),
          eventType: 'radar.early_fraud_warning.created',
          status: 'warning',
          closing: false,
        });
      } catch (e: any) {
        logger.error({ err: e?.message || String(e), userId }, '[stripe-webhook] efw flag failed');
      }
    }
  }

  return { received: true, type: event.type };
}
