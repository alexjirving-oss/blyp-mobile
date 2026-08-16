/**
 * Same-origin Cognito → Firebase custom-token bridge for blyp.world.
 * Proxies to live-service (Admin SDK mint) so the browser never depends on
 * Cloud Functions CORS allowlists.
 */

const LIVE_SERVICE_URL = (
  process.env.LIVE_SERVICE_URL ||
  process.env.NEXT_PUBLIC_LIVE_SERVICE_URL ||
  "https://blyp-live-service-innn3d7yqq-uc.a.run.app"
).replace(/\/+$/, "");

const CF_MINT_URL =
  process.env.FIREBASE_BRIDGE_MINT_URL ||
  "https://us-central1-blyp-master.cloudfunctions.net/mintFirebaseCustomToken";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

async function tryMint(url, authorization, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body,
  });
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const authorization = event.headers.authorization || event.headers.Authorization || "";
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ error: "Missing or invalid Authorization header" }),
    };
  }

  const body = event.body || "{}";

  try {
    // Prefer live-service (CORS-safe for browsers; Admin SDK mint).
    let { res, payload } = await tryMint(
      `${LIVE_SERVICE_URL}/auth/firebase-token`,
      authorization,
      body,
    );

    // Fall back to Cloud Functions mint (mobile path) if live-service is down.
    if (!res.ok || !(payload?.customToken || payload?.firebaseToken)) {
      const fallback = await tryMint(CF_MINT_URL, authorization, body);
      if (fallback.res.ok && (fallback.payload?.firebaseToken || fallback.payload?.customToken)) {
        res = fallback.res;
        payload = fallback.payload;
      } else if (!res.ok) {
        return {
          statusCode: res.status || fallback.res.status || 502,
          headers: CORS,
          body: JSON.stringify({
            error: payload?.error || fallback.payload?.error || "Mint failed",
            detail: payload?.detail || fallback.payload?.detail || null,
          }),
        };
      }
    }

    const customToken = payload.customToken || payload.firebaseToken;
    if (!customToken) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: "Mint response missing token" }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        uid: payload.uid || null,
        customToken,
        firebaseToken: customToken,
        authMode: payload.authMode || "proxied",
      }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({
        error: "Bridge proxy failed",
        detail: e instanceof Error ? e.message : String(e),
      }),
    };
  }
}
