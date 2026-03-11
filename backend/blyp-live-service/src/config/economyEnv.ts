import { z } from 'zod';

const nonEmpty = z.string().min(1);

const economyEnvSchema = z.object({
  POSTGRES_URL: nonEmpty,
  REDIS_URL: nonEmpty,
  ECONOMY_TAKE_RATE_BPS: z.coerce.number().int().min(0).max(10000),
  CREATOR_SHARE_BPS: z.coerce.number().int().min(0).max(10000),
  GEMS_PER_COIN_NUM: z.coerce.number().int().min(0),
  GEMS_PER_COIN_DEN: z.coerce.number().int().min(1),
  PENDING_GEMS_HOLD_SECONDS: z.coerce.number().int().min(0),
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().min(1),

  // Promote (optional; used to price creator-first boosts)
  PROMOTE_BATTLE_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_BATTLE_DURATION_HOURS: z.coerce.number().int().min(1).max(168).optional(),

  PROMOTE_TIME_SLOT_30MIN_COINS: z.coerce.number().int().min(0).optional(),

  PROMOTE_SPOTLIGHT_1H_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_SPOTLIGHT_24H_COINS: z.coerce.number().int().min(0).optional(),
  PROMOTE_SPOTLIGHT_7D_COINS: z.coerce.number().int().min(0).optional(),

  APPLE_BUNDLE_ID: z.string().optional(),
  APPLE_ISSUER_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY_P8: z.string().optional(),

  GOOGLE_PLAY_PACKAGE_NAME: z.string().optional(),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PLATFORM_CURRENCY: z.string().optional(),

  // Live Games (optional; disabled unless explicitly enabled)
  ECONOMY_LIVE_GAMES_ENABLED: z.coerce.number().int().min(0).max(1).optional(),
  LIVE_GAMES_PAYOUT_MODE: z.enum(['SAFE', 'CASHOUT']).optional(),
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
