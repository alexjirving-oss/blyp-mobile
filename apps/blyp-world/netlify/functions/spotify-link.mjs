/**
 * Spotify account link for LIVE Studio jukebox.
 * PKCE code exchange + refresh-token store keyed by Cognito sub (Netlify Blobs).
 * Access tokens come only from Spotify (exchange or refresh). Never minted here.
 * Never logs tokens. Client ID is public; client secret stays in env if set.
 */

import { createPublicKey, createVerify } from "node:crypto";
import { connectLambda, getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_ME_URL = "https://api.spotify.com/v1/me";
const COGNITO_CLIENT_FALLBACK = "4a7r115hllaedriqsjlsa00snj";
const SESSION_EXPIRED = "Spotify session expired — connect again";

let jwksCache = { uri: "", keys: [], at: 0 };

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function safeErrorMessage(raw) {
  let s = String(raw || "Spotify link failed");
  s = s.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  s = s.replace(
    /\b(access_token|refresh_token|code_verifier|id_token|authorization_code)\b[=:]\s*\S+/gi,
    "$1=[redacted]",
  );
  s = s.replace(/[A-Za-z0-9_-]{80,}/g, "[redacted]");
  s = s.replace(/\s+/g, " ").trim();
  return (s || "Spotify link failed").slice(0, 180);
}

function httpError(statusCode, message) {
  const err = new Error(safeErrorMessage(message));
  err.statusCode = statusCode;
  return err;
}

function isUsableAccessToken(token) {
  return typeof token === "string" && token.length >= 20;
}

function isUsableRefreshToken(token) {
  return typeof token === "string" && token.length >= 20;
}

function spotifyClientId() {
  return String(
    process.env.SPOTIFY_CLIENT_ID ||
      process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ||
      "",
  ).trim();
}

function spotifyClientSecret() {
  return String(process.env.SPOTIFY_CLIENT_SECRET || "").trim();
}

function isConfigured() {
  return spotifyClientId().length > 0;
}

function actionFromEvent(event) {
  const q = String(event.queryStringParameters?.action || "").trim().toLowerCase();
  if (q) return q;
  const raw = `${event.path || ""} ${event.rawUrl || ""}`.toLowerCase();
  if (raw.includes("exchange")) return "exchange";
  if (raw.includes("disconnect")) return "disconnect";
  if (/\btoken\b/.test(raw) || raw.includes("/token")) return "token";
  return "status";
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
    if (!res.ok) throw httpError(401, "JWKS_FETCH_FAILED");
    const payload = await res.json();
    jwksCache = { uri: jwksUri, keys: payload.keys || [], at: Date.now() };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === kid);
  if (!jwk) throw httpError(401, "JWKS_KID_MISSING");
  return jwk;
}

function parseJwtJson(part, label) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw httpError(401, label);
  }
}

async function verifyCognitoJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw httpError(401, "INVALID_JWT");
  const header = parseJwtJson(parts[0], "INVALID_JWT");
  const payload = parseJwtJson(parts[1], "INVALID_JWT");
  if (header.alg !== "RS256") throw httpError(401, "INVALID_ALG");
  const jwk = await getJwk(header.kid);
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  if (!verifier.verify(key, parts[2], "base64url")) throw httpError(401, "INVALID_SIG");
  const now = Math.floor(Date.now() / 1000);
  if (Number(payload.exp || 0) < now) throw httpError(401, "EXPIRED");
  const { issuer, clientIds } = cognitoConfig();
  if (payload.iss !== issuer) throw httpError(401, "INVALID_ISS");
  const tokenUse = String(payload.token_use || "").toLowerCase();
  if (tokenUse !== "id" && tokenUse !== "access") throw httpError(401, "INVALID_TOKEN_USE");
  const aud = String(payload.client_id || payload.aud || "").trim();
  if (!aud || !clientIds.includes(aud)) throw httpError(401, "INVALID_AUD");
  const sub = String(payload.sub || "").trim();
  if (!sub) throw httpError(401, "INVALID_SUB");
  return { ...payload, sub };
}

