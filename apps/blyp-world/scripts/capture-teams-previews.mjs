/**
 * Capture Teams desk preview panels into public/teams/
 * Uses system Chrome/Edge via playwright-core.
 */
import { chromium } from "playwright-core";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "public", "teams");
const BASE = process.env.TEAMS_PREVIEW_URL || "http://127.0.0.1:3456/teams/preview/";

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("Chrome/Edge not found");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const exe = await findChrome();
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector("[data-teams-desk]", { timeout: 60000 });
  await page.addStyleTag({
    content: `
      aside, nav[aria-label="Primary"], [data-site-sidebar] { display: none !important; }
      body { background: #07070a !important; }
    `,
  });

  const desk = page.locator("[data-teams-desk]");
  await desk.screenshot({
    path: path.join(OUT, "desk-overview.png"),
    type: "png",
  });

  await page.locator("h2", { hasText: "Roster" }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const rosterSection = page.locator("section").filter({ has: page.locator("h2", { hasText: "Roster" }) }).first();
  await rosterSection.screenshot({
    path: path.join(OUT, "desk-roster.png"),
    type: "png",
  });

  await page.locator("h2", { hasText: "Money clarity" }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const moneySection = page
    .locator("section")
    .filter({ has: page.locator("h2", { hasText: "Money clarity" }) })
    .first();
  await moneySection.screenshot({
    path: path.join(OUT, "desk-money.png"),
    type: "png",
  });

  console.log("Wrote:", fs.readdirSync(OUT).join(", "));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
