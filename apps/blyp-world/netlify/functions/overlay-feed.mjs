/**
 * Public overlay snapshot for /live/:id watch + OBS.
 * GET is unauthenticated (viewers are often logged out).
 * PUT requires a Cognito Bearer token whose `sub` matches the session host
 * (live-service `/api/live/session/:id/status` hostUserId).
 */

import { createPublicKey, createVerify } from "node:crypto";
import { connectLambda, getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Content-Type": "application/json",
};

const LIVE_SERVICE_URL = (
  process.env.LIVE_SERVICE_URL ||
  process.env.NEXT_PUBLIC_LIVE_SERVICE_URL ||
  "https://blyp-live-service-innn3d7yqq-uc.a.run.app"
).replace(/\/+$/, "");

const COGNITO_CLIENT_FALLBACK = "4a7r115hllaedriqsjlsa00snj";
const SESSION_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_FEED_CHARS = 180_000;
const HOST_LOOKUP_MS = 8_000;

let jwksCache = { uri: "", keys: [], at: 0 };

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function bearerToken(event) {
  const raw = event.headers?.authorization || event.headers?.Authorization || "";
  const match = String(raw).match(/^Bearer\s+(\S+)/i);
  return match ? match[1] : "";
}

function cognitoConfig() {
  const region =
    process.env.COGNITO_REGION ||
    process.env.NEXT_PUBLIC_AWS_COGNITO_REGION ||
    "eu-west-2";
  const userPoolId =
    process.env.COGNITO_USER_POOL_ID ||
    process.env.NEXT_PUBLIC_AWS_USER_POOL_ID ||
    "eu-west-2_ITX07Zvnt";
  const clientIds = [
    process.env.COGNITO_USER_POOL_WEB_CLIENT_ID,
    process.env.NEXT_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID,
    process.env.COGNITO_APP_CLIENT_ID,
    COGNITO_CLIENT_FALLBACK,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  return {
    issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
    clientIds: [...new Set(clientIds)],
  };
}

async function getJwk(kid) {
  const { jwksUri } = cognitoConfig();
  if (!jwksCache.keys.length || jwksCache.uri !== jwksUri || Date.now() - jwksCache.at > 600_000) {
    const res = await fetch(jwksUri);
    if (!res.ok) throw new Error("JWKS_FETCH_FAILED");
    const payload = await res.json();
    jwksCache = { uri: jwksUri, keys: payload.keys || [], at: Date.now() };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error("JWKS_KID_MISSING");
  return jwk;
}

async function verifyCognitoJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("INVALID_JWT");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (header.alg !== "RS256") throw new Error("INVALID_ALG");
  const jwk = await getJwk(header.kid);
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  if (!verifier.verify(key, parts[2], "base64url")) throw new Error("INVALID_SIG");
  const now = Math.floor(Date.now() / 1000);
  if (Number(payload.exp || 0) < now) throw new Error("EXPIRED");
  const { issuer, clientIds } = cognitoConfig();
  if (payload.iss !== issuer) throw new Error("INVALID_ISS");
  const tokenUse = String(payload.token_use || "").toLowerCase();
  if (tokenUse !== "id" && tokenUse !== "access") throw new Error("INVALID_TOKEN_USE");
  const aud = String(payload.client_id || payload.aud || "").trim();
  if (!aud || !clientIds.includes(aud)) throw new Error("INVALID_AUD");
  const sub = String(payload.sub || "").trim();
  if (!sub) throw new Error("INVALID_SUB");
  return { ...payload, sub };
}

function sessionIdFromEvent(event) {
  const q = String(event.queryStringParameters?.session || "").trim();
  if (q) return q;
  try {
    const body = JSON.parse(event.body || "{}");
    return String(body.sessionId || body.session || "").trim();
  } catch {
    return "";
  }
}

function blobKey(sessionId) {
  return `session:${sessionId}`;
}

function getFeedStore(event) {
  connectLambda(event);
  return getStore("studio-overlay-feed");
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Same host gate as live-service host actions: token sub must equal session.hostUserId.
 * Looks up owner via existing live-service status (no new admin secret).
 */
async function assertCallerIsSessionHost(sessionId, token, sub) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HOST_LOOKUP_MS);
  let res;
  try {
    res = await fetch(
      `${LIVE_SERVICE_URL}/api/live/session/${encodeURIComponent(sessionId)}/status`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: ac.signal,
      },
    );
  } catch (e) {
    if (e && typeof e === "object" && e.name === "AbortError") {
      throw httpError(502, "HOST_LOOKUP_FAILED");
    }
    throw httpError(502, "HOST_LOOKUP_FAILED");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw httpError(res.status >= 500 ? 502 : 403, "HOST_LOOKUP_FAILED");
  }
  let row;
  try {
    row = await res.json();
  } catch {
    throw httpError(502, "HOST_LOOKUP_FAILED");
  }
  const hostUid = String(row?.hostUserId || row?.hostUid || "").trim();
  if (!hostUid || hostUid !== sub) {
    throw httpError(403, "NOT_SESSION_HOST");
  }
}

export async function handler(event) {
  const method = String(event.httpMethod || event.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const sessionId = sessionIdFromEvent(event);
  if (!SESSION_RE.test(sessionId)) {
    return json(400, { error: "Invalid session" });
  }

  try {
    if (method === "GET") {
      const store = getFeedStore(event);
      const row = await store.get(blobKey(sessionId), { type: "json" });
      if (!row || typeof row !== "object" || !row.feed) {
        return json(404, { error: "No overlay feed" });
      }
      return json(200, { sessionId, feed: row.feed, updatedAt: row.updatedAt || 0 });
    }

    if (method === "PUT" || method === "POST") {
      const token = bearerToken(event);
      if (!token) return json(401, { error: "Missing Authorization" });
      const claims = await verifyCognitoJwt(token);
      await assertCallerIsSessionHost(sessionId, token, claims.sub);
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return json(400, { error: "Invalid JSON" });
      }
      const feed = body.feed;
      if (!feed || typeof feed !== "object") {
        return json(400, { error: "Missing feed" });
      }
      const packed = JSON.stringify(feed);
      if (packed.length > MAX_FEED_CHARS) {
        return json(413, { error: "Feed too large" });
      }
      const store = getFeedStore(event);
      const updatedAt = Date.now();
      await store.setJSON(blobKey(sessionId), { feed, updatedAt, sessionId });
      return json(200, { ok: true, updatedAt });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "overlay-feed failed";
    const status =
      e && typeof e === "object" && typeof e.statusCode === "number"
        ? e.statusCode
        : 0;
    if (status >= 400 && status < 600) {
      return json(status, { error: msg });
    }
    if (/EXPIRED|INVALID_|JWKS_|Missing/.test(msg)) {
      return json(401, { error: msg });
    }
    if (/NOT_SESSION_HOST|HOST_LOOKUP/.test(msg)) {
      return json(403, { error: msg });
    }
    return json(500, { error: msg });
  }
}
