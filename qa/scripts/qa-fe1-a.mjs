// Frontend dashboard QA part A: buyer page (anon), mobile, perf, noindex, originals, CSP. env BASE, SEED (seed.json), OUT
import { chromium } from "playwright-core"; import fs from "node:fs";
const BASE = process.env.BASE, OUT = process.env.OUT ?? "qa/artifacts/frontend-dashboard";
const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const L = seed.maya.links;
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const log = (...a) => console.log(...a);
async function ctxPage(vp, opts = {}) { const c = await b.newContext({ viewport: vp, ...opts }); const p = await c.newPage(); p.csp = []; p.cons = []; p.reqs = [];
  p.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) p.csp.push(t.slice(0, 200)); else if (m.type() === "error") p.cons.push(t.slice(0, 200)); });
  p.on("pageerror", (e) => p.cons.push("pageerror " + e.message)); p.on("request", (r) => p.reqs.push(r.url())); return [c, p]; }
// --- M2-07 / noindex / originals
{ const [c, p] = await ctxPage({ width: 1280, height: 800 });
  const resp = await p.goto(`${BASE}/u/${L.spring}`, { waitUntil: "load" });
  log("[M2-07] status", resp.status(), "x-robots-tag:", resp.headers()["x-robots-tag"]);
  const html = await resp.text();
  log("[noindex] meta robots:", (html.match(/<meta name="robots"[^>]*>/g) || []).join(" "));
  log("[M2-07] title tag:", await p.title());
  log("[M2-07] main text:", (await p.locator("main, body").first().innerText()).replace(/\n+/g, " | ").slice(0, 700));
  log("[M2-07] drop-title/seller/price/summary:", await p.locator('[data-testid=drop-title]').innerText(), "/", await p.locator('[data-testid=seller-name]').innerText(), "/", await p.locator('[data-testid=drop-price]').innerText(), "/", await p.locator('[data-testid=file-summary]').innerText());
  const imgs = await p.locator("img").evaluateAll((els) => els.map((e) => e.src)); log("[originals] img srcs:", imgs.map((s) => s.replace(BASE, "")));
  log("[originals] html contains '/original' or 'signed':", /\/original|signed-url|storage_key|original_key/i.test(html));
  log("[originals] network reqs containing /original or signed:", p.reqs.filter((u) => /original|signed/i.test(u)).length, "| all /api requests:", [...new Set(p.reqs.filter((u) => u.includes("/api/")).map((u) => u.replace(BASE, "").replace(/[0-9a-f-]{36}/, "<id>")))]);
  // img natural size vs original (blurred preview size)
  log("[originals] preview natural sizes:", await p.locator("img").evaluateAll((els) => els.map((e) => `${e.naturalWidth}x${e.naturalHeight}`)));
  await p.screenshot({ path: `${OUT}/buyer-desktop-1280.png`, fullPage: true });
  log("[csp] violations:", p.csp.length, p.csp, "| console errors:", p.cons.length, p.cons);
  // robots.txt
  log("[noindex] robots.txt:", (await (await fetch(`${BASE}/robots.txt`)).text()).replace(/\n/g, " ; "));
  await c.close(); }
// --- M3-01 / M3-18 Buy stub
{ const [c, p] = await ctxPage({ width: 1280, height: 800 }); await p.goto(`${BASE}/u/${L.spring}`);
  const pre = await p.locator('[data-testid=final-sale]').innerText(); const vis = await p.locator('[data-testid=final-sale]').isVisible();
  log("[M3-18] final-sale notice visible before Buy:", vis, JSON.stringify(pre));
  const buy = p.locator('[data-testid=buy-button]'); log("[M3-01] buy button text:", await buy.innerText(), "| login prompts on page:", await p.locator('text=/log ?in|sign ?in/i').count(), "| card inputs:", await p.locator('input[autocomplete^="cc-"]').count());
  await buy.click(); await p.waitForTimeout(600);
  log("[M3-01] click Buy w/o terms -> alert:", await p.locator('[role=alert]').allInnerTexts(), "| notice:", await p.locator('[data-testid=checkout-notice]').count());
  await p.locator('#agree').check(); const [r] = await Promise.all([p.waitForResponse((r) => r.url().includes("/api/checkout")), buy.click()]);
  await p.waitForTimeout(500); log("[M3-01] checkout API status:", r.status(), await r.text());
  log("[M3-01] notice:", (await p.locator('[data-testid=checkout-notice]').innerText()).replace(/\n/g, " | "), "| url:", p.url());
  await p.screenshot({ path: `${OUT}/buyer-buy-stub-desktop.png`, fullPage: true }); await c.close(); }
