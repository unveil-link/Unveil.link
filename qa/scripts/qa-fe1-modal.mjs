// Modal focus-return check using real mouse clicks (desktop + mobile). env BASE, SEED
import { chromium } from "playwright-core"; import fs from "node:fs";
const BASE = process.env.BASE; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const log = (...a) => console.log(...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] }); const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.36.1.1" } }); const p = await c.newPage();
await p.goto(BASE + "/login"); await p.fill('input[name="email"]', seed.maya.email); await p.fill('input[name="password"]', seed.password); await Promise.all([p.waitForURL("**/dashboard**"), p.locator('form button[type=submit]').click()]);
await p.goto(BASE + "/dashboard/drops"); await sleep(500);
const desc = () => p.evaluate(() => { const e = document.activeElement; return `${e?.tagName}:${(e?.textContent || "").trim().slice(0, 16)}`; });
for (const how of ["Escape", "Keep published", "Close dialog"]) { const t = p.locator('tbody button:has-text("Unpublish")').first(); await t.click(); await sleep(300); const inside = await p.evaluate(() => !!document.activeElement?.closest("dialog")); const init = await desc();
  if (how === "Escape") await p.keyboard.press("Escape"); else if (how === "Keep published") await p.locator('dialog[open] button:has-text("Keep published")').click(); else await p.locator('dialog[open] button[aria-label="Close dialog"]').click(); await sleep(300);
  log(`[a11y] modal opened by mouse; initial focus inside dialog=${inside} (${init}); closed via ${how}; focus now: ${await desc()}; trigger still in DOM: ${await t.count() > 0}`); }
await b.close();
