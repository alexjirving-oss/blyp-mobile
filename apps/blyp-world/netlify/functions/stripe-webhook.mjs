import Stripe from "stripe";

/**
 * Stripe → Netlify → live-service fulfill path for blyp.world Checkout.
 * Prefers INTERNAL credit endpoint; falls closed if secrets missing.
 *
 * Stripe Dashboard (canonical): point checkout.session.completed at
 *   https://blyp-live-service-innn3d7yqq-uc.a.run.app/webhooks/stripe
 * Optional secondary:
 *   https://blyp-world-app.netlify.app/.netlify/functions/stripe-webhook
 * (both are idempotent on session id.)
 */
const PACKS = new Set([
  "web.coinpack.100",
  "web.coinpack.500",
  "web.coinpack.1000",
  "web.coinpack.2500",
  "web.coinpack.5000",
]);

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const liveServiceUrl = (
    process.env.LIVE_SERVICE_URL ||
    process.env.NEXT_PUBLIC_LIVE_SERVICE_URL ||
    "https://blyp-live-service-innn3d7yqq-uc.a.run.app"
  ).replace(/\/+$/, "");
  const internalSecret = process.env.INTERNAL_SHARED_SECRET;

  if (!stripeSecret || !webhookSecret) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: "Stripe webhook not configured on Netlify" }),
    };
  }
  if (!internalSecret) {
    return {
      statusCode: 503,
      body: JSON.stringify({
        error: "INTERNAL_SHARED_SECRET not set — cannot credit live-service wallet",
      }),
    };
  }

  const stripe = new Stripe(stripeSecret);
  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Invalid signature: ${err?.message || err}` }),
    };
  }

  if (stripeEvent.type !== "checkout.session.completed") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ received: true, ignored: stripeEvent.type }),
    };
  }

  const session = stripeEvent.data.object;
  const meta = session.metadata || {};
  const packId = String(meta.packId || "").trim();
  const userId = String(meta.userId || session.client_reference_id || "").trim();
  const source = String(meta.source || "").trim();
  const paid =
    session.payment_status === "paid" || session.payment_status === "no_payment_required";

  if (source !== "blyp-world" || !packId || !userId || !paid || !PACKS.has(packId)) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ received: true, skipped: true }),
    };
  }

  const res = await fetch(`${liveServiceUrl}/internal/economy/credit-web-coins`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": internalSecret,
    },
    body: JSON.stringify({
      userId,
      packId,
      stripeSessionId: session.id,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      statusCode: res.status >= 500 ? 502 : res.status,
      body: JSON.stringify({ error: json.error || "credit failed", detail: json }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ received: true, credited: json }),
  };
}
