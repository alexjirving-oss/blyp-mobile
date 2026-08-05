/**
 * Creator earnings withdrawals (GEM → Stripe Connect Express).
 * Purchased COIN balances are never cashable.
 */

import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import type { Knex } from 'knex';
import { getEconomyEnv } from '../config/economyEnv';
import { logger } from '../config/logger';
import { EconomyError } from './economyErrors';
import { getEconomyInfra } from './infra';
import { getWallet } from './economyService';
import { assessWithdrawal, type KycStatus, type WithdrawalContext } from './withdrawalGuard';
import { WITHDRAWAL_POLICY as P } from './withdrawalPolicy';

function stripeSecretConfigured(): boolean {
  return Boolean(String(getEconomyEnv().STRIPE_SECRET_KEY || '').trim());
}

/**
 * Kill-switch + Stripe gate. ENABLE_WITHDRAWALS=1 alone is not enough —
 * a missing/empty STRIPE_SECRET_KEY keeps cash-out closed so we never
 * accept requests we cannot settle.
 */
export function withdrawalsEnabled(): boolean {
  const env = getEconomyEnv();
  return Number(env.ENABLE_WITHDRAWALS || 0) === 1 && stripeSecretConfigured();
}

function assertWithdrawalsEnabled() {
  if (Number(getEconomyEnv().ENABLE_WITHDRAWALS || 0) === 1 && !stripeSecretConfigured()) {
    throw new EconomyError('STRIPE_NOT_CONFIGURED', 503, 'Stripe is not configured');
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

  return {
    now,
    amountCoins: amountGems,
    withdrawableCoins: bal.withdrawableGems,
    accountAgeMs: Math.max(0, now - createdAt),
    emailVerified: !!claims.emailVerified,
    kycStatus,
    accountFrozen: false,
    underFraudReview: false,
    openChargebackCount: 0,
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
  };
}

export async function getWithdrawEligibility(
  userId: string,
  claims: { emailVerified?: boolean } = {},
) {
  assertWithdrawalsEnabled();
  const bal = await computeWithdrawableGems(userId);
  const previewAmount = Math.max(P.MIN_PAYOUT_COINS, Math.min(bal.withdrawableGems, P.MIN_PAYOUT_COINS));
  const ctx = await buildContext(userId, previewAmount > 0 ? previewAmount : P.MIN_PAYOUT_COINS, claims);
  const assessment = assessWithdrawal({
    ...ctx,
    // Eligibility probe: use min payout against current cashable balance.
    amountCoins: Math.min(Math.max(bal.withdrawableGems, 0), P.MIN_PAYOUT_COINS) || P.MIN_PAYOUT_COINS,
  });

  const fee = feeSplit(P.MIN_PAYOUT_COINS);
  const payout = await getEconomyInfra().db('payout_accounts').where({ user_id: userId }).first();

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
    feePreviewMinPayout: {
      amountGems: P.MIN_PAYOUT_COINS,
      feeGems: fee.feeGems,
      netGems: fee.netGems,
      grossMinor: fee.grossMinor,
      feeMinor: fee.feeMinor,
      netMinor: fee.netMinor,
    },
    connect: {
      linked: !!payout?.stripe_account_id,
      payoutsEnabled: !!payout?.payouts_enabled,
      detailsSubmitted: !!payout?.details_submitted,
    },
    blockers: assessment.decision === 'deny' ? assessment.reasons : [],
    reviewReasons: assessment.decision === 'review' ? assessment.reasons : [],
    canRequest:
      bal.withdrawableGems >= P.MIN_PAYOUT_COINS &&
      assessment.decision !== 'deny' &&
      !!payout?.payouts_enabled,
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
  }

  const returnUrl =
    opts.returnUrl ||
    String(env.STRIPE_CONNECT_RETURN_URL || '').trim() ||
    'blyp://withdraw/connect-return';
  const refreshUrl =
    opts.refreshUrl ||
    String(env.STRIPE_CONNECT_REFRESH_URL || '').trim() ||
    'blyp://withdraw/connect-refresh';

  const link = await stripe.accountLinks.create({
    account: accountId!,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });

  return { url: link.url, stripeAccountId: accountId, expiresAt: link.expires_at };
}

