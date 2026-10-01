// FE-05 coverage: 429 from the dashboard upload flow (mocked Retry-After 3500) -> how is the wait shown? env BASE, SEED
import { chromium } from "playwright-core"; import fs from "node:fs";
const BASE = process.env.BASE; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8"));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] }); const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.65.1.1" } }); const p = await c.newPage();
await p.goto(BASE + "/login"); await p.fill('input[name="email"]', seed.maya.email); await p.fill('input[name="password"]', seed.password); await Promise.all([p.waitForURL("**/dashboard**"), p.locator("form button[type=submit]").click()]);
await p.route("**/api/drops", (r) => r.request().method() === "POST" ? r.fulfill({ status: 429, headers: { "retry-after": "3500", "content-type": "application/json" }, body: JSON.stringify({ error: "Too many requests", code: "rate_limited" }) }) : r.continue());
await p.goto(BASE + "/dashboard/drops/new"); await p.fill('#title', "T"); await p.fill('#price', "5.00");
await p.setInputFiles('input[type=file]', "/workspace/qa-run6/out/a.jpg"); await p.waitForTimeout(300);
await p.locator("form button[type=submit], button:has-text('Upload')").last().click(); await p.waitForTimeout(1200);
console.log("[upload-429] alerts/banners:", JSON.stringify(await p.locator("[role=alert], [data-testid*=banner]").allInnerTexts()));
await b.close();
