import Stripe from "stripe";

const PACKS = [
  { id: "web.coinpack.100", coins: 100, label: "100 coins", priceUsd: 0.99, blurb: "Starter pack" },
  { id: "web.coinpack.550", coins: 550, label: "550 coins", priceUsd: 4.99, blurb: "500 + 50 bonus" },
  { id: "web.coinpack.1150", coins: 1150, label: "1,150 coins", priceUsd: 9.99, blurb: "1000 + 150 bonus" },
  { id: "web.coinpack.3000", coins: 3000, label: "3,000 coins", priceUsd: 19.99, blurb: "2500 + 500 bonus" },
  { id: "web.coinpack.6500", coins: 6500, label: "6,500 coins", priceUsd: 39.99, blurb: "5000 + 1500 bonus" },
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
    "https://blyp-world-app.netlify.app";
  const priceEnvKey = `STRIPE_PRICE_${pack.id.replace(/\./g, "_").toUpperCase()}`;
  const priceId = process.env[priceEnvKey];
  const stripe = new Stripe(secret);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${origin}/wallet?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/wallet?checkout=cancel`,
    client_reference_id: sub,
    metadata: {
      userId: sub,
      packId: pack.id,
      coins: String(pack.coins),
      source: "blyp-world",
    },
    line_items: priceId
      ? [{ price: priceId, quantity: 1 }]
      : [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: Math.round(pack.priceUsd * 100),
              product_data: {
                name: `Blyp ${pack.label}`,
                description: `${pack.coins} Blyp coins — ${pack.blurb}`,
              },
            },
          },
        ],
  });

  if (!session.url) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Stripe did not return a Checkout URL" }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: session.url, id: session.id }),
  };
}
