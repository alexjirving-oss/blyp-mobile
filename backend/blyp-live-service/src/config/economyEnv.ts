import { z } from 'zod';

const nonEmpty = z.string().min(1);

const economyEnvSchema = z.object({
  POSTGRES_URL: nonEmpty,
  REDIS_URL: nonEmpty,
  ECONOMY_TAKE_RATE_BPS: z.coerce.number().int().min(0).max(10000),
  CREATOR_SHARE_BPS: z.coerce.number().int().min(0).max(10000),
  GEMS_PER_COIN_NUM: z.coerce.number().int().min(0),
  GEMS_PER_COIN_DEN: z.coerce.number().int().min(1),
  PENDING_GEMS_HOLD_SECONDS: z.coerce.number().int().min(0), // prod target 604800 (7d); authoritative gem clearance
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().min(1),

  // Promote (optional; used to price creator-first boosts)
  PROMOTE_BATTLE_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_BATTLE_DURATION_HOURS: z.coerce.number().int().min(1).max(168).optional(),

  PROMOTE_TIME_SLOT_30MIN_COINS: z.coerce.number().int().min(0).optional(),

  PROMOTE_SPOTLIGHT_1H_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_SPOTLIGHT_24H_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_SPOTLIGHT_7D_COINS: z.coerce.number().int().min(0).optional(),

  PROMOTE_FEED_BOOST_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_PROFILE_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_LIVE_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_SEARCH_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_FOLLOWERS_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_TEAM_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_CROSS_SPORT_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_REMATCH_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_MAX_ACTIVE_PER_USER: z.coerce.number().int().min(1).max(50).optional(),
  PROMOTE_SEARCH_GLOBAL_CAP: z.coerce.number().int().min(1).max(100).optional(),

  APPLE_BUNDLE_ID: z.string().optional(),
  APPLE_ISSUER_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY_P8: z.string().optional(),

  GOOGLE_PLAY_PACKAGE_NAME: z.string().optional(),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PLATFORM_CURRENCY: z.string().optional(),
  /** Pence (or cents) paid per 1 gem before platform fee. Default 1 = 1p/gem. */
  WITHDRAW_GEM_MINOR_UNITS: z.coerce.number().int().min(1).optional(),
  /** Alias accepted for plan naming; same as WITHDRAW_GEM_MINOR_UNITS. */
  WITHDRAW_COIN_MINOR_UNITS: z.coerce.number().int().min(1).optional(),
  /** Kill-switch. Also requires non-empty STRIPE_SECRET_KEY at runtime. Keep 0 until sk_live_. */
  ENABLE_WITHDRAWALS: z.coerce.number().int().min(0).max(1).optional(),
  STRIPE_CONNECT_RETURN_URL: z.string().optional(),
  STRIPE_CONNECT_REFRESH_URL: z.string().optional(),

  // Live Games (optional; disabled unless explicitly enabled)
  ECONOMY_LIVE_GAMES_ENABLED: z.coerce.number().int().min(0).max(1).optional(),
  LIVE_GAMES_PAYOUT_MODE: z.enum(['SAFE', 'CASHOUT']).optional(),

  // Matchday Live (optional; write endpoints disabled unless explicitly enabled)
  ECONOMY_MATCHDAY_ENABLED: z.coerce.number().int().min(0).max(1).optional(),
  MATCHDAY_UNLOCK_COINS: z.coerce.number().int().min(0).optional(),
  MATCHDAY_ENTITLEMENT_TTL_HOURS: z.coerce.number().int().min(1).max(72).optional(),
  MATCHDAY_PREDICTION_MIN_STAKE: z.coerce.number().int().min(1).optional(),
  MATCHDAY_PREDICTION_MAX_STAKE: z.coerce.number().int().min(1).optional(),
});

export type EconomyEnv = z.infer<typeof economyEnvSchema>;

export function getEconomyEnv(): EconomyEnv {
  const parsed = economyEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new Error(`[economy-env] Missing/invalid env vars: ${JSON.stringify(issues)}`);
  }

  const env = parsed.data;

  // Defensive trims: secrets/config often arrive with trailing newlines.
  env.POSTGRES_URL = env.POSTGRES_URL.trim();
  env.REDIS_URL = env.REDIS_URL.trim();

  // If you use a simple split model, enforce sum == 10000.
  if (env.ECONOMY_TAKE_RATE_BPS + env.CREATOR_SHARE_BPS !== 10000) {
    throw new Error(
      `[economy-env] ECONOMY_TAKE_RATE_BPS + CREATOR_SHARE_BPS must equal 10000 (got ${env.ECONOMY_TAKE_RATE_BPS} + ${env.CREATOR_SHARE_BPS})`
    );
  }

  return env;
}
