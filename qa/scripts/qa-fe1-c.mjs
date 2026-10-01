// FE dashboard QA part C: seller flow (timed), upload progress, validation, XSS. env BASE, DB, FE (checkout dir), OUT
import { chromium } from "playwright-core"; import pg from "pg"; import sharp from "sharp"; import fs from "node:fs"; import crypto from "node:crypto"; import { execSync } from "node:child_process";
const BASE = process.env.BASE, OUT = process.env.OUT ?? "qa/artifacts/frontend-dashboard", FE = process.env.FE, TMP = "/workspace/qa-run5/out";
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect(); const log = (...a) => console.log(...a);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); const csp = [], cons = [], dialogs = [];
p.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t.slice(0, 200)); else if (m.type() === "error") cons.push(t.slice(0, 160)); }); p.on("pageerror", (e) => cons.push("pageerror " + e.message)); p.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
const mk = async (name, fmt, w = 800, h = 600, noise = false) => { const f = `${TMP}/${name}`; let s = sharp({ create: { width: w, height: h, channels: 3, background: noise ? "#000" : "#a55" } }); if (noise) s = sharp(crypto.randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }); await s[fmt]({ quality: 95 }).toFile(f); return f; };
const jpg = await mk("a.jpg", "jpeg"), png = await mk("b.png", "png"), webp = await mk("c.webp", "webp"); fs.writeFileSync(`${TMP}/notes.txt`, "hello"); fs.writeFileSync(`${TMP}/anim.gif`, Buffer.from("R0lGODlhAQABAAAAACw=", "base64")); fs.writeFileSync(`${TMP}/clip.mp4`, Buffer.alloc(2048, 1));
const THR = process.env.THROTTLE !== "0"; const big = await mk("big.jpg", "jpeg", THR ? 2200 : 800, THR ? 1650 : 600, THR);
const huge = await mk("huge.jpg", "jpeg", 5000, 4000, true); log("huge.jpg bytes", fs.statSync(huge).size); log("big.jpg bytes", fs.statSync(big).size);
const XSS = { name: `Eve <svg onload=window.__x=3> "&'`, title: `<img src=x onerror=window.__x=1>"><script>window.__x=2</script>`, desc: `<b>bold</b> <img src=x onerror=window.__x=4> &amp; <a href="javascript:window.__x=5">click</a>\nline2 {{7*7}} \${7*7}` };
const email = `qa-fe-${crypto.randomBytes(3).toString("hex")}@example.com`, PW = "Sunrise-Harbor-4821";
const T0 = Date.now(); const lap = (s) => log(`[M4-18] t+${((Date.now() - T0) / 1000).toFixed(1)}s ${s}`);
// ---- signup validation
await p.goto(BASE + "/signup"); lap("signup page loaded");
await p.locator('button[type=submit]').click(); await p.waitForTimeout(300);
log("[auth-validation] empty submit errors:", await p.locator('[id$="-err"], [role=alert], .text-danger').allInnerTexts(), "| focused:", await p.evaluate(() => document.activeElement?.getAttribute("name") || document.activeElement?.id));
await p.fill('input[name="displayName"]', XSS.name); await p.fill('input[name="email"]', "not-an-email"); await p.locator('input[name="email"]').blur(); await p.fill('input[name="password"]', "short1"); await p.locator('input[name="password"]').blur(); await p.waitForTimeout(200);
log("[auth-validation] bad email/short pw:", await p.locator('[role=alert], [id$="-err"]').allInnerTexts());
await p.fill('input[name="password"]', "password1234"); await p.locator('input[name="password"]').blur(); await p.waitForTimeout(150); log("[auth-validation] weak 'password1234' client:", await p.locator('[id$="-err"]').allInnerTexts(), "| strength:", (await p.locator('[data-testid*=strength], [aria-label*=strength i]').allInnerTexts()).join("|"));
await p.screenshot({ path: `${OUT}/signup-validation-desktop.png`, fullPage: true });
await p.fill('input[name="email"]', email); await p.fill('input[name="password"]', "Qwertyuiop12"); await p.locator('button[type=submit]').click(); await p.waitForTimeout(800);
log("[auth-validation] server weak_password for 'Qwertyuiop12':", await p.locator('[id$="-err"], [role=alert]').allInnerTexts(), "| url", p.url());
await p.screenshot({ path: `${OUT}/signup-weak-server-desktop.png`, fullPage: true });
await p.fill('input[name="password"]', PW); await Promise.all([p.waitForURL("**/dashboard**"), p.locator('button[type=submit]').click()]); lap("account created, on /dashboard");
log("[M4-18] dashboard empty-state:", (await p.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 300));
// ---- new drop form validation
await p.goto(BASE + "/dashboard/drops/new"); lap("new drop form");
await p.locator('form button[type=submit]').click(); await p.waitForTimeout(300); log("[M1-05/validation] empty new-drop errors:", await p.locator('main [role=alert], main [id$="-err"]').allInnerTexts());
await p.fill('#title', XSS.title); for (const v of ["0.50", "abc", "600", "-1", "12.345"]) { await p.fill('#price', v); await p.locator('#price').blur(); await p.waitForTimeout(150); log(`[validation] price '${v}':`, await p.locator('#price-error').allInnerTexts()); }
await p.fill('#price', "12.00"); await p.fill('#description', XSS.desc);
// invalid files
await p.setInputFiles('input[type=file]', [`${TMP}/notes.txt`, `${TMP}/anim.gif`, `${TMP}/clip.mp4`]); await p.waitForTimeout(400);
log("[validation] queue after .txt/.gif/.mp4:", (await p.locator("main ul, main [aria-live]").allInnerTexts()).join(" || ").replace(/\n+/g, " | ").slice(0, 600));
await p.screenshot({ path: `${OUT}/newdrop-invalid-files-desktop.png`, fullPage: true });
// remove invalid
for (let i = 0; i < 5; i++) { const rm = p.locator('button[aria-label^="Remove"]').first(); if (await rm.count()) await rm.click(); }
await p.setInputFiles('input[type=file]', [huge]); await p.waitForTimeout(400); log('[validation] oversize image:', (await p.locator('main ul').allInnerTexts()).join(' || ').replace(/\n+/g,' | ').slice(0,300)); { const rm = p.locator('button[aria-label^="Remove"]').first(); if (await rm.count()) await rm.click(); }
await p.setInputFiles('input[type=file]', [jpg, png, webp, big]); await p.waitForTimeout(300);
// throttle upload so progress is observable
const cdp = await c.newCDPSession(p); await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: -1, uploadThroughput: THR ? 4e6 / 8 : -1, latency: 50 });
const samples = []; await p.exposeFunction("__sample", (s) => samples.push(s));
await p.evaluate(() => { setInterval(() => { const bars = [...document.querySelectorAll('[role=progressbar]')].map((e) => e.getAttribute("aria-valuenow")); window.__sample(bars.join(",")); }, 250); });
lap("files queued, submitting"); await p.locator('form button[type=submit]').click();
await p.waitForSelector('[data-testid=drop-created]', { timeout: 120000 }); lap("upload finished -> success");
log("[M1-05] progressbar aria-valuenow samples (each tick; comma = per-file):", [...new Set(samples)].slice(0, 40).join(" ; "));
log("[M1-05] saw intermediate % :", samples.some((s) => s.split(",").some((v) => v && +v > 0 && +v < 100)));
await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 });
log("[M1-05] success:", (await p.locator('[data-testid=drop-created]').innerText()).replace(/\n+/g, " | ")); await p.screenshot({ path: `${OUT}/newdrop-success-desktop.png`, fullPage: true });
const dropRow = (await db.query("select d.id, d.public_link_id, d.status, d.title, d.description, (select count(*) from drop_files f where f.drop_id=d.id) nf from drops d join sellers s on s.id=d.seller_id where s.email=$1", [email])).rows[0]; log("[M1-05] DB:", JSON.stringify({ ...dropRow, title: dropRow.title.slice(0, 40) }));
log("[M1-05] files in DB:", JSON.stringify((await db.query("select mime, size_bytes from drop_files where drop_id=$1 order by sort_order", [dropRow.id])).rows));
log("[M4-18] draft saved, unverified: status", dropRow.status);
// publish attempt while unverified via editor
await p.goto(BASE + `/dashboard/drops/${dropRow.id}`); await p.waitForTimeout(400); log("[M4-18] editor (unverified) publish:", (await p.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 500));
await p.screenshot({ path: `${OUT}/editor-unverified-desktop.png`, fullPage: true });
// verify seller (the documented dev command), then publish via UI dialog
lap("running npm run verify-seller (stands in for ID verification: excluded)"); const t1 = Date.now(); execSync(`npm run verify-seller -- ${email} verified`, { cwd: FE, stdio: "pipe" }); const verifyMs = Date.now() - t1;
await p.reload(); await p.waitForTimeout(500); await p.locator('main button:has-text("Publish")').first().click(); await p.waitForTimeout(400);
log("[M4-18] publish dialog:", (await p.locator("dialog[open]").innerText()).replace(/\n+/g, " | ").slice(0, 400));
const cbs = p.locator('dialog[open] input[type=checkbox]'); log("[M4-18] attestation checkboxes:", await cbs.count());
await p.screenshot({ path: `${OUT}/publish-dialog-desktop.png` });
await p.locator('dialog[open] button:has-text("Publish")').last().click(); await p.waitForTimeout(500); log("[M4-18] publish without attest ->", (await p.locator("dialog[open]").innerText()).replace(/\n+/g, " | ").slice(-200));
for (let i = 0; i < await cbs.count(); i++) await cbs.nth(i).check(); await p.locator('dialog[open] button:has-text("Publish")').last().click(); await p.waitForTimeout(1200);
const st = (await db.query("select status from drops where id=$1", [dropRow.id])).rows[0].status; lap(`published (db status=${st}); first live link ${BASE}/u/${dropRow.public_link_id}`);
const total = (Date.now() - T0 - verifyMs) / 1000; log(`[M4-18] automated elapsed signup->live (excl. verify cmd ${verifyMs}ms): ${total.toFixed(1)}s`);
await p.screenshot({ path: `${OUT}/editor-published-desktop.png`, fullPage: true });
// dashboard list shows escaped title
await p.goto(BASE + "/dashboard"); await p.waitForTimeout(500); log("[XSS] dashboard sidebar/main name+title text:", (await p.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 500)); await p.screenshot({ path: `${OUT}/dashboard-xss-desktop.png`, fullPage: true });
await p.goto(BASE + "/dashboard/drops"); await p.waitForTimeout(300); await p.goto(BASE + `/dashboard/drops/${dropRow.id}`); await p.waitForTimeout(300);
log("[XSS] dashboard window.__x:", await p.evaluate(() => window.__x), "dialogs:", dialogs);
// buyer page XSS
const bp = await c.newPage(); bp.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); }); const r = await bp.goto(`${BASE}/u/${dropRow.public_link_id}`); const html = await r.text();
log("[XSS] buyer status", r.status(), "| raw html has unescaped '<img src=x onerror' :", /<img src=x onerror/i.test(html), "| has '&lt;img src=x onerror':", /&lt;img src=x onerror/i.test(html), "| unescaped <script>window.__x:", /<script>window\.__x/.test(html), "| unescaped <svg onload:", /<svg onload/i.test(html));
log("[XSS] buyer window.__x:", await bp.evaluate(() => window.__x), "| dialogs:", dialogs, "| title shown:", JSON.stringify(await bp.locator('[data-testid=drop-title]').innerText()), "| seller:", JSON.stringify(await bp.locator('[data-testid=seller-name]').innerText()));
log("[XSS] buyer description text:", JSON.stringify((await bp.locator("main").innerText()).split("Price")[0].slice(-300)), "| js: link count:", await bp.locator('a[href^="javascript"]').count(), "| <b> elements in desc:", await bp.locator('main p b:has-text("bold")').count());
log("[XSS] <title>:", JSON.stringify(await bp.title())); await bp.screenshot({ path: `${OUT}/buyer-xss-desktop.png`, fullPage: true });
log("[csp/console] seller session: csp", csp.length, csp, "| errors", cons.length, [...new Set(cons)]);
fs.writeFileSync("/workspace/qa-run5/out/c-state.json", JSON.stringify({ email, dropRow })); await b.close(); await db.end();
