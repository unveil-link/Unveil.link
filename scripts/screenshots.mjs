// Usage: node scripts/screenshots.mjs [baseUrl]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const out = new URL("../screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const shots = [
  ["home-mobile-390x844.png", "/", { width: 390, height: 844 }, 2],
  ["home-desktop-1280x800.png", "/", { width: 1280, height: 800 }, 1],
  ["design-desktop-1280x800.png", "/design", { width: 1280, height: 800 }, 1],
  ["design-mobile-390x844.png", "/design", { width: 390, height: 844 }, 2],
  ["home-360x800.png", "/", { width: 360, height: 800 }, 2],
];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
for (const [name, path, viewport, dsf] of shots) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: out + name, fullPage: true });
  console.log(name, "horizontal overflow px:", overflow);
  await ctx.close();
}
await browser.close();
