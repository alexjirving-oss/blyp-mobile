import { randomUUID } from 'crypto';
import { getEconomyInfra } from './infra';
import { EconomyError } from './economyErrors';
import {
  coinsFromTokensConvert,
  describeTokenToCoinRate,
  TOKEN_TO_COIN_CONVERT_BONUS_MULTIPLIER,
  TOKEN_TO_COIN_FACE_RATIO,
} from './tokenToCoinConvert';
import { tokensFromJackpotCoins } from '../games/grid9/constants';

/**
 * Credit Grid 9 victory Tokens (50% of jackpot coins). Idempotent via ledger key.
 * Does not touch gem columns or gem convert paths.
 */
export async function creditGrid9VictoryTokens(
  trx: any,
  args: {
    userId: string;
    matchId: string;
    jackpotCoins: number;
    winnerSlotIndex: number | null;
  },
): Promise<{ tokensCredited: number }> {
  const tokens = tokensFromJackpotCoins(args.jackpotCoins);
  if (tokens <= 0) return { tokensCredited: 0 };
  const idempotencyKey = `grid9:token-jackpot:${args.matchId}:${args.userId}`;
  const existing = await trx('ledger_entries')
    .where({ idempotency_key: idempotencyKey })
    .first();
  if (existing) return { tokensCredited: tokens };

  await trx('wallets').insert({ user_id: args.userId }).onConflict('user_id').ignore();
  const wallet = await trx('wallets').where({ user_id: args.userId }).forUpdate().first();
  if (!wallet) throw new Error('Grid 9 winner wallet missing');

  await trx('ledger_entries').insert({
    ledger_id: randomUUID(),
    user_id: args.userId,
    entry_type: 'GRID9_TOKEN_PAYOUT',
    currency: 'TOKEN',
    amount: String(tokens),
    status: 'POSTED',
    reference_type: 'GRID9_MATCH',
    reference_id: args.matchId,
    idempotency_key: idempotencyKey,
    metadata: {
      matchId: args.matchId,
      jackpotCoins: args.jackpotCoins,
      winnerSlotIndex: args.winnerSlotIndex,
      tokenPayoutBps: 5000,
    },
  });

  await trx('wallets')
    .where({ user_id: args.userId })
    .update({
      token_available: (
        BigInt(wallet.token_available || 0) + BigInt(tokens)
      ).toString(),
      lifetime_earned_tokens: (
        BigInt(wallet.lifetime_earned_tokens || 0) + BigInt(tokens)
      ).toString(),
      updated_at: trx.fn.now(),
    });

  return { tokensCredited: tokens };
}

/**
 * Convert Tokens → spendable COIN at ceil(tokens * 1.15). Parallel to gems convert;
 * does not read or write gem balances.
 */
