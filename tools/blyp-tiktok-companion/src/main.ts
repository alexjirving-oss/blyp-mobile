import { DEFAULT_HOST, DEFAULT_PORT, startServer } from "./server.js";

const port = Number(process.env.BLYP_TIKTOK_COMPANION_PORT || DEFAULT_PORT);
const host = process.env.BLYP_TIKTOK_COMPANION_HOST || DEFAULT_HOST;

startServer(host, port).catch((err) => {
  console.error("[blyp-tiktok-companion] failed to start:", err);
  process.exit(1);
});
