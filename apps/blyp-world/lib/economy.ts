"use client";

import {
  forceRefreshSession,
  loadStoredSession,
  refreshSessionIfNeeded,
} from "./cognito";
import { liveServiceUrl } from "./env";
export { WEB_COIN_PACKS } from "./coinPacks";

export type WalletBalance = {
  coins: number;
  /** Spendable display gems = gemAvailable + gemPending (same as mobile header). */
  gems: number;
  gemAvailable: number;
  gemPending: number;
  /** Immediate convert total (available + pending). Withdraw still uses gemAvailable. */
  gemConvertible: number;
};

export type GiftItem = {
  giftId: string;
  name: string;
  coinCost: number;
  emoji?: string;
};

export type WithdrawPayoutMethod = "stripe_connect" | "paypal";

export type WithdrawEligibility = {
  enabled: boolean;
  withdrawableGems: number;
  gemAvailable: number;
  gemPending: number;
  minPayoutGems: number;
  platformFeePercent: number;
  fiatCurrency: string;
  canRequest: boolean;
  blockers: string[];
  reviewReasons: string[];
  connect: {
    linked: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    needsOnboarding?: boolean;
    onboardingComplete?: boolean;
    blockerMessage?: string | null;
  };
  paypal?: {
    configured: boolean;
    email: string | null;
    canRequest: boolean;
  };
  methods?: {
    paypal: {
      available: boolean;
      configured: boolean;
      email: string | null;
      canRequest: boolean;
      blockers: string[];
      setupHint?: string | null;
    };
    stripe_connect: {
      available: boolean;
      configured: boolean;
      canRequest: boolean;
      blockers: string[];
    };
  };
  feePreviewMinPayout?: {
    amountGems: number;
    feeGems: number;
    netGems: number;
    netMinor: number;
  };
  policyCopy?: Record<string, unknown>;
};

export const FALLBACK_GIFTS: GiftItem[] = [
  { giftId: "heart", name: "Heart", coinCost: 1, emoji: "❤️" },
  { giftId: "thumbsup", name: "Thumbs Up", coinCost: 2, emoji: "👍" },
  { giftId: "clap", name: "Clap", coinCost: 5, emoji: "👏" },
  { giftId: "fire", name: "Fire", coinCost: 10, emoji: "🔥" },
  { giftId: "star", name: "Star", coinCost: 15, emoji: "⭐" },
  { giftId: "diamond", name: "Diamond", coinCost: 25, emoji: "💎" },
  { giftId: "cheer_burst", name: "Cheer Burst", coinCost: 25, emoji: "💨" },
  { giftId: "revive", name: "Revive", coinCost: 30, emoji: "🛟" },
  { giftId: "crown", name: "Crown", coinCost: 50, emoji: "👑" },
  { giftId: "rocket", name: "Rocket", coinCost: 100, emoji: "🚀" },
  { giftId: "mad_hearts", name: "Mad Hearts", coinCost: 100, emoji: "💖" },
  { giftId: "mad_confetti", name: "Mad Confetti", coinCost: 100, emoji: "🎊" },
  { giftId: "mad_rose", name: "Mad Rose", coinCost: 200, emoji: "🌹" },
  { giftId: "mad_donut", name: "Mad Donut", coinCost: 200, emoji: "🍩" },
  { giftId: "mad_thanks_gift", name: "Thanks Gift", coinCost: 300, emoji: "🎁" },
  { giftId: "mad_thanks_likes", name: "Thanks Likes", coinCost: 300, emoji: "👍" },
  { giftId: "mad_thanks_share", name: "Thanks Share", coinCost: 500, emoji: "🔗" },
  { giftId: "mad_gift_avalanche", name: "Gift Avalanche", coinCost: 750, emoji: "🎁" },
  { giftId: "lion_baby", name: "Baby Lion", coinCost: 1000, emoji: "🦁" },
  { giftId: "lion_big", name: "Big Lion", coinCost: 5000, emoji: "🦁" },
];

