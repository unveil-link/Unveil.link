// FE QA part O: verified seller one-step "Upload & publish"; editor upload progress; dashboard overflow @360; env BASE, SEED, DB
import { chromium } from "playwright-core"; import pg from "pg"; import sharp from "sharp"; import fs from "node:fs"; import crypto from "node:crypto";
const BASE = process.env.BASE, OUT = "qa/artifacts/frontend-dashboard", TMP = "/workspace/qa-run5/out"; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const log = (...a) => console.log(...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] }); const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.35.1.1" } }); const p = await c.newPage(); const csp = [];
p.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
await p.goto(BASE + "/login"); await p.fill('input[name="email"]', seed.maya.email); await p.fill('input[name="password"]', seed.password); await Promise.all([p.waitForURL("**/dashboard**"), p.locator('form button[type=submit]').click()]);
const big = `${TMP}/big.jpg`; const t0 = Date.now();
await p.goto(BASE + "/dashboard/drops/new"); await p.fill('#title', "One-step publish"); await p.fill('#price', "7.50"); await p.setInputFiles('input[type=file]', [`${TMP}/a.jpg`]);
const pubCb = p.locator('label:has-text("Publish right after upload") input[type=checkbox]'); await pubCb.check(); await p.waitForTimeout(200);
await p.locator('form button[type=submit]').click(); await p.waitForTimeout(300); log("[M4-18] submit w/o attestations ->", (await p.locator('form [role=alert]').allInnerTexts()).join(" | "), "| label:", (await p.locator('form button[type=submit]').innerText()).trim());
for (const cb of await p.locator('form fieldset input[type=checkbox], form input[id^="new"]').all()) await cb.check().catch(() => {});
log("[M4-18] attestation checkboxes checked:", await p.locator('form input[type=checkbox]:checked').count());
await p.locator('form button[type=submit]').click(); await p.waitForSelector('[data-testid=drop-created]', { timeout: 30000 });
const link = (await p.locator('[data-testid=drop-link]').innerText()).trim(); const id = link.split("/u/")[1]; log("[M4-18] one-step result:", (await p.locator('[data-testid=drop-created]').innerText()).replace(/\n+/g, " | ").slice(0, 160), "| /u/ status:", (await fetch(`${BASE}/u/${id}`)).status, "| elapsed s:", ((Date.now() - t0) / 1000).toFixed(1));
const att = (await db.query("select attestation from drops where public_link_id=$1", [id])).rows[0]; log("[M2-05/UI] attestation stored:", JSON.stringify(att.attestation));
await p.screenshot({ path: `${OUT}/newdrop-one-step-published-desktop.png`, fullPage: true });
// editor upload progress with throttle
await p.goto(`${BASE}/dashboard/drops/${seed.maya.dropIds.draft}`); await p.waitForTimeout(500); const cdp = await c.newCDPSession(p); await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: -1, uploadThroughput: 4e6 / 8, latency: 50 });
const samples = []; await p.exposeFunction("__s", (s) => samples.push(s)); await p.evaluate(() => setInterval(() => window.__s([...document.querySelectorAll("[role=progressbar]")].map((e) => e.getAttribute("aria-valuenow")).join(",")), 200));
await p.setInputFiles('main input[type=file]', [big]); await p.locator('main button:has-text("Upload 1 file")').click(); await p.waitForTimeout(6000);
log("[M1-05] editor add-files progress samples:", [...new Set(samples)].filter(Boolean).slice(0, 12).join(" ; "), "| intermediate seen:", samples.some((s) => s && +s.split(",").pop() > 0 && +s.split(",").pop() < 100));
await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 });
// 360 overflow dashboard
const m = await b.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, extraHTTPHeaders: { "x-forwarded-for": "10.35.1.2" } }); const mp = await m.newPage();
await mp.goto(BASE + "/login"); await mp.fill('input[name="email"]', seed.maya.email); await mp.fill('input[name="password"]', seed.password); await Promise.all([mp.waitForURL("**/dashboard**"), mp.locator('form button[type=submit]').click()]);
for (const [n, path] of [["dashboard", "/dashboard"], ["drops", "/dashboard/drops"], ["new", "/dashboard/drops/new"], ["editor", `/dashboard/drops/${seed.maya.dropIds.spring}`]]) { await mp.goto(BASE + path); await mp.waitForTimeout(500); const r = await mp.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); log(`[M2-18] dashboard 360x800 ${n}: sw ${r[0]} cw ${r[1]} hscroll=${r[0] > r[1]}`); if (n === "dashboard") await mp.screenshot({ path: `${OUT}/dashboard-maya-mobile-360.png`, fullPage: true }); }
log("[csp] violations:", csp.length); await b.close(); await db.end();
