import http from "node:http";
import { URL } from "node:url";
import { applyManualCredentials, beginConnectFlow, isTikTokLiveStudioInstalled, findTikTokLiveStudioExe } from "./credentials.js";
import { readStatus, resetStatus } from "./state.js";
import type { CredentialsPayload, HealthResponse } from "./types.js";

export const VERSION = "0.2.0";
export const DEFAULT_PORT = 8765;
export const DEFAULT_HOST = "127.0.0.1";

const ALLOWED_ORIGINS = new Set([
  "https://blyp.world",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  return false;
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  const allowed = origin && isAllowedOrigin(origin) ? origin : "https://blyp.world";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  origin?: string,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(origin),
  });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<CredentialsPayload> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as CredentialsPayload;
  } catch {
    return {};
  }
}

function setupPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Blyp TikTok Companion</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0b1220; color: #e5eefc; margin: 0; padding: 24px; }
    main { max-width: 520px; margin: 0 auto; }
    h1 { font-size: 1.25rem; margin: 0 0 8px; }
    p { color: #94a3b8; line-height: 1.5; }
    label { display: block; margin: 14px 0 6px; font-size: 0.85rem; }
    input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #111827; color: #f8fafc; }
    button { margin-top: 18px; width: 100%; padding: 12px; border: 0; border-radius: 999px; background: #14b8a6; color: #042f2e; font-weight: 700; cursor: pointer; }
    .ok { color: #34d399; margin-top: 12px; }
    .err { color: #f87171; margin-top: 12px; }
    a { color: #5eead4; }
  </style>
</head>
<body>
  <main>
    <h1>Blyp TikTok Companion</h1>
    <p>Paste the <strong>Server URL</strong> and <strong>Stream key</strong> from
      TikTok Live Studio (Go LIVE → Stream settings) if automatic connect did not fill them.
      Keys stay on this PC and are sent only to your open Blyp Studio tab on localhost.</p>
    <form id="form">
      <label>TikTok @handle (optional)</label>
      <input name="handle" placeholder="@yourhandle" autocomplete="off" />
      <label>Server URL</label>
      <input name="rtmpUrl" placeholder="rtmp://push.tiktok.com/live/..." autocomplete="off" required />
      <label>Stream key</label>
      <input name="streamKey" type="password" placeholder="Stream key" autocomplete="off" required />
      <button type="submit">Save for Blyp Studio</button>
      <p id="msg"></p>
    </form>
  </main>
  <script>
    const form = document.getElementById('form');
    const msg = document.getElementById('msg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = 'Saving…';
      msg.className = '';
      const data = Object.fromEntries(new FormData(form).entries());
      const res = await fetch('/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.connected) {
        msg.textContent = 'Connected — return to Blyp Live Studio.';
        msg.className = 'ok';
      } else {
        msg.textContent = payload.error || payload.message || 'Could not save credentials';
        msg.className = 'err';
      }
    });
  </script>
</body>
</html>`;
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
    const pathname = url.pathname;

    try {
      if (req.method === "GET" && pathname === "/health") {
        const exe = findTikTokLiveStudioExe();
        const body: HealthResponse = {
          ok: true,
          version: VERSION,
          port: DEFAULT_PORT,
          liveStudioInstalled: isTikTokLiveStudioInstalled(),
          installedExe: exe || undefined,
        };
        sendJson(res, 200, body, origin);
        return;
      }

      if (req.method === "GET" && pathname === "/status") {
        sendJson(res, 200, readStatus(), origin);
        return;
      }

      if (req.method === "POST" && pathname === "/connect") {
        resetStatus();
        const result = await beginConnectFlow();
        const status = readStatus();
        sendJson(res, result.connected ? 200 : 202, status, origin);
        return;
      }

      if (
        req.method === "POST" &&
        (pathname === "/credentials" || pathname === "/paste" || pathname === "/setup")
      ) {
        const body = await readJsonBody(req);
        const result = applyManualCredentials({
          rtmpUrl: body.rtmpUrl || "",
          streamKey: body.streamKey || "",
          handle: body.handle,
        });
        if (!result.ok) {
          sendJson(res, 400, { ...readStatus(), error: result.message }, origin);
          return;
        }
        sendJson(res, 200, readStatus(), origin);
        return;
      }

      if (req.method === "GET" && (pathname === "/" || pathname === "/setup")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(setupPageHtml());
        return;
      }

      sendJson(res, 404, { error: "Not found" }, origin);
    } catch (e) {
      sendJson(
        res,
        500,
        {
          error: e instanceof Error ? e.message : "Internal error",
        },
        origin,
      );
    }
  });
}

export async function startServer(
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
): Promise<http.Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  console.log(
    `[blyp-tiktok-companion] listening on http://${host}:${port} (paste UI: /setup)`,
  );
  return server;
}