async function resolveBearerToken(idToken: string): Promise<string> {
  const stored = loadStoredSession();
  if (!stored?.idToken) return idToken;
  const fresh = await refreshSessionIfNeeded(stored);
  return fresh?.idToken || stored.idToken || idToken;
}

async function economyFetch<T>(
  path: string,
  idToken: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>,
  retried = false,
): Promise<T> {
  const token = retried ? idToken : await resolveBearerToken(idToken);
  let url = `${liveServiceUrl}${path}`;
  if (method === "GET") {
    url += (url.includes("?") ? "&" : "?") + `_ts=${Date.now()}`;
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Cache-Control": "no-cache",
  };
  // Avoid Content-Type on GET — it forces a CORS preflight for no benefit.
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      cache: "no-store",
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
  } catch (e) {
    throw new Error(
      e instanceof Error && e.message
        ? `Wallet network error: ${e.message}`
        : "Wallet network error",
    );
  }
  const json = await res.json().catch(() => ({}));
  // Mobile treats idempotent gift replays as success (same payload, HTTP 409).
  if (
    res.status === 409 &&
    (json as { code?: string })?.code === "IDEMPOTENT_REPLAY"
  ) {
    return json as T;
  }
  if (!res.ok) {
    if (res.status === 401 && !retried) {
      const stored = loadStoredSession();
      if (stored?.refreshToken) {
        const fresh = await forceRefreshSession(stored);
        if (fresh?.idToken) {
          return economyFetch<T>(path, fresh.idToken, method, body, true);
        }
      }
    }
    const detail = (json as { detail?: unknown })?.detail;
    const detailMsg =
      detail && typeof detail === "object" && detail !== null
        ? String(
            (detail as { userMessage?: string; reason?: string }).userMessage ||
              (detail as { reason?: string }).reason ||
              "",
          )
        : typeof detail === "string"
          ? detail
          : "";
    const msg =
      detailMsg ||
      (json as { detail?: string })?.detail ||
      (json as { error?: string })?.error ||
      (json as { code?: string })?.code ||
      `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return json as T;
}

/**
 * Spendable coins = coinBalance + bonusCoinBalance — same formula as the
 * mobile app (HeaderWalletBalances / CoinStore / BlypCoinWallet).
 * live-service GET /wallet returns those fields (not a flat `coins`).
 */
export async function fetchWallet(idToken: string): Promise<WalletBalance> {
  const data = await economyFetch<{
    coins?: number;
    coinBalance?: number;
    bonusCoinBalance?: number;
    balance?: number;
    purchasedCoins?: number;
    gems?: number;
    gemAvailable?: number;
    gemPending?: number;
    gemConvertible?: number;
  }>("/wallet", idToken);

  let coins: number;
  if (data.coinBalance != null || data.bonusCoinBalance != null) {
    coins =
      Number(data.coinBalance || 0) + Number(data.bonusCoinBalance || 0);
  } else {
    coins = Number(
      data.coins ?? data.balance ?? data.purchasedCoins ?? 0,
    );
  }

  const gemAvailable = Number(data.gemAvailable || 0);
  const gemPending = Number(data.gemPending || 0);
  const gems =
    data.gemAvailable != null || data.gemPending != null
      ? gemAvailable + gemPending
      : Number(data.gems) || 0;
  const gemConvertible =
    data.gemConvertible != null && Number.isFinite(Number(data.gemConvertible))
      ? Number(data.gemConvertible)
      : gemAvailable + gemPending;

  return {
    coins: Number.isFinite(coins) ? coins : 0,
    gems: Number.isFinite(gems) ? gems : 0,
    gemAvailable: Number.isFinite(gemAvailable) ? gemAvailable : 0,
    gemPending: Number.isFinite(gemPending) ? gemPending : 0,
    gemConvertible: Number.isFinite(gemConvertible) ? gemConvertible : 0,
  };
}

export async function fetchWithdrawEligibility(
  idToken: string,
): Promise<WithdrawEligibility> {
  return economyFetch<WithdrawEligibility>("/withdraw/eligibility", idToken);
}

export async function startWithdrawConnectOnboard(opts: {
  idToken: string;
  returnUrl?: string;
  refreshUrl?: string;
}): Promise<{ url?: string | null; alreadyComplete?: boolean }> {
  return economyFetch("/withdraw/connect/onboard", opts.idToken, "POST", {
    returnUrl: opts.returnUrl,
    refreshUrl: opts.refreshUrl,
  });
}

export async function saveWithdrawPaypalEmail(opts: {
  idToken: string;
  paypalEmail: string;
}): Promise<{ paypalEmail: string; paypalConfigured: boolean }> {
  return economyFetch("/withdraw/paypal/email", opts.idToken, "POST", {
    paypalEmail: opts.paypalEmail,
  });
}

export async function requestWithdrawGems(opts: {
  idToken: string;
  amountGems: number;
  method: WithdrawPayoutMethod;
  paypalEmail?: string;
}): Promise<{
  withdrawalId: string;
  status: string;
  amountGems: number;
  feeGems: number;
  netGems: number;
  netMinor: number;
  currency: string;
  method?: string;
}> {
  const idempotencyKey = `web_withdraw_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return economyFetch("/withdraw/request", opts.idToken, "POST", {
    amountGems: opts.amountGems,
    idempotencyKey,
    method: opts.method,
    ...(opts.paypalEmail ? { paypalEmail: opts.paypalEmail } : {}),
  });
}

