// FE QA part J: authz of new server-rendered dashboard pages (logged out / other seller), cache headers, focus return after modal. env BASE, SEED
import { chromium } from "playwright-core"; import fs from "node:fs";
const BASE = process.env.BASE; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const log = (...a) => console.log(...a);
const D = seed.maya.dropIds.spring;
for (const path of ["/dashboard", "/dashboard/drops", "/dashboard/drops/new", `/dashboard/drops/${D}`]) { const r = await fetch(BASE + path, { redirect: "manual" }); log(`[authz] logged-out GET ${path} ->`, r.status, r.headers.get("location"), "| cache-control:", r.headers.get("cache-control")); const t = await r.text(); log("   leaks seed title in body:", /Spring collection pack|Maya/.test(t)); }
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.40.3.4" } }); const p = await c.newPage();
await p.goto(BASE + "/login"); await p.fill('input[name="email"]', seed.jo.email); await p.fill('input[name="password"]', seed.password); await Promise.all([p.waitForURL("**/dashboard**"), p.locator('form button[type=submit]').click()]);
const r = await p.goto(`${BASE}/dashboard/drops/${D}`); const t = await p.locator("body").innerText(); log("[authz] Jo opening Maya's drop editor ->", r.status(), "| shows Maya data:", /Spring collection|Maya/.test(t), "|", t.replace(/\n+/g, " | ").slice(0, 120));
log("[authz] Jo's dashboard list leaks Maya drops:", await (async () => { await p.goto(BASE + "/dashboard/drops"); return /Spring collection|Studio colour|Travel set/.test(await p.locator("body").innerText()); })());
log("[authz] Jo POST /api/drops/<maya>/publish ->", await p.evaluate(async (id) => (await fetch(`/api/drops/${id}/unpublish`, { method: "POST", headers: { "content-type": "application/json" } })).status, D));
log("[authz] Jo /api/files preview of Maya file via dashboard thumb ->", await p.evaluate(async () => (await fetch("/api/files/00000000-0000-0000-0000-000000000000/preview")).status));
// focus return after modal
const q = await c.newPage(); await q.goto(BASE + "/dashboard/drops/" + seed.jo.dropId); await q.waitForTimeout(500);
await b.close();
const c2 = await (await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] })).newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.40.3.5" } }); const m = await c2.newPage();
await m.goto(BASE + "/login"); await m.fill('input[name="email"]', seed.maya.email); await m.fill('input[name="password"]', seed.password); await Promise.all([m.waitForURL("**/dashboard**"), m.locator('form button[type=submit]').click()]);
await m.goto(BASE + "/dashboard/drops"); await m.waitForTimeout(500); const trig = m.locator('tbody button:has-text("Unpublish")').first(); await trig.focus(); await m.keyboard.press("Enter"); await m.waitForTimeout(300);
const first = await m.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent); await m.keyboard.press("Escape"); await m.waitForTimeout(300);
log("[a11y] modal initial focus:", first, "| after Esc focus on:", await m.evaluate(() => `${document.activeElement?.tagName}:${(document.activeElement?.textContent || "").trim().slice(0, 20)}`));
// Keep published button path
await trig.focus(); await m.keyboard.press("Enter"); await m.waitForTimeout(300); await m.locator('dialog[open] button:has-text("Keep published")').click(); await m.waitForTimeout(300); log("[a11y] after 'Keep published' focus on:", await m.evaluate(() => `${document.activeElement?.tagName}:${(document.activeElement?.textContent || "").trim().slice(0, 20)}`));
await c2.browser().close();
