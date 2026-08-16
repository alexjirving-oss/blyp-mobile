/**
 * Per-post share landing for WhatsApp / iMessage / social crawlers.
 *
 * - Crawlers get 200 HTML with og:title / og:image (Firestore or legacy ?t=&img=).
 * - Humans get 302 → /v/:id/ (static For You player; works logged-out).
 *
 * Routed: /p/* → /.netlify/functions/share-post (status 200 rewrite).
 */

const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID ||
  "blyp-master";
const HOME_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.URL ||
  "https://blyp.world"
).replace(/\/+$/, "");
const DEFAULT_IMAGE = `${HOME_URL}/assets/app-home.jpg`;
const PLAY_URL = "https://play.google.com/store/apps/details?id=com.blyp.mobile";

const CRAWLER_RE =
  /whatsapp|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|pinterest|googlebot|bingbot|applebot|embedly|quora|redditbot|skypeuripreview|vkshare|w3c_validator|preview|bot|crawl|spider/i;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firestoreValue(node) {
  if (!node || typeof node !== "object") return null;
  if ("stringValue" in node) return node.stringValue;
  if ("integerValue" in node) return Number(node.integerValue);
  if ("doubleValue" in node) return Number(node.doubleValue);
  if ("booleanValue" in node) return !!node.booleanValue;
  if ("nullValue" in node) return null;
  if ("timestampValue" in node) return node.timestampValue;
  if ("arrayValue" in node) {
    const values = node.arrayValue?.values || [];
    return values.map(firestoreValue);
  }
  if ("mapValue" in node) {
    const fields = node.mapValue?.fields || {};
    const out = {};
    for (const [k, v] of Object.entries(fields)) out[k] = firestoreValue(v);
    return out;
  }
  return null;
}

function docToObject(doc) {
  const fields = doc?.fields || {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = firestoreValue(v);
  return out;
}

function pickStr(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function isHls(uri) {
  const u = String(uri || "").toLowerCase();
  return (
    u.includes(".m3u8") ||
    u.includes("application/vnd.apple.mpegurl") ||
    /\/hls\/|\/hls-|format=m3u8|type=m3u8/.test(u)
  );
}

function resolvePoster(raw) {
  if (!raw || typeof raw !== "object") return "";
  const media = Array.isArray(raw.media) ? raw.media : [];
  const first = media[0] && typeof media[0] === "object" ? media[0] : null;
  const candidates = [
    raw.thumbnailUrl,
    raw.thumbnail,
    raw.thumbUrl,
    raw.posterUrl,
    raw.previewUrl,
    raw.snapshotUrl,
    raw.coverImage,
    raw.imageUrl,
    raw.coverUrl,
    first?.thumbnailUrl,
    first?.thumbnail,
    first?.thumbUrl,
    first?.poster,
    first?.posterUrl,
    first?.previewUrl,
    first?.type && String(first.type).includes("image") ? first?.url : null,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const trimmed = c.trim();
    if (!trimmed) continue;
    if (isHls(trimmed)) continue;
    if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(trimmed)) continue;
    return trimmed;
  }
  return "";
}

function resolveTitle(raw) {
  return (
    pickStr(raw?.title, raw?.captionTitle, raw?.caption, raw?.description, raw?.name) ||
    "A post on Blyp"
  );
}

function resolveUsername(raw) {
  const user =
    raw?.user && typeof raw.user === "object" ? raw.user : null;
  const handle = pickStr(
    raw?.username,
    raw?.userName,
    raw?.handle,
    raw?.authorUsername,
    raw?.displayName,
    user?.username,
    user?.handle,
    user?.displayName,
  );
  return handle ? handle.replace(/^@/, "") : "";
}

async function fetchPost(id) {
  if (!id) return null;
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID,
  )}/databases/(default)/documents/posts/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    return docToObject(json);
  } catch {
    return null;
  }
}