// --- unavailable pages
{ const [c, p] = await ctxPage({ width: 1280, height: 800 });
  for (const [k, id] of Object.entries({ unpublished: L.unpublished, draft: L.draft, bogus: "doesnotexist12" })) { const r = await p.goto(`${BASE}/u/${id}`); log(`[M2-11] /u/${k}: status`, r.status(), "x-robots:", r.headers()["x-robots-tag"], "| text:", (await p.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 200)); if (k === "unpublished") await p.screenshot({ path: `${OUT}/buyer-unavailable-desktop.png`, fullPage: true }); }
  const r = await fetch(`${BASE}/api/checkout`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ linkId: L.unpublished }) }); log("[M2-11] checkout for unpublished link ->", r.status, await r.text());
  await c.close(); }
// --- M2-18 mobile
for (const [w, h] of [[390, 844], [360, 800]]) { const [c, p] = await ctxPage({ width: w, height: h }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  for (const [name, path] of [["buyer", `/u/${L.spring}`], ["landing", "/"], ["signup", "/signup"], ["login", "/login"], ["forgot", "/forgot-password"]]) { await p.goto(BASE + path, { waitUntil: "load" }); await p.waitForTimeout(400);
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
    log(`[M2-18] ${w}x${h} ${name}: scrollWidth ${m.sw} clientWidth ${m.cw} body ${m.bw} -> hscroll=${m.sw > m.cw}`);
    if (name === "buyer") { const buy = p.locator('[data-testid=buy-button]'); await buy.scrollIntoViewIfNeeded(); const bb = await buy.boundingBox(); log(`[M2-18] buy button box`, JSON.stringify(bb), "within width:", bb.x >= 0 && bb.x + bb.width <= w, "| height>=44:", bb.height >= 44);
      await p.locator('#agree').check(); await buy.tap(); await p.waitForTimeout(500); log("[M2-18] tap Buy -> notice:", (await p.locator('[data-testid=checkout-notice]').innerText().catch(() => "none")).replace(/\n/g, " | "));
      const above = await p.evaluate(() => 0); await p.screenshot({ path: `${OUT}/buyer-mobile-${w}x${h}.png`, fullPage: true }); }
    else await p.screenshot({ path: `${OUT}/${name}-mobile-${w}x${h}.png`, fullPage: true }); }
  log(`[M2-18] ${w}: csp`, p.csp.length, "console errs", p.cons.length, p.cons); await c.close(); }
// --- M2-19 throttled 4G via CDP
{ for (const prof of [{ name: "4G (9Mbps/170ms RTT, 4x CPU)", down: 9e6 / 8, up: 9e6 / 8, lat: 170 }, { name: "Slow 4G (1.6Mbps/150ms)", down: 1.6e6 / 8, up: 750e3 / 8, lat: 150 }]) {
  const times = [];
  for (let i = 0; i < 3; i++) { const [c, p] = await ctxPage({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); const cdp = await c.newCDPSession(p);
    await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: prof.down, uploadThroughput: prof.up, latency: prof.lat }); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const t0 = Date.now(); await p.goto(`${BASE}/u/${L.spring}`, { waitUntil: "commit" }); await p.locator('[data-testid=buy-button]').waitFor({ state: "visible" }); const tUsable = Date.now() - t0;
    await p.waitForLoadState("load"); const tLoad = Date.now() - t0;
    const nav = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; const f = performance.getEntriesByName("first-contentful-paint")[0]; const bytes = performance.getEntriesByType("resource").reduce((a, r) => a + (r.transferSize || 0), 0); return { fcp: f?.startTime, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, bytes, res: performance.getEntriesByType("resource").length }; });
    times.push({ tUsable, tLoad, ...nav }); await c.close(); }
  log(`[M2-19] ${prof.name}:`, JSON.stringify(times.map((t) => ({ buyVisibleMs: t.tUsable, loadMs: t.tLoad, fcp: Math.round(t.fcp), bytes: t.bytes, res: t.res }))));
  } }
await b.close();
