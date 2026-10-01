// originals never requested by dashboard pages either (network audit). env BASE, SEED
import { chromium } from "playwright-core"; import fs from "node:fs";
const BASE = process.env.BASE; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const log = (...a) => console.log(...a);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] }); const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.38.2.2" } }); const p = await c.newPage(); const urls = [];
p.on("request", (r) => urls.push(r.url().replace(BASE, "")));
await p.goto(BASE + "/login"); await p.fill('input[name="email"]', seed.maya.email); await p.fill('input[name="password"]', seed.password); await Promise.all([p.waitForURL("**/dashboard**"), p.locator('form button[type=submit]').click()]);
for (const path of ["/dashboard", "/dashboard/drops", `/dashboard/drops/${seed.maya.dropIds.spring}`]) { urls.length = 0; await p.goto(BASE + path); await p.waitForTimeout(800); const files = urls.filter((u) => u.startsWith("/api/files/")); const html = await p.content(); log(`[originals] ${path}: /api/files requests:`, [...new Set(files.map((u) => u.replace(/[0-9a-f-]{36}/, "<id>")))], "| any /original or signed:", files.some((u) => /original|signed/.test(u)) || /\/original|signed-url|storage_key/.test(html)); }
await b.close();
