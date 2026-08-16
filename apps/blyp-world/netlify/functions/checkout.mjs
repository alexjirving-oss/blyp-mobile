import Stripe from "stripe";

/**
 * Must match apps/blyp-world/lib/coinPacks.ts and live-service webCoinCatalog.
 * Web grants base + ~15% bonus; app IAP is base-only at 1p/coin.
 */
const PACKS = [
  { id: "web.coinpack.100", baseCoins: 100, bonusCoins: 15, coins: 115, label: "115 coins", priceGbp: 1, blurb: "100 base + 15 bonus coins" },
  { id: "web.coinpack.500", baseCoins: 500, bonusCoins: 75, coins: 575, label: "575 coins", priceGbp: 5, blurb: "500 base + 75 bonus coins" },
  { id: "web.coinpack.1000", baseCoins: 1000, bonusCoins: 150, coins: 1150, label: "1,150 coins", priceGbp: 10, blurb: "1,000 base + 150 bonus coins" },
  { id: "web.coinpack.2500", baseCoins: 2500, bonusCoins: 375, coins: 2875, label: "2,875 coins", priceGbp: 25, blurb: "2,500 base + 375 bonus coins" },
  { id: "web.coinpack.5000", baseCoins: 5000, bonusCoins: 750, coins: 5750, label: "5,750 coins", priceGbp: 50, blurb: "5,000 base + 750 bonus coins" },
];

function decodeJwtSub(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json)?.sub || null;
  } catch {
    return null;
  }
}

function isPaypalCapabilityError(err) {
  const msg = String(err?.message || err?.raw?.message || "").toLowerCase();
  const code = String(err?.code || err?.raw?.code || "").toLowerCase();
  return (
    msg.includes("paypal") ||
    code.includes("paypal") ||
    msg.includes("payment_method_type") ||
    msg.includes("payment method type")
  );
}

async function createSession(stripe, params, withPaypal) {
  const base = {
    mode: "payment",
    success_url: params.success_url,
    cancel_url: params.cancel_url,
    client_reference_id: params.client_reference_id,
    metadata: params.metadata,
    line_items: params.line_items,
  };
  if (withPaypal) {
    return stripe.checkout.sessions.create({
      ...base,
      payment_method_types: ["card", "paypal"],
    });
  }
  return stripe.checkout.sessions.create({
    ...base,
    payment_method_types: ["card"],
  });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error:
          "STRIPE_SECRET_KEY is not set on this deployment. Add it in Netlify env to enable Checkout.",
      }),
    };
  }

  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const sub = token ? decodeJwtSub(token) : null;
  if (!sub) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  let packId = "";
  try {
    packId = JSON.parse(event.body || "{}")?.packId || "";
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) {
    return { statusCode: 400, body: JSON.stringify({ error: "Unknown pack" }) };
  }

  const origin =
    event.headers.origin ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://blyp.world";
  const priceEnvKey = `STRIPE_PRICE_${pack.id.replace(/\./g, "_").toUpperCase()}`;
  const priceId = process.env[priceEnvKey];
  const stripe = new Stripe(secret);

  const sessionParams = {
    success_url: `${origin}/wallet?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/wallet?checkout=cancel`,
    client_reference_id: sub,
    metadata: {
      userId: sub,
      packId: pack.id,
      baseCoins: String(pack.baseCoins),
      bonusCoins: String(pack.bonusCoins),
      coins: String(pack.coins),
      source: "blyp-world",
    },
    line_items: priceId
      ? [{ price: priceId, quantity: 1 }]
      : [
          {
            quantity: 1,
            price_data: {
              currency: "gbp",
              unit_amount: Math.round(pack.priceGbp * 100),
              product_data: {
                name: `Blyp ${pack.label}`,
                description: `${pack.baseCoins} coins + ${pack.bonusCoins} bonus — ${pack.blurb}`,
              },
            },
          },
        ],
  };

  let session;
  let paypalOffered = true;
  try {
    session = await createSession(stripe, sessionParams, true);
  } catch (err) {
    if (!isPaypalCapabilityError(err)) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: String(err?.message || "Stripe Checkout failed").slice(0, 280),
        }),
      };
    }
    // PayPal not enabled on the Stripe account — card still works.
    paypalOffered = false;
    try {
      session = await createSession(stripe, sessionParams, false);
    } catch (cardErr) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: String(cardErr?.message || "Stripe Checkout failed").slice(0, 280),
        }),
      };
    }
  }

  if (!session.url) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Stripe did not return a Checkout URL" }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: session.url,
      id: session.id,
      paypalOffered,
      paypalDashboardHint: paypalOffered
        ? null
        : "Enable PayPal in Stripe Dashboard → Settings → Payment methods (GBP), then retry checkout.",
    }),
  };
}
