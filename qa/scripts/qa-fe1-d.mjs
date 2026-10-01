// FE QA part D: 429 countdown vs real login delay; forgot/reset flow; env BASE, DB, MAIL, SEED, OUT
import { chromium } from "playwright-core"; import pg from "pg"; import fs from "node:fs"; import crypto from "node:crypto";
const BASE = process.env.BASE, OUT = process.env.OUT ?? "qa/artifacts/frontend-dashboard", MAIL = process.env.MAIL; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8"));
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect(); const log = (...a) => console.log(...a);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); const csp = [], cons = [];
p.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t.slice(0, 200)); else if (m.type() === "error") cons.push(t.slice(0, 160)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ---- real progressive delay on /login (fresh account so counters start at 0)
const email = `qa-delay-${crypto.randomBytes(3).toString("hex")}@example.com`;
{ const r = await fetch(BASE + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "10.9.8.7" }, body: JSON.stringify({ email, password: "Sunrise-Harbor-4821", displayName: "Delay Tester" }) }); log("[429] signup fresh account", r.status); }
const resp = [];
p.on("response", async (r) => { if (r.url().endsWith("/api/auth/login")) { const t = Date.now(); const body = await r.text().catch(() => ""); resp.push({ t, status: r.status(), ra: r.headers()["retry-after"], body }); } });
await p.goto(BASE + "/login"); await p.fill('input[name="email"]', email);
const btn = p.locator('form button[type=submit]'); const rows = [];
const txt = async (sel) => ((await p.locator(sel).count()) ? (await p.locator(sel).first().innerText()).trim() : null);
for (let i = 1; i <= 14; i++) {
  const t0 = Date.now(); while (await btn.isDisabled()) { await sleep(100); if (Date.now() - t0 > 70000) break; }
  const waited = Date.now() - t0; await p.fill('input[name="password"]', "Wrong-Password-" + i + "x"); const n = resp.length; await btn.click(); const t1 = Date.now(); while (resp.length === n && Date.now() - t1 < 5000) await sleep(20); await sleep(150);
  const r = resp[resp.length - 1]; let code = "?"; try { code = JSON.parse(r.body).code; } catch {}
  const row = { attempt: i, status: r.status, retryAfter: r.ra ?? null, code, btnLabel: (await btn.innerText()).trim(), card: await txt('[data-testid=countdown]'), btnDisabled: await btn.isDisabled(), cardTitle: await txt('[data-testid=throttle-notice] p'), waitedForEnabledMs: waited };
  if (r.status === 429) { const ticks = []; for (let k = 0; k < Math.min(+r.ra, 3); k++) { ticks.push((await txt('[data-testid=countdown]')) ?? "-"); await sleep(1000); } row.ticks = ticks.join(","); }
  rows.push(row);
  if (i === 6) await p.screenshot({ path: `${OUT}/login-delay-countdown-desktop.png`, fullPage: true });
}
for (const r of rows) log("[429] " + JSON.stringify(r));
log("[429] sequence of Retry-After:", rows.filter((r) => r.status === 429).map((r) => r.retryAfter).join(","));
log("[429] live regions:", JSON.stringify(await p.locator('[role=status]').allInnerTexts()), "| throttle-notice role attr:", await p.locator('[data-testid=throttle-notice]').count());
{ const t0 = Date.now(); while (await btn.isDisabled()) { await sleep(100); if (Date.now() - t0 > 70000) break; } await p.fill('input[name="password"]', "Sunrise-Harbor-4821"); const n = resp.length; await btn.click(); await sleep(2500); const r = resp[resp.length - 1]; log("[429] correct pw after countdown ended ->", r.status, r.ra, "| url", p.url()); }
// correct pw DURING a delay from the UI perspective: button disabled so UI cannot even submit
// ---- page reload during lock: does state persist?
await c.clearCookies();
const p2 = await c.newPage(); await p2.goto(BASE + "/login"); await p2.fill('input[name="email"]', "nobody-" + crypto.randomBytes(3).toString("hex") + "@example.com");
const rr = []; p2.on("response", async (r) => { if (r.url().endsWith("/api/auth/login")) rr.push({ s: r.status(), ra: r.headers()["retry-after"] }); });
for (let i = 0; i < 7; i++) { await p2.fill('input[name="password"]', "Bad-Pass-" + i + "zz"); await p2.locator('form button[type=submit]').click(); await sleep(700); }
log("[429] unknown-email attempts:", JSON.stringify(rr));
// ---- forgot / reset flow
const fe = `qa-reset-${crypto.randomBytes(3).toString("hex")}@example.com`;
{ const r = await fetch(BASE + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "10.9.9.9" }, body: JSON.stringify({ email: fe, password: "Sunrise-Harbor-4821", displayName: "Reset Tester" }) }); log("[forgot] signup", r.status); }
const q = await c.newPage(); const mails0 = new Set(fs.readdirSync(MAIL));
await q.goto(BASE + "/forgot-password"); await q.locator('form button[type=submit]').click(); await q.waitForTimeout(300); log("[forgot] empty submit:", await q.locator('[role=alert]').allInnerTexts());
await q.fill('input[name="email"]', "bad@"); await q.locator('input[name="email"]').blur(); log("[forgot] bad email:", await q.locator('[role=alert]').allInnerTexts());
await q.fill('input[name="email"]', fe); await q.locator('form button[type=submit]').click(); await q.waitForSelector('[data-testid=forgot-done]'); log("[forgot] done text:", (await q.locator('[data-testid=forgot-done]').innerText()).replace(/\n+/g, " | "), "| focus on:", await q.evaluate(() => document.activeElement?.tagName)); await q.screenshot({ path: `${OUT}/forgot-done-desktop.png`, fullPage: true });
let mail = null; for (let i = 0; i < 30 && !mail; i++) { await sleep(300); const f = fs.readdirSync(MAIL).filter((x) => !mails0.has(x)); if (f.length) mail = fs.readFileSync(`${MAIL}/${f[0]}`, "utf8"); }
log("[forgot] mail file:", mail ? mail.replace(/\n+/g, " ⏎ ").slice(0, 700) : "NONE");
const link = mail && mail.match(/https?:\/\/[^\s"<>]+reset-password\?token=[^\s"<>]+/)?.[0]; log("[forgot] reset link:", link ? link.replace(/token=.*/, "token=<redacted>") : null);
const rp = await c.newPage(); const rcsp = []; rp.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) rcsp.push(m.text()); });
await rp.goto(BASE + "/reset-password"); log("[reset] no token:", (await rp.locator("main, body").first().innerText()).replace(/\n+/g, " | ").slice(0, 200));
await rp.goto(BASE + "/reset-password?token=bogus"); await rp.fill('input[name="password"]', "Zebra-Quartz-9315-x"); const sub = rp.locator('form button[type=submit]'); await sub.click(); await rp.waitForTimeout(800); log("[reset] bogus token:", (await rp.locator('[role=alert]').allInnerTexts()).join(" | ")); await rp.screenshot({ path: `${OUT}/reset-invalid-token-desktop.png`, fullPage: true });
const tok = new URL(link).searchParams.get("token");
await rp.goto(link); const pws = rp.locator('input[type=password], input[name=password]'); log("[reset] password inputs:", await pws.count());
await rp.fill('input[name="password"]', "password1234"); await sub.click(); await rp.waitForTimeout(800); log("[reset] weak pw:", (await rp.locator('[role=alert]').allInnerTexts()).join(" | "));
await rp.fill('input[name="password"]', "short"); await rp.locator('input[name="password"]').blur(); log("[reset] short pw:", (await rp.locator('[role=alert],[id$=-error]').allInnerTexts()).join(" | "));
await rp.fill('input[name="password"]', "Zebra-Quartz-9315-x"); await sub.click(); await rp.waitForTimeout(1500); log("[reset] success ->", rp.url(), "|", (await rp.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 300)); await rp.screenshot({ path: `${OUT}/reset-success-desktop.png`, fullPage: true });
const rl = await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "10.9.9.10" }, body: JSON.stringify({ email: fe, password: "Zebra-Quartz-9315-x" }) })).status; const old = await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "10.9.9.11" }, body: JSON.stringify({ email: fe, password: "Sunrise-Harbor-4821" }) })).status; log("[reset] login new pw:", rl, "old pw:", old);
await rp.goto(`${BASE}/reset-password?token=${tok}`); await rp.fill('input[name="password"]', "Another-Strong-7731-y"); await rp.locator('form button[type=submit]').click(); await rp.waitForTimeout(800); log("[reset] reuse token:", (await rp.locator('[role=alert]').allInnerTexts()).join(" | "), "| csp", rcsp.length);
// forgot 429
const q2 = await c.newPage(); const frr = []; q2.on("response", (r) => { if (r.url().endsWith("/api/auth/forgot-password")) frr.push(`${r.status()} ra=${r.headers()["retry-after"]}`); });
await q2.goto(BASE + "/forgot-password"); await q2.fill('input[name="email"]', "x" + crypto.randomBytes(2).toString("hex") + "@example.com");
for (let i = 0; i < 8; i++) { const bt = q2.locator('form button[type=submit]'); if (await bt.isDisabled()) break; await bt.click(); await q2.waitForTimeout(500); if (await q2.locator('[data-testid=forgot-done]').count()) { await q2.goto(BASE + "/forgot-password"); await q2.fill('input[name="email"]', "x" + crypto.randomBytes(2).toString("hex") + "@example.com"); } }
log("[forgot-429] responses:", JSON.stringify(frr), "| button:", (await q2.locator('form button[type=submit]').innerText()).trim(), "| card:", await q2.locator('[data-testid=countdown]').innerText().catch(() => null)); await q2.screenshot({ path: `${OUT}/forgot-429-desktop.png`, fullPage: true });
log("[csp/console] D: csp", csp.length, csp, "| errors", [...new Set(cons)].length);
await b.close(); await db.end();
