// UI upload/publish smoke (playwright-core + system Chrome). Usage: BASE=.. DB=.. node qa/scripts/qa-ui-smoke2.mjs
import { chromium } from "playwright-core"; import sharp from "sharp"; import pg from "pg"; import crypto from "node:crypto"; import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3200";
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await (await b.newContext()).newPage();
const email = `qa-ui2-${crypto.randomBytes(3).toString("hex")}@example.com`;
await p.goto(BASE + "/signup"); await p.fill('input[name="displayName"]', "UI2"); await p.fill('input[name="email"]', email); await p.fill('input[name="password"]', "Passw0rd!long");
await Promise.all([p.waitForURL("**/dashboard"), p.click('button[type="submit"]')]);
await p.fill('input[name="title"]', "UI drop"); await p.fill('input[name="price"]', "20");
await p.click('button:has-text("Create draft")'); await p.waitForURL("**/dashboard/drops/**", { timeout: 10000 }).catch(() => {});
console.log("[M2-01] after create URL:", p.url());
const jpg = "/workspace/qa-run/out/ui.jpg"; await sharp({ create: { width: 600, height: 400, channels: 3, background: "#a55" } }).jpeg().toFile(jpg);
await p.setInputFiles('input[type=file]', jpg); await p.click('button:has-text("Upload")'); await p.waitForTimeout(1500);
console.log("[M1-05] body after upload shows file/preview imgs:", await p.locator("img").count(), "| progress element:", await p.locator('progress,[role=progressbar]').count());
console.log("[M2-03] UI page text excerpt:", (await p.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 400));
await p.screenshot({ path: "/workspace/qa-run/out/ui-drop.png", fullPage: true });
await p.setViewportSize({ width: 390, height: 844 });
await b.close(); await db.end();