async function requireUser(event) {
  const token = bearerToken(event);
  if (!token) throw httpError(401, "Missing or invalid Authorization header");
  try {
    return await verifyCognitoJwt(token);
  } catch (e) {
    if (e?.statusCode) throw e;
    throw httpError(401, e instanceof Error ? e.message : "Invalid token");
  }
}

function isAllowedRedirect(uri) {
  try {
    const u = new URL(String(uri || "").trim());
    const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    if (path !== "/live/studio/") return false;
    if (u.protocol === "https:" && (u.hostname === "blyp.world" || u.hostname === "www.blyp.world")) {
      return true;
    }
    if (u.protocol === "http:" && u.hostname === "127.0.0.1") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function getLinkStore(event) {
  // Lambda-compat (`export async function handler`) does not inject Blobs context.
  connectLambda(event);
  return getStore("spotify-oauth");
}

function blobKey(sub) {
  return `user:${sub}`;
}

function queueKey(sub) {
  return `queue:${sub}`;
}

function sanitizeQueueTracks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw.slice(0, 40)) {
    if (!row || typeof row !== "object") continue;
    const id = String(row.id || "").trim();
    const uri = String(row.uri || "").trim();
    if (!id || !uri) continue;
    out.push({
      id,
      uri,
      name: String(row.name || "Track").slice(0, 200),
      artists: String(row.artists || "").slice(0, 200),
      albumArt: typeof row.albumArt === "string" ? row.albumArt : null,
    });
  }
  return out;
}

async function probeStore(event) {
  const store = getLinkStore(event);
  await store.setJSON("health", { ok: true, at: new Date().toISOString() });
  return true;
}

async function readLink(event, sub) {
  const store = getLinkStore(event);
  const row = await store.get(blobKey(sub), { type: "json" });
  if (!row || typeof row !== "object") return null;
  return row;
}

async function writeLink(event, sub, row) {
  const store = getLinkStore(event);
  await store.setJSON(blobKey(sub), row);
}

async function deleteLink(event, sub) {
  const store = getLinkStore(event);
  await store.delete(blobKey(sub));
}

function isInvalidGrant(status, code, desc) {
  if (code === "invalid_grant") return true;
  if (status === 401 && /grant|refresh token|authorization code/i.test(desc)) return true;
  return false;
}