export async function getConnectStatus(userId: string) {
  assertWithdrawalsEnabled();
  const { db } = getEconomyInfra();
  const row = await db('payout_accounts').where({ user_id: userId }).first();
  if (!row?.stripe_account_id) {
    return { linked: false, payoutsEnabled: false, detailsSubmitted: false };
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
    return {
      linked: true,
      stripeAccountId: row.stripe_account_id,
      payoutsEnabled: !!account.payouts_enabled,
      detailsSubmitted: !!account.details_submitted,
      chargesEnabled: !!account.charges_enabled,
    };
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e) }, '[withdraw] connect status refresh failed');
    return {
      linked: true,
      stripeAccountId: row.stripe_account_id,
      payoutsEnabled: !!row.payouts_enabled,
      detailsSubmitted: !!row.details_submitted,
      chargesEnabled: !!row.charges_enabled,
    };
  }
}

export async function requestWithdrawal(
  userId: string,
  input: { amountGems: number; idempotencyKey: string },
  claims: { emailVerified?: boolean } = {},
) {
  assertWithdrawalsEnabled();
  const amountGems = Math.floor(Number(input.amountGems));
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!idempotencyKey) {
    throw new EconomyError('INVALID_INPUT', 400, 'idempotencyKey required');
  }
  if (!Number.isFinite(amountGems) || amountGems <= 0) {
    throw new EconomyError('INVALID_INPUT', 400, 'amountGems invalid');
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
      },
    };
  }

  // Refresh connect status before assessing KYC.
  await getConnectStatus(userId).catch(() => undefined);

  const ctx = await buildContext(userId, amountGems, claims);
  const assessment = assessWithdrawal(ctx);
  if (assessment.decision === 'deny') {
    throw new EconomyError('WITHDRAWAL_DENIED', 403, 'Withdrawal denied', {
      reasons: assessment.reasons,
    });
  }

  const splits = feeSplit(amountGems);
  const payout = await db('payout_accounts').where({ user_id: userId }).first();
  if (!payout?.stripe_account_id) {
    throw new EconomyError('WITHDRAWAL_DENIED', 403, 'No payout account', {
      reasons: ['NO_PAYOUT_ACCOUNT'],
    });
  }

  const withdrawalId = randomUUID();
  const status = assessment.requiresManualReview ? 'pending_review' : 'processing';

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
        JSON.stringify({ withdrawalId, status, reasons: assessment.reasons }),
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
      stripe_account_id: payout.stripe_account_id,
      idempotency_key: idempotencyKey,
      metadata: trx.raw('?::jsonb', [
        JSON.stringify({ requiresManualReview: assessment.requiresManualReview }),
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
      },
    };
  }

  // Auto path: Stripe transfer to connected account.
  try {
    const settled = await settleStripeTransfer({
      withdrawalId,
      userId,
      amountGems,
      netMinor: splits.netMinor,
      stripeAccountId: payout.stripe_account_id,
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
      },
    };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), withdrawalId }, '[withdraw] stripe transfer failed');
    await reverseWithdrawalReserve({
      withdrawalId,
      userId,
      amountGems,
      idempotencyKey,
      error: e?.message || String(e),
      nextStatus: 'failed',
    });
    throw new EconomyError('PROVIDER_ERROR', 502, 'Payout provider failed', {
      detail: e?.message || String(e),
    });
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
 * Ops: approve a pending_review withdrawal and execute the Stripe transfer.
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
  if (!row.stripe_account_id) {
    throw new EconomyError('WITHDRAWAL_DENIED', 403, 'No payout account on request');
  }
  if (!stripeSecretConfigured()) {
    throw new EconomyError('STRIPE_NOT_CONFIGURED', 503, 'Stripe is not configured');
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
        }),
      ]),
    });

  const amountGems = Number(row.amount_gems);
  const netMinor = Number(row.net_minor);
  const idempotencyKey = String(row.idempotency_key);

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
    logger.error({ err: e?.message || String(e), withdrawalId: id }, '[withdraw] admin approve transfer failed');
    // Return to pending_review so ops can retry after fixing Stripe; do NOT reverse gems yet.
    await db('withdrawal_requests')
      .where({ withdrawal_id: id })
      .update({
        status: 'pending_review',
        updated_at: db.fn.now(),
        metadata: db.raw(`COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, [
          JSON.stringify({
            lastApproveError: e?.message || String(e),
            lastApproveAttemptAt: new Date().toISOString(),
            lastApproveBy: actorUserId,
          }),
        ]),
      });
    throw new EconomyError('PROVIDER_ERROR', 502, 'Payout provider failed', {
      detail: e?.message || String(e),
    });
  }
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

  return { received: true, type: event.type };
}