export async function convertTokensToCoins(
  userId: string,
  input: { amountTokens: number; idempotencyKey: string },
): Promise<{
  kind: 'ok' | 'replay';
  tokensDebited: number;
  coinsCredited: number;
  rate: string;
  faceRatio: number;
  bonusMultiplier: number;
  wallet: {
    coinBalance: number;
    tokenAvailable: number;
    tokenPending: number;
    tokenConvertible: number;
  };
}> {
  const { db } = getEconomyInfra();
  const tokens = Math.floor(Number(input.amountTokens || 0));
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!Number.isFinite(tokens) || tokens < 1) {
    throw new EconomyError('INVALID_INPUT', 400, 'amountTokens must be a positive integer');
  }
  if (!idempotencyKey || idempotencyKey.length > 120) {
    throw new EconomyError('INVALID_INPUT', 400, 'idempotencyKey required');
  }

  const coinsCredited = coinsFromTokensConvert(tokens);
  if (coinsCredited < 1) {
    throw new EconomyError(
      'INVALID_INPUT',
      400,
      'amountTokens too small to credit at least 1 coin at 1:1+15% rate',
    );
  }

  const readWallet = async (q: any) => {
    const w = await q('wallets').where({ user_id: userId }).first();
    const tokenAvailable = Number(w?.token_available || 0);
    const tokenPending = Number(w?.token_pending || 0);
    return {
      coinBalance: Number(w?.coin_balance || 0),
      tokenAvailable,
      tokenPending,
      tokenConvertible: tokenAvailable + tokenPending,
    };
  };

  try {
    return await db.transaction(async (trx) => {
      await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();

      const existing = await trx('ledger_entries')
        .where({
          user_id: userId,
          entry_type: 'TOKEN_TO_COIN_CONVERT',
          currency: 'COIN',
          idempotency_key: `${idempotencyKey}:COIN`,
        })
        .first();
      if (existing) {
        return {
          kind: 'replay' as const,
          tokensDebited: 0,
          coinsCredited: 0,
          rate: describeTokenToCoinRate(),
          faceRatio: TOKEN_TO_COIN_FACE_RATIO,
          bonusMultiplier: TOKEN_TO_COIN_CONVERT_BONUS_MULTIPLIER,
          wallet: await readWallet(trx),
        };
      }

      const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first();
      if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

      const tokenAvailable = BigInt(wallet.token_available || 0);
      const tokenPending = BigInt(wallet.token_pending || 0);
      const convertible = tokenAvailable + tokenPending;
      const tokensDelta = BigInt(tokens);
      if (convertible < tokensDelta) {
        throw new EconomyError(
          'INSUFFICIENT_FUNDS',
          409,
          'Insufficient tokens to convert',
          {
            tokenAvailable: Number(tokenAvailable),
            tokenPending: Number(tokenPending),
            convertible: Number(convertible),
            requested: tokens,
          },
        );
      }

      const fromAvailable = tokensDelta <= tokenAvailable ? tokensDelta : tokenAvailable;
      const fromPending = tokensDelta - fromAvailable;
      const coinsDelta = BigInt(coinsCredited);
      const refId = randomUUID();
      const meta = {
        amountTokens: tokens,
        fromPending: Number(fromPending),
        fromAvailable: Number(fromAvailable),
        coinsCredited,
        faceRatio: TOKEN_TO_COIN_FACE_RATIO,
        bonusMultiplier: TOKEN_TO_COIN_CONVERT_BONUS_MULTIPLIER,
        rate: describeTokenToCoinRate(),
        originalIdempotencyKey: idempotencyKey,
      };

      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: userId,
        entry_type: 'TOKEN_TO_COIN_CONVERT',
        currency: 'TOKEN',
        amount: (-tokensDelta).toString(),
        status: 'POSTED',
        reference_type: 'TOKEN_TO_COIN_CONVERT',
        reference_id: refId,
        idempotency_key: `${idempotencyKey}:TOKEN`,
        metadata: meta,
      });
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: userId,
        entry_type: 'TOKEN_TO_COIN_CONVERT',
        currency: 'COIN',
        amount: coinsDelta.toString(),
        status: 'POSTED',
        reference_type: 'TOKEN_TO_COIN_CONVERT',
        reference_id: refId,
        idempotency_key: `${idempotencyKey}:COIN`,
        metadata: meta,
      });

      await trx('wallets')
        .where({ user_id: userId })
        .update({
          token_pending: (tokenPending - fromPending).toString(),
          token_available: (tokenAvailable - fromAvailable).toString(),
          coin_balance: (BigInt(wallet.coin_balance || 0) + coinsDelta).toString(),
          updated_at: trx.fn.now(),
        });

      return {
        kind: 'ok' as const,
        tokensDebited: tokens,
        coinsCredited,
        rate: describeTokenToCoinRate(),
        faceRatio: TOKEN_TO_COIN_FACE_RATIO,
        bonusMultiplier: TOKEN_TO_COIN_CONVERT_BONUS_MULTIPLIER,
        wallet: await readWallet(trx),
      };
    });
  } catch (error: any) {
    if (error instanceof EconomyError) throw error;
    if (String(error?.code || '') === '23505') {
      return {
        kind: 'replay',
        tokensDebited: 0,
        coinsCredited: 0,
        rate: describeTokenToCoinRate(),
        faceRatio: TOKEN_TO_COIN_FACE_RATIO,
        bonusMultiplier: TOKEN_TO_COIN_CONVERT_BONUS_MULTIPLIER,
        wallet: await readWallet(db),
      };
    }
    throw error;
  }
}
