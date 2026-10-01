// FE QA part G: UI unpublish/republish, editor add-files, content-type mismatch, copy link, mobile new-drop flow. env BASE, DB
import { chromium } from "playwright-core"; import pg from "pg"; import sharp from "sharp"; import fs from "node:fs"; import crypto from "node:crypto";
const BASE = process.env.BASE, OUT = "qa/artifacts/frontend-dashboard", TMP = "/workspace/qa-run5/out"; const log = (...a) => console.log(...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = JSON.parse(fs.readFileSync(TMP + "/c-state.json", "utf8")); const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const xff = `10.42.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": xff }, permissions: ["clipboard-read", "clipboard-write"] }); const p = await c.newPage(); const csp = [], cons = [];
p.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t.slice(0, 200)); else if (m.type() === "error") cons.push(t.slice(0, 160)); });
await p.goto(BASE + "/login"); await p.fill('input[name="email"]', st.email); await p.fill('input[name="password"]', "Sunrise-Harbor-4821"); await Promise.all([p.waitForURL("**/dashboard**"), p.locator('form button[type=submit]').click()]);
const D = st.dropRow; const pub = async () => (await fetch(`${BASE}/u/${D.public_link_id}`)).status;
log("[M2-11] before unpublish /u/ status:", await pub());
await p.goto(`${BASE}/dashboard/drops/${D.id}`); await p.waitForTimeout(500);
await p.locator('main button:has-text("Copy link")').first().click(); await sleep(300); log("[M2-11] copy link clipboard:", await p.evaluate(() => navigator.clipboard.readText()), "| button label now:", await p.locator('main button:has-text("Copied")').count());
await p.locator('main button:has-text("Unpublish")').first().click(); await p.waitForTimeout(400); await p.locator('dialog[open] button:has-text("Unpublish")').click(); await p.waitForTimeout(1200);
log("[M2-11] after UI unpublish: /u/ status", await pub(), "| db status", (await db.query("select status from drops where id=$1", [D.id])).rows[0].status, "| editor badge:", (await p.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 160));
const unavail = await (await fetch(`${BASE}/u/${D.public_link_id}`)).text(); log("[M2-11] unavailable page copy present:", /This link isn’t available/.test(unavail), "| Buy button present:", /buy-button/.test(unavail));
await p.screenshot({ path: `${OUT}/editor-unpublished-desktop.png`, fullPage: true });
await p.locator('main button:has-text("Publish")').first().click(); await p.waitForTimeout(400); for (const cb of await p.locator('dialog[open] input[type=checkbox]').all()) await cb.check(); await p.locator('dialog[open] button:has-text("Publish")').last().click(); await p.waitForTimeout(1200); log("[M2-11] republish via UI: /u/ status", await pub());
// add more files via editor: png + content-type mismatch (text renamed .jpg) + valid
const good = `${TMP}/g.png`; await sharp({ create: { width: 500, height: 400, channels: 3, background: "#3a8" } }).png().toFile(good); fs.writeFileSync(`${TMP}/fake.jpg`, "this is not an image");
const nf0 = (await db.query("select count(*) from drop_files where drop_id=$1", [D.id])).rows[0].count;
await p.setInputFiles('main input[type=file]', [good, `${TMP}/fake.jpg`]); await p.waitForTimeout(2500);
log("[M1-05] editor add-files: files before", nf0, "after", (await db.query("select count(*) from drop_files where drop_id=$1", [D.id])).rows[0].count, "| UI:", (await p.locator("main").innerText()).replace(/\n+/g, " | ").match(/fake\.jpg[^|]*\|[^|]*\|?[^|]*/)?.[0]);
await p.screenshot({ path: `${OUT}/editor-addfiles-fake-desktop.png`, fullPage: true });
// price edit/description edit control presence
log("[M2-10] editable fields in editor (inputs/textarea excluding file/checkbox):", await p.locator('main input:not([type=file]):not([type=checkbox]), main textarea').count());
// mobile new-drop flow
const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": xff } }); const mp = await m.newPage();
await mp.goto(BASE + "/login"); await mp.fill('input[name="email"]', st.email); await mp.fill('input[name="password"]', "Sunrise-Harbor-4821"); await Promise.all([mp.waitForURL("**/dashboard**"), mp.locator('form button[type=submit]').click()]);
await mp.goto(BASE + "/dashboard/drops/new"); await mp.fill('#title', "Mobile drop"); await mp.fill('#price', "9.99"); await mp.setInputFiles('input[type=file]', [good]); await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/newdrop-filled-mobile-390.png`, fullPage: true });
await mp.locator('form button[type=submit]').click(); await mp.waitForSelector('[data-testid=drop-created]', { timeout: 30000 });
const sw = await mp.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); log("[mobile] new-drop flow done; hscroll:", sw[0] > sw[1], "| text:", (await mp.locator('[data-testid=drop-created]').innerText()).replace(/\n+/g, " | ").slice(0, 200));
await mp.screenshot({ path: `${OUT}/newdrop-success-mobile-390.png`, fullPage: true });
// bottom nav on mobile
await mp.goto(BASE + "/dashboard"); log("[mobile] bottom tab nav links:", JSON.stringify(await mp.locator("nav a").evaluateAll((a) => a.filter((x) => x.offsetParent).map((x) => x.textContent.trim()))));
log("[csp/console] G: csp", csp.length, "errors", cons.length, [...new Set(cons)]);
await b.close(); await db.end();