/** Convert earned gems (available+pending, immediate) → spendable COIN at ceil(gems * 1.15). */
export async function convertGemsToCoins(opts: {
  idToken: string;
  amountGems: number;
}): Promise<{
  kind: "ok" | "replay";
  gemsDebited: number;
  coinsCredited: number;
  rate: string;
  wallet: {
    coinBalance: number;
    bonusCoinBalance: number;
    gemAvailable: number;
    gemPending: number;
    gemConvertible?: number;
  };
}> {
  const idempotencyKey = `web_gem_to_coin_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return economyFetch("/wallet/convert-gems", opts.idToken, "POST", {
    amountGems: opts.amountGems,
    idempotencyKey,
  });
}

export async function fetchGiftCatalog(idToken: string): Promise<GiftItem[]> {
  try {
    const data = await economyFetch<{
      gifts?: Array<Record<string, unknown>>;
      catalog?: Array<Record<string, unknown>>;
    }>("/economy/catalog", idToken);
    const rows = data.gifts || data.catalog || [];
    const mapped = rows
      .map((g) => ({
        giftId: String(g.giftId || g.gift_id || ""),
        name: String(g.name || g.giftId || ""),
        coinCost: Number(g.coinCost ?? g.coin_cost ?? 0),
        emoji:
          (g.asset_json as { emoji?: string } | undefined)?.emoji ||
          (g.asset as { emoji?: string } | undefined)?.emoji ||
          undefined,
      }))
      .filter((g) => g.giftId && g.coinCost > 0);
    return mapped.length ? mapped : FALLBACK_GIFTS;
  } catch {
    return FALLBACK_GIFTS;
  }
}

export async function sendGift(opts: {
  idToken: string;
  postOrStreamId: string;
  receiverUserId: string;
  giftId: string;
  quantity?: number;
}): Promise<unknown> {
  const idempotencyKey = `web_${opts.postOrStreamId}_${opts.giftId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return economyFetch("/gift/send", opts.idToken, "POST", {
    idempotencyKey,
    streamId: opts.postOrStreamId,
    receiverUserId: opts.receiverUserId,
    giftId: opts.giftId,
    quantity: opts.quantity ?? 1,
  });
}

export async function createCheckoutSession(opts: {
  packId: string;
  idToken: string;
}): Promise<{ url: string; paypalOffered?: boolean }> {
  const res = await fetch("/.netlify/functions/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.idToken}`,
    },
    body: JSON.stringify({ packId: opts.packId }),
  });
  const json = (await res.json()) as {
    url?: string;
    error?: string;
    paypalOffered?: boolean;
  };
  if (!res.ok || !json.url) {
    throw new Error(json.error || `Checkout failed (${res.status})`);
  }
  return { url: json.url, paypalOffered: json.paypalOffered };
}

