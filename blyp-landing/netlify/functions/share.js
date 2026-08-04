// Netlify Function: per-post share preview.
//
// Serves an HTML page with OpenGraph/Twitter tags so chat apps (WhatsApp,
// iMessage, Messenger, etc.) render a rich preview tile when a Blyp post link
// is shared. The post's title + public thumbnail are passed in the URL query
// (?t=&img=&v=), so this needs NO Firestore access or secrets — it just echoes
// them into meta tags. Human visitors are bounced on to the app (deep link)
// with a Play Store fallback; crawlers read the tags and stop.
//
// Routed via netlify.toml:  /p/*  ->  /.netlify/functions/share

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.blyp.mobile';
const HOME_URL = 'https://blyp.world';
const DEFAULT_IMAGE = 'https://blyp.world/assets/app-home.jpg';

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

exports.handler = async (event) => {
  const path = event.path || '';
  const match = path.match(/\/p\/([^/?#]+)/);
  const id = match ? decodeURIComponent(match[1]) : '';
  const q = event.queryStringParameters || {};

  const title = esc((q.t || 'A post on Blyp').slice(0, 160));
  const image = esc(q.img || DEFAULT_IMAGE);
  const video = q.v ? esc(q.v) : '';
  const pageUrl = esc(`${HOME_URL}/p/${encodeURIComponent(id)}`);
  const deepLink = esc(`blyp://post/${id}`);
  const description = 'Watch on Blyp — where posts earn their reach.';

  const videoTags = video
    ? `
    <meta property="og:video" content="${video}" />
    <meta property="og:video:secure_url" content="${video}" />
    <meta property="og:video:type" content="video/mp4" />
    <meta name="twitter:player:stream" content="${video}" />`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Blyp</title>

<meta property="og:site_name" content="Blyp" />
<meta property="og:type" content="${video ? 'video.other' : 'article'}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${pageUrl}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1080" />
<meta property="og:image:height" content="1920" />${videoTags}

<meta name="twitter:card" content="${video ? 'player' : 'summary_large_image'}" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${image}" />

<style>
  html,body{margin:0;height:100%;background:#0A0A0C;color:#fff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .wrap{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px}
  img{max-width:280px;width:70%;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.5);margin-bottom:24px}
  h1{font-size:20px;margin:0 0 8px}
  p{color:#9ca3af;margin:0 0 24px}
  a.btn{display:inline-block;background:#00D2BE;color:#0A0A0C;font-weight:800;text-decoration:none;padding:14px 28px;border-radius:999px}
</style>
</head>
<body>
  <div class="wrap">
    <img src="${image}" alt="${title}" />
    <h1>${title}</h1>
    <p>${esc(description)}</p>
    <a class="btn" href="${PLAY_URL}">Open in the Blyp app</a>
  </div>
  <script>
    // Try the app first; fall back to the Play Store shortly after.
    (function () {
      try {
        var opened = Date.now();
        window.location.href = ${JSON.stringify(`blyp://post/${id}`)};
        setTimeout(function () {
          if (Date.now() - opened < 2000) {
            window.location.href = ${JSON.stringify(PLAY_URL)};
          }
        }, 1200);
      } catch (e) {
        window.location.href = ${JSON.stringify(PLAY_URL)};
      }
    })();
  </script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
    body: html,
  };
};
