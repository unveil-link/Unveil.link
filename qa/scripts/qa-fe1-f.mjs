// FE QA part F: modal/keyboard redo, titles/meta audit, PWA installability, branding scan. env BASE, SEED
import { chromium } from "playwright-core"; import fs from "node:fs";
const BASE = process.env.BASE; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const log = (...a) => console.log(...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xff = `10.43.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": xff } }); const q = await c.newPage();
await q.goto(BASE + "/login"); await q.fill('input[name="email"]', seed.maya.email); await q.fill('input[name="password"]', seed.password); await Promise.all([q.waitForURL("**/dashboard**"), q.locator('form button[type=submit]').click()]);
await q.goto(BASE + "/dashboard/drops"); await q.waitForTimeout(400);
const ub = q.locator('tbody button:has-text("Unpublish")').first(); log("[a11y] row Unpublish buttons:", await q.locator('tbody button:has-text("Unpublish")').count()); await ub.focus(); await q.keyboard.press("Enter"); await q.waitForTimeout(400);
log("[a11y] confirm modal open:", await q.locator("dialog[open]").count(), "| focus inside:", await q.evaluate(() => !!document.activeElement?.closest("dialog")), "| text:", (await q.locator("dialog[open]").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 200));
await q.keyboard.press("Tab"); await q.keyboard.press("Tab"); await q.keyboard.press("Tab"); log("[a11y] after 3 Tabs focus still inside dialog:", await q.evaluate(() => !!document.activeElement?.closest("dialog")));
await q.keyboard.press("Escape"); await q.waitForTimeout(300); log("[a11y] Esc closes:", (await q.locator("dialog[open]").count()) === 0, "| focus returned to trigger:", await q.evaluate(() => document.activeElement?.textContent?.trim()));
log("[a11y] tiny targets:", JSON.stringify(await q.evaluate(() => [...document.querySelectorAll("a, button")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 24).map((e) => `${e.tagName} "${(e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 25)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`))));
// skip link + sidebar keyboard
await q.goto(BASE + "/dashboard"); await q.keyboard.press("Tab"); log("[a11y] dashboard first Tab stop:", await q.evaluate(() => document.activeElement?.textContent?.trim()));
// buyer keyboard
const p = await c.newPage(); await p.goto(`${BASE}/u/${seed.maya.links.spring}`);
for (let i = 0; i < 15; i++) { await p.keyboard.press("Tab"); if ((await p.evaluate(() => document.activeElement?.id)) === "agree") break; } await p.keyboard.press("Space"); const checked = await p.locator("#agree").isChecked();
for (let i = 0; i < 4; i++) { await p.keyboard.press("Tab"); if ((await p.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "buy-button") break; } await p.keyboard.press("Enter"); await p.waitForTimeout(700);
log("[a11y] buyer keyboard-only: checkbox toggled by Space:", checked, "| Enter on Buy -> notice:", await p.locator('[data-testid=checkout-notice]').count(), "| focus moved to notice:", await p.evaluate(() => document.activeElement?.getAttribute("data-testid")));
// proper contrast: use screenshot-free alpha blend via canvas-less calc for flagged items
log("[a11y] manual contrast: muted rgb(94,91,112) on #fff = 6.55 (computed above); footer text 70% on #fff-ish >=4.5; login brand-panel text white@70%/55% on rgb(20,18,31):", (() => { const L = (c) => { const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; }; const bg = [20, 18, 31]; const r = (a) => { const fg = bg.map((v) => 255 * a + v * (1 - a)); const [x, y] = [L(fg), L(bg)]; return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); }; const mm = (a) => { const bgc = [250, 249, 253]; const mix = bgc.map((v) => 255 * a + v * (1 - a)); const fg = [94, 91, 112]; const [x, y] = [L(fg), L(mix)]; return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); }; return `0.7 -> ${r(0.7)}, 0.55 -> ${r(0.55)}; buyer footer muted on white@70% over #faf9fd -> ${mm(0.7)}; table th muted on #f1f0f7-ish -> ${(() => { const bgc = [241, 240, 247]; const fg = [94, 91, 112]; const [x, y] = [L(fg), L(bgc)]; return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); })()}`; })());
// titles/meta audit
const pages = { "/": "landing", "/signup": "", "/login": "", "/forgot-password": "", "/reset-password?token=x": "", "/design": "", [`/u/${seed.maya.links.spring}`]: "", "/u/nope": "", "/dashboard": "auth", "/dashboard/drops": "auth", "/dashboard/drops/new": "auth", [`/dashboard/drops/${seed.maya.dropIds.spring}`]: "auth" };
const meta = []; for (const path of Object.keys(pages)) { const r = await q.goto(BASE + path); const t = await q.title(); const m = await q.evaluate(() => [...document.querySelectorAll("meta")].map((e) => (e.getAttribute("name") || e.getAttribute("property")) + "=" + e.content).filter((x) => /description|robots|og:title|og:site|twitter:title|og:description/.test(x)).join(" ; ")); meta.push({ path: path.replace(/[0-9a-f-]{36}/, "<id>").replace(seed.maya.links.spring, "<linkId>"), status: r.status(), title: t, meta: m.slice(0, 300) }); }
for (const m of meta) log("[M5-20] title/meta:", JSON.stringify(m));
// branding scan over rendered text in all pages (public + dashboard)
const bad = /\b(adult|porn\w*|xxx|nsfw|onlyfans|explicit|erotic\w*|sex\w*|nude\w*|naked|fetish|escort|18\+|mature|lewd|camgirl|cam ?model|kink\w*|leak\w*|spicy|nsfw)\b/i;
const hits = []; for (const path of Object.keys(pages)) { await q.goto(BASE + path); const html = await q.content(); const txt = await q.evaluate(() => document.body.innerText); const mm = (html.match(new RegExp(bad.source, "gi")) || []); if (mm.length) hits.push(path + ": " + [...new Set(mm)].join(",")); }
log("[M5-20] rendered pages scanned:", Object.keys(pages).length, "| hits:", JSON.stringify(hits));
// installability via CDP
const cdp = await c.newCDPSession(await c.newPage()); const pg = (await c.pages()).at(-1); await pg.goto(BASE + "/"); await cdp.send("Page.enable");
try { const r = await cdp.send("Page.getInstallabilityErrors"); log("[M6-07] CDP installability errors:", JSON.stringify(r.installabilityErrors)); } catch (e) { log("[M6-07] CDP err", e.message); }
try { const r = await cdp.send("Page.getAppManifest"); log("[M6-07] CDP manifest url:", r.url, "errors:", JSON.stringify(r.errors), "parsed icons:", (JSON.parse(r.data || "{}").icons || []).length); } catch (e) { log("[M6-07] CDP manifest err", e.message); }
log("[M6-07] service worker registered:", await pg.evaluate(async () => ("serviceWorker" in navigator) ? (await navigator.serviceWorker.getRegistrations()).length : "n/a"), "| /sw.js:", (await fetch(BASE + "/sw.js")).status);
// banner / status
log("[M6-06] grep text for status banner in rendered dashboard:", /incident|status page|maintenance|degraded|outage/i.test(await (async () => { await q.goto(BASE + "/dashboard"); return q.evaluate(() => document.body.innerText); })()));
await b.close();
