import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "node_modules", "amazon-ivs-player", "package.json");
if (!fs.existsSync(pkgPath)) {
  console.error("[copy-ivs-player-assets] amazon-ivs-player is not installed");
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const V = String(pkg.version || "").trim();
if (!V) {
  console.error("[copy-ivs-player-assets] missing amazon-ivs-player version");
  process.exit(1);
}

const assets = path.join(root, "node_modules", "amazon-ivs-player", "dist", "assets");
const dest = path.join(root, "public", "ivs", V);
fs.mkdirSync(dest, { recursive: true });
for (const name of [
  "amazon-ivs-wasmworker.min.js",
  "amazon-ivs-wasmworker.min.wasm",
  "amazon-ivs-worker.min.js",
]) {
  const from = path.join(assets, name);
  if (!fs.existsSync(from)) {
    console.error("[copy-ivs-player-assets] missing", name);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(dest, name));
}

fs.writeFileSync(
  path.join(root, "public", "amazon-ivs-service-worker-loader.js"),
  `importScripts("https://player.live-video.net/${V}/amazon-ivs-service-worker.min.js");\n`,
);
fs.writeFileSync(
  path.join(root, "lib", "ivsPlayerVersion.ts"),
  `export const IVS_PLAYER_ASSET_VERSION = ${JSON.stringify(V)};\n`,
);
console.log("[copy-ivs-player-assets] copied IVS player assets", V);