function extractId(event) {
  const path = event.path || event.rawUrl || "";
  const fromPath = path.match(/\/p\/([^/?#]+)/);
  if (fromPath?.[1] && fromPath[1] !== "share-post") {
    try {
      return decodeURIComponent(fromPath[1]);
    } catch {
      return fromPath[1];
    }
  }
  const q = event.queryStringParameters || {};
  if (q.id) return String(q.id);
  // Netlify splat style: /p/POSTID rewritten with path still /p/POSTID
  const segments = String(path).split("/").filter(Boolean);
  const pIdx = segments.indexOf("p");
  if (pIdx >= 0 && segments[pIdx + 1]) {
    try {
      return decodeURIComponent(segments[pIdx + 1]);
    } catch {
      return segments[pIdx + 1];
    }
  }
  return "";
}

function isCrawler(event) {
  const headers = event.headers || {};
  const ua =
    headers["user-agent"] ||
    headers["User-Agent"] ||
    headers["x-facebook-crawler"] ||
    "";
  return CRAWLER_RE.test(String(ua));
}

function buildOgHtml({ id, title, description, image, pageUrl, watchUrl }) {
  const safeTitle = esc(title);
  const safeDesc = esc(description);
  const safeImage = esc(image);
  const safePage = esc(pageUrl);
  const safeWatch = esc(watchUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle} · Blyp</title>
<meta name="description" content="${safeDesc}" />

<meta property="og:site_name" content="Blyp" />
<meta property="og:type" content="video.other" />
<meta property="og:title" content="${safeTitle}" />
<meta property="og:description" content="${safeDesc}" />
<meta property="og:url" content="${safePage}" />
<meta property="og:image" content="${safeImage}" />
<meta property="og:image:secure_url" content="${safeImage}" />
<meta property="og:image:width" content="1080" />
<meta property="og:image:height" content="1920" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${safeTitle}" />
<meta name="twitter:description" content="${safeDesc}" />
<meta name="twitter:image" content="${safeImage}" />

<link rel="canonical" href="${safePage}" />
<meta http-equiv="refresh" content="0;url=${safeWatch}" />
<style>
  html,body{margin:0;height:100%;background:#0A0A0C;color:#fff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .wrap{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px}
  img{max-width:280px;width:70%;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.5);margin-bottom:24px}
  h1{font-size:20px;margin:0 0 8px}
  p{color:#9ca3af;margin:0 0 24px;max-width:28rem}
  a.btn{display:inline-block;background:#00D2BE;color:#0A0A0C;font-weight:800;text-decoration:none;padding:14px 28px;border-radius:999px;margin:6px}
</style>
</head>
<body>
  <div class="wrap">
    <img src="${safeImage}" alt="${safeTitle}" />
    <h1>${safeTitle}</h1>
    <p>${safeDesc}</p>
    <a class="btn" href="${safeWatch}">Watch on Blyp</a>
    <a class="btn" href="${esc(PLAY_URL)}" style="background:#1f2937;color:#fff">Get the app</a>
  </div>
  <script>
    (function () {
      try { window.location.replace(${JSON.stringify(watchUrl)}); } catch (e) {
        window.location.href = ${JSON.stringify(watchUrl)};
      }
    })();
  </script>
</body>
</html>`;
}

export async function handler(event) {
  const id = extractId(event);
  const q = event.queryStringParameters || {};

  if (!id || id === "_" || id === "share-post") {
    return {
      statusCode: 302,
      headers: { Location: `${HOME_URL}/foryou/`, "Cache-Control": "no-store" },
      body: "",
    };
  }

  const watchUrl = `${HOME_URL}/v/${encodeURIComponent(id)}/`;
  const pageUrl = `${HOME_URL}/p/${encodeURIComponent(id)}`;

  // Humans → player immediately (preserve clean /p/:id as share URL for crawlers).
  if (!isCrawler(event)) {
    return {
      statusCode: 302,
      headers: {
        Location: watchUrl,
        "Cache-Control": "public, max-age=60",
      },
      body: "",
    };
  }

  let title = pickStr(q.t).slice(0, 160);
  let image = pickStr(q.img);
  let username = "";

  const post = await fetchPost(id);
  if (post) {
    if (!title) title = resolveTitle(post).slice(0, 160);
    if (!image) image = resolvePoster(post);
    username = resolveUsername(post);
  }

  if (!title) title = "A post on Blyp";
  if (!image) image = DEFAULT_IMAGE;
  // Absolute HTTPS only for OG image (reject relative / schemes WhatsApp rejects).
  if (!/^https:\/\//i.test(image)) image = DEFAULT_IMAGE;

  const description = username
    ? `Watch @${username} on Blyp — short video, LIVE, and Stage.`
    : "Watch on Blyp — short video, LIVE, and Stage.";

  const html = buildOgHtml({
    id,
    title,
    description,
    image,
    pageUrl,
    watchUrl,
  });

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
    body: html,
  };
}
