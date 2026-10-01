// FE dashboard QA part B: find 404 URLs, dashboard numbers vs DB, editor controls, a11y on dashboard. env BASE, DB, SEED, OUT
import { chromium } from "playwright-core"; import pg from "pg"; import fs from "node:fs";
const BASE = process.env.BASE, OUT = process.env.OUT ?? "qa/artifacts/frontend-dashboard"; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8"));
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect(); const log = (...a) => console.log(...a);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
// 404 sources
{ const c = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await c.newPage(); const bad = [];
  p.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace(BASE, "")}`); }); p.on("requestfailed", (r) => bad.push(`FAILED ${r.url().replace(BASE, "")} ${r.failure()?.errorText}`));
  for (const path of ["/u/" + seed.maya.links.spring, "/", "/signup", "/login", "/forgot-password"]) { bad.length = 0; await p.goto(BASE + path); await p.waitForTimeout(800); log("[console/404] ", path, "->", JSON.stringify(bad)); } await c.close(); }
async function login(email, vp = { width: 1280, height: 800 }) { const c = await b.newContext({ viewport: vp }); const p = await c.newPage(); p.csp = []; p.cons = [];
  p.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) p.csp.push(t.slice(0, 200)); else if (m.type() === "error") p.cons.push(t.slice(0, 160)); }); p.on("pageerror", (e) => p.cons.push("pageerror " + e.message));
  await p.goto(BASE + "/login"); await p.fill('input[name="email"]', email); await p.fill('input[name="password"]', seed.password); await Promise.all([p.waitForURL("**/dashboard**", { timeout: 15000 }), p.locator('button[type="submit"]').click()]); return [c, p]; }
// Maya (populated)
const [c, p] = await login(seed.maya.email); await p.waitForTimeout(500);
log("[M4-09] /dashboard url", p.url()); const txt = (await p.locator("main").innerText()).replace(/\n+/g, " | "); log("[M4-09] dashboard main text:", txt.slice(0, 1500));
await p.screenshot({ path: `${OUT}/dashboard-maya-desktop.png`, fullPage: true });
const mid = (await db.query("select id from sellers where email=$1", [seed.maya.email])).rows[0].id;
const t = (await db.query(`select coalesce(sum(amount_cents),0) gross, coalesce(sum(platform_fee_cents),0) plat, coalesce(sum(processing_fee_cents),0) proc, coalesce(sum(seller_net_cents),0) net, count(*) n from transactions where seller_id=$1 and status='succeeded'`, [mid])).rows[0];
const po = (await db.query(`select status, sum(amount_cents) s from payouts where seller_id=$1 group by 1`, [mid])).rows;
log("[M4-09] DB truth:", JSON.stringify(t), JSON.stringify(po), "fee_percent:", (await db.query("select fee_percent from platform_settings")).rows[0]);
const per = (await db.query(`select d.title, count(t.*) units, coalesce(sum(t.amount_cents),0) rev from drops d left join transactions t on t.drop_id=d.id and t.status='succeeded' where d.seller_id=$1 group by d.title order by 1`, [mid])).rows; log("[M4-10] DB per-drop:", JSON.stringify(per));
await p.goto(BASE + "/dashboard/drops"); await p.waitForTimeout(500); const dl = (await p.locator("main").innerText()).replace(/\n+/g, " | "); log("[M4-10] drops list text:", dl.slice(0, 2200));
await p.screenshot({ path: `${OUT}/drops-list-maya-desktop.png`, fullPage: true });
log("[M4-10] 'views'/'conversion' text present:", /views|conversion/i.test(dl)); log("[M4-11] 'transaction|country|history' on dashboard/drops:", /transaction|country|history/i.test(txt + dl));
await p.goto(BASE + "/dashboard/transactions"); log("[M4-11] /dashboard/transactions status text:", (await p.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 100));
// drop editor
await p.goto(BASE + `/dashboard/drops/${seed.maya.dropIds.spring}`); await p.waitForTimeout(500); const et = (await p.locator("main").innerText()).replace(/\n+/g, " | "); log("[M2-10/13] editor text:", et.slice(0, 900));
log("[M2-10/13] editor inputs:", await p.locator("main input:not([type=file]):not([type=hidden]), main textarea").count(), "| buttons:", await p.locator("main button").allInnerTexts(), "| delete/edit controls:", await p.locator('main :text-matches("delete|remove|edit|save", "i")').count());
await p.screenshot({ path: `${OUT}/drop-editor-maya-desktop.png`, fullPage: true });
for (const m of ["PATCH", "PUT", "DELETE"]) { const r = await p.evaluate(async ([m, id]) => { const r = await fetch(`/api/drops/${id}`, { method: m, headers: { "content-type": "application/json" }, body: m === "DELETE" ? undefined : JSON.stringify({ title: "x" }) }); return r.status; }, [m, seed.maya.dropIds.spring]); log(`[M2-10/13] ${m} /api/drops/:id ->`, r); }
log("[M4-17] profile controls: /dashboard/settings|profile:", await (async () => { const out = []; for (const x of ["/dashboard/settings", "/dashboard/profile", "/settings", "/profile"]) { const r = await p.goto(BASE + x); out.push(x + "=" + r.status()); } return out.join(" "); })());
for (const m of ["PATCH", "PUT"]) log(`[M4-17] ${m} /api/auth/me ->`, await p.evaluate(async (m) => (await fetch("/api/auth/me", { method: m, headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "x" }) })).status, m));
log("[M6-06] banner/status text on dashboard:", /incident|status|maintenance|degraded/i.test(txt));
log("[csp/console] maya session: csp", p.csp.length, "errors", p.cons.length, p.cons); await c.close();
// Sam (empty), Jo (pending)
for (const k of ["sam", "jo"]) { const [c2, p2] = await login(seed[k].email); await p2.waitForTimeout(500); log(`[M4-09] ${k} dashboard:`, (await p2.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 700)); await p2.screenshot({ path: `${OUT}/dashboard-${k}-desktop.png`, fullPage: true }); log(`[csp] ${k}:`, p2.csp.length, p2.cons); await c2.close(); }
// mobile dashboard
{ const [c3, p3] = await login(seed.maya.email, { width: 390, height: 844 }); for (const [n, path] of [["dashboard", "/dashboard"], ["drops", "/dashboard/drops"], ["new", "/dashboard/drops/new"], ["editor", `/dashboard/drops/${seed.maya.dropIds.spring}`]]) { await p3.goto(BASE + path); await p3.waitForTimeout(500); const m = await p3.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); log(`[M2-18] dashboard mobile 390 ${n}: sw ${m[0]} cw ${m[1]} hscroll=${m[0] > m[1]}`); await p3.screenshot({ path: `${OUT}/${n}-maya-mobile-390.png`, fullPage: true }); } log("[csp] mobile", p3.csp.length, p3.cons); await c3.close(); }
await b.close(); await db.end();
