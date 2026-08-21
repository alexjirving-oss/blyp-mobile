import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy RN gift cinema MP4s into Next public/ so studio/watch can play them.
 * Source of truth: repo assets/gifts/cinema/clips/
 */
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const srcDir = path.join(repoRoot, "assets", "gifts", "cinema", "clips");
const destDir = path.join(appRoot, "public", "gifts", "cinema");

const FILES = [
  "rocket.mp4",
  "crown.mp4",
  "diamond.mp4",
  "cheer_burst.mp4",
  "fire.mp4",
  "lion_baby.mp4",
  "lion_big.mp4",
  "mad_hearts.mp4",
  "mad_confetti.mp4",
  "mad_rose.mp4",
  "mad_donut.mp4",
  "mad_thanks_gift.mp4",
  "mad_thanks_likes.mp4",
  "mad_thanks_share.mp4",
  "mad_gift_avalanche.mp4",
];

if (!fs.existsSync(srcDir)) {
  console.error("[copy-gift-cinema-assets] missing source", srcDir);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
let copied = 0;
for (const name of FILES) {
  const from = path.join(srcDir, name);
  if (!fs.existsSync(from)) {
    console.error("[copy-gift-cinema-assets] missing", name);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(destDir, name));
  copied += 1;
}

console.log(
  `[copy-gift-cinema-assets] copied ${copied} clips → public/gifts/cinema/`,
);
