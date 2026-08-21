/**
 * Same-origin viewer presence for unsigned / incognito /live/:id watch.
 * Prefers live-service Admin increment; falls back to Firebase anonymous +
 * Firestore FieldTransform on streams/{id} + liveStreams/{id} (phone path).
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const LIVE_SERVICE_URL = (
  process.env.LIVE_SERVICE_URL ||
  process.env.NEXT_PUBLIC_LIVE_SERVICE_URL ||
  "https://blyp-live-service-innn3d7yqq-uc.a.run.app"
).replace(/\/+$/, "");

const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID ||
  "blyp-master";
const API_KEY =
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
  "AIzaSyAScxM-7tnuD0532VhY6bvaXvoWVEyDSF8";

const SESSION_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const PRESENCE_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function docPath(collection, id) {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${id}`;
}

async function incrementViaLiveService(sessionId, presenceId, action) {
  const res = await fetch(
    `${LIVE_SERVICE_URL}/api/live/watch/${encodeURIComponent(sessionId)}/presence`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, presenceId, action }),
    },
  );
  if (!res.ok) return null;
  return res.json().catch(() => ({ ok: true }));
}

async function anonymousIdToken() {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.idToken) return null;
  return String(payload.idToken);
}

async function incrementViaFirestore(sessionId, delta) {
  const token = await anonymousIdToken();
  if (!token) return false;
  const transforms = [
    { fieldPath: "viewerCount", increment: { integerValue: String(delta) } },
  ];
  if (delta > 0) {
    transforms.push({
      fieldPath: "totalViews",
      increment: { integerValue: String(delta) },
    });
  }
  const writes = ["streams", "liveStreams"].map((collection) => ({
    transform: {
      document: docPath(collection, sessionId),
      fieldTransforms: transforms,
    },
  }));
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ writes }),
    },
  );
  return res.ok;
}

export async function handler(event) {
  const method = String(event.httpMethod || event.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const sessionId = String(body.sessionId || "").trim();
  const presenceId = String(body.presenceId || "").trim();
  const action = body.action === "leave" ? "leave" : "join";
  if (!SESSION_RE.test(sessionId) || !PRESENCE_RE.test(presenceId)) {
    return json(400, { error: "Invalid session" });
  }

  try {
    const viaLive = await incrementViaLiveService(sessionId, presenceId, action);
    if (viaLive) return json(200, { ok: true, via: "live-service", ...viaLive });
  } catch {
    /* fallback */
  }

  const delta = action === "leave" ? -1 : 1;
  const ok = await incrementViaFirestore(sessionId, delta);
  if (!ok) return json(502, { error: "VIEWER_INCREMENT_FAILED" });
  return json(200, { ok: true, via: "firestore" });
}
