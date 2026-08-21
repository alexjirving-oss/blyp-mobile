import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "lib/giftCinemaClips.ts"), "utf8");
const ids = [...src.matchAll(/cinemaId: "([^"]+)"/g)].map((m) => m[1]);
const publicDir = path.join(root, "public/gifts/cinema");
const missing = ids.filter((id) => !fs.existsSync(path.join(publicDir, `${id}.mp4`)));
console.log(JSON.stringify({ cinemaIds: ids.length, ids, missing }, null, 2));
if (missing.length) process.exit(1);