async function spotifyTokenRequest(params) {
  const grantType = String(params.grant_type || "");
  const body = new URLSearchParams(params);
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  const secret = spotifyClientSecret();
  const clientId = spotifyClientId();
  if (!clientId) throw httpError(503, "Spotify Connect is not configured");
  // Secret optional — PKCE public-client exchange still works with client_id in the body.
  if (secret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`;
  }
  let res;
  try {
    res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers,
      body: body.toString(),
    });
  } catch {
    throw httpError(502, "Spotify token endpoint unreachable");
  }
  const payload = await res.json().catch(() => ({}));
  const code = String(payload.error || "").toLowerCase();
  const desc = String(payload.error_description || payload.error || "").slice(0, 180);
  const access = typeof payload.access_token === "string" ? payload.access_token.trim() : "";

  if (isInvalidGrant(res.status, code, desc)) {
    if (grantType === "refresh_token") throw httpError(401, SESSION_EXPIRED);
    throw httpError(400, "Spotify authorization expired — connect again");
  }
  if (res.status === 429) throw httpError(429, "Spotify rate limited — try again shortly");
  if (res.status >= 500) throw httpError(502, "Spotify token service unavailable");
  if (!res.ok) {
    throw httpError(res.status >= 400 && res.status < 500 ? 400 : 502, desc || `Spotify token ${res.status}`);
  }
  if (!isUsableAccessToken(access)) {
    throw httpError(502, "Spotify did not return an access token");
  }
  return { ...payload, access_token: access };
}

async function fetchMe(accessToken) {
  if (!isUsableAccessToken(accessToken)) return { status: 0, me: null };
  let res;
  try {
    res = await fetch(SPOTIFY_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return { status: 0, me: null };
  }
  if (!res.ok) return { status: res.status, me: null };
  const me = await res.json().catch(() => null);
  return { status: res.status, me };
}

function publicLink(row) {
  return {
    linked: true,
    displayName: row.displayName || row.spotifyUserId || "Spotify",
    product: row.product || null,
    spotifyUserId: row.spotifyUserId || null,
  };
}

async function refreshRow(row) {
  if (!isUsableRefreshToken(row?.refreshToken)) {
    throw httpError(401, SESSION_EXPIRED);
  }
  const json = await spotifyTokenRequest({
    grant_type: "refresh_token",
    refresh_token: row.refreshToken,
    client_id: spotifyClientId(),
  });
  const nextRefresh = isUsableRefreshToken(json.refresh_token)
    ? String(json.refresh_token).trim()
    : row.refreshToken;
  const expiresIn = Number(json.expires_in);
  return {
    ...row,
    accessToken: json.access_token,
    refreshToken: nextRefresh,
    tokenType: json.token_type || "Bearer",
    expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    updatedAt: new Date().toISOString(),
  };
}

function isDeadRefresh(e) {
  const status = Number(e?.statusCode) || 0;
  const msg = e instanceof Error ? e.message : String(e);
  return status === 401 || /invalid_grant/i.test(msg);
}

async function ensureFresh(event, sub, row, force) {
  if (!isUsableRefreshToken(row?.refreshToken)) return null;
  const freshEnough =
    !force &&
    isUsableAccessToken(row.accessToken) &&
    Number(row.expiresAt || 0) > Date.now() + 60_000;
  if (freshEnough) return row;
  try {
    const next = await refreshRow(row);
    await writeLink(event, sub, next);
    return next;
  } catch (e) {
    if (isDeadRefresh(e)) {
      await deleteLink(event, sub);
      throw httpError(401, SESSION_EXPIRED);
    }
    throw e;
  }
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw httpError(400, "Invalid JSON");
  }
}

async function storeFlag(event) {
  try {
    getLinkStore(event);
    return "ok";
  } catch {
    return "unavailable";
  }
}

async function handleStoreHealth(event) {
  try {
    const ok = await probeStore(event);
    if (!ok) return json(503, { error: "Spotify link store unavailable", detail: "health readback failed" });
    return json(200, { ok: true, store: "netlify-blobs" });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "store write failed";
    return json(503, { error: "Spotify link store unavailable", detail: safeErrorMessage(detail) });
  }
}

async function handleStatus(event) {
  const configured = isConfigured();
  const clientId = configured ? spotifyClientId() : "";
  const store = configured ? await storeFlag(event) : "skipped";
  const base = {
    configured,
    clientId,
    linked: false,
    displayName: null,
    product: null,
    store,
  };
  const token = bearerToken(event);
  if (!token) return json(200, base);
  let user;
  try {
    user = await verifyCognitoJwt(token);
  } catch {
    return json(200, base);
  }
  if (!configured || store !== "ok") return json(200, base);
  let row = null;
  try {
    row = await readLink(event, user.sub);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "read failed";
    return json(200, {
      ...base,
      store: "unavailable",
      error: "Spotify link store unavailable",
      detail: safeErrorMessage(detail),
    });
  }
  if (!isUsableRefreshToken(row?.refreshToken)) return json(200, base);
  return json(200, {
    configured: true,
    clientId,
    store,
    ...publicLink(row),
  });
}

async function handleExchange(event) {
  if (!isConfigured()) {
    return json(503, { error: "Spotify Connect is not configured" });
  }
  const user = await requireUser(event);
  const body = parseBody(event);
  const code = String(body.code || "").trim();
  const codeVerifier = String(body.codeVerifier || "").trim();
  const redirectUri = String(body.redirectUri || "").trim();
  if (!code || !codeVerifier) {
    return json(400, { error: "Missing code or codeVerifier" });
  }
  if (!isAllowedRedirect(redirectUri)) {
    return json(400, { error: "Redirect URI is not allowed" });
  }
  const tokens = await spotifyTokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: spotifyClientId(),
    code_verifier: codeVerifier,
  });
  if (!isUsableRefreshToken(tokens.refresh_token)) {
    return json(400, {
      error: "Spotify did not return a refresh token — reconnect and approve access",
    });
  }
  const me = await fetchMe(tokens.access_token);
  const expiresIn = Number(tokens.expires_in);
  const row = {
    refreshToken: String(tokens.refresh_token).trim(),
    accessToken: tokens.access_token,
    tokenType: tokens.token_type || "Bearer",
    expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    displayName: me.me?.display_name || me.me?.id || "Spotify",
    product: me.me?.product || null,
    spotifyUserId: me.me?.id || null,
    updatedAt: new Date().toISOString(),
  };
  await writeLink(event, user.sub, row);
  return json(200, {
    configured: true,
    clientId: spotifyClientId(),
    accessToken: row.accessToken,
    expiresAt: row.expiresAt,
    ...publicLink(row),
  });
}

async function handleToken(event) {
  if (!isConfigured()) {
    return json(503, { error: "Spotify Connect is not configured" });
  }
  const user = await requireUser(event);
  const force =
    String(event.queryStringParameters?.refresh || "") === "1" ||
    parseBody(event).refresh === true;
  const row = await readLink(event, user.sub);
  if (!isUsableRefreshToken(row?.refreshToken)) {
    return json(404, { error: "Spotify is not linked" });
  }
  let next = await ensureFresh(event, user.sub, row, force);
  if (!next || !isUsableAccessToken(next.accessToken)) {
    await deleteLink(event, user.sub);
    return json(401, { error: SESSION_EXPIRED });
  }
  // Client Spotify API 401 → ?refresh=1. Probe /me so a still-dead token is not returned.
  if (force) {
    const probe = await fetchMe(next.accessToken);
    if (probe.status === 401) {
      await deleteLink(event, user.sub);
      return json(401, { error: SESSION_EXPIRED });
    }
  }
  return json(200, {
    configured: true,
    accessToken: next.accessToken,
    expiresAt: next.expiresAt,
    ...publicLink(next),
  });
}

async function handleDisconnect(event) {
  const user = await requireUser(event);
  await deleteLink(event, user.sub);
  return json(200, { ok: true, linked: false, configured: isConfigured() });
}

async function handleQueueGet(event) {
  const user = await requireUser(event);
  const store = getLinkStore(event);
  const row = await store.get(queueKey(user.sub), { type: "json" });
  return json(200, { tracks: sanitizeQueueTracks(row?.tracks) });
}

async function handleQueueSave(event) {
  const user = await requireUser(event);
  const tracks = sanitizeQueueTracks(parseBody(event).tracks);
  const store = getLinkStore(event);
  await store.setJSON(queueKey(user.sub), {
    tracks,
    updatedAt: new Date().toISOString(),
  });
  return json(200, { ok: true, tracks });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  try {
    const action = actionFromEvent(event);
    if (action === "status" && event.httpMethod === "GET") {
      return await handleStatus(event);
    }
    if (action === "store" && event.httpMethod === "GET") {
      return await handleStoreHealth(event);
    }
    if (action === "exchange" && event.httpMethod === "POST") {
      return await handleExchange(event);
    }
    if (action === "token" && (event.httpMethod === "GET" || event.httpMethod === "POST")) {
      return await handleToken(event);
    }
    if (
      action === "disconnect" &&
      (event.httpMethod === "POST" || event.httpMethod === "DELETE")
    ) {
      return await handleDisconnect(event);
    }
    if (action === "queue" && event.httpMethod === "GET") {
      return await handleQueueGet(event);
    }
    if (action === "queue" && event.httpMethod === "POST") {
      return await handleQueueSave(event);
    }
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    const status = Number(e?.statusCode) || 500;
    const message = e instanceof Error ? e.message : "Spotify link failed";
    if (status >= 500 && /Cannot find module|blobs/i.test(message)) {
      return json(503, { error: "Spotify link store unavailable" });
    }
    return json(status >= 400 && status < 600 ? status : 500, {
      error: safeErrorMessage(message),
    });
  }
}
