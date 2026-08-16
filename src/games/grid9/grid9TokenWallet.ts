import {
  coinsFromTokensConvert,
  tokensFromJackpotCoins,
} from './constants';

/**
 * Grid 9 Tokens client helper — does not touch BlypCoinService / IAP freeze paths.
 * Calls live-service Instant convert: POST /wallet/convert-tokens
 */
export async function convertGrid9TokensToCoins(args: {
  liveServiceBaseUrl: string;
  accessToken: string;
  amountTokens: number;
  idempotencyKey: string;
}): Promise<{
  tokensDebited: number;
  coinsCredited: number;
  rate: string;
  wallet: {
    coinBalance: number;
    tokenAvailable: number;
    tokenPending: number;
    tokenConvertible: number;
  };
}> {
  const base = args.liveServiceBaseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/wallet/convert-tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amountTokens: args.amountTokens,
      idempotencyKey: args.idempotencyKey,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const message = json?.error || json?.message || `HTTP_${res.status}`;
    throw new Error(String(message));
  }
  return {
    tokensDebited: Number(json.tokensDebited || 0),
    coinsCredited: Number(json.coinsCredited || 0),
    rate: String(json.rate || '1 token = 1 coin + 15% bonus (rounded up)'),
    wallet: {
      coinBalance: Number(json.wallet?.coinBalance || 0),
      tokenAvailable: Number(json.wallet?.tokenAvailable || 0),
      tokenPending: Number(json.wallet?.tokenPending || 0),
      tokenConvertible: Number(json.wallet?.tokenConvertible || 0),
    },
  };
}

export function estimateGrid9VictoryTokens(jackpotCoins: number): number {
  return tokensFromJackpotCoins(jackpotCoins);
}

export function estimateInstantCoinsFromTokens(tokens: number): number {
  return coinsFromTokensConvert(tokens);
}
