// FE QA part E: owner login after real delay via UI (own XFF), a11y basics, keyboard nav, contrast, meta/PWA/branding. env BASE, SEED, OUT
import { chromium } from "playwright-core"; import fs from "node:fs"; import crypto from "node:crypto";
const BASE = process.env.BASE, OUT = process.env.OUT ?? "qa/artifacts/frontend-dashboard"; const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8")); const log = (...a) => console.log(...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const xff = `10.44.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
// ---- a11y basics
const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage();
async function a11y(path, name) { await p.goto(BASE + path); await p.waitForTimeout(500);
  const r = await p.evaluate(() => { const out = { unlabeled: [], noAlt: [], h1: document.querySelectorAll("h1").length, lang: document.documentElement.lang, landmarks: ["main", "nav", "header", "footer"].map((t) => t + ":" + document.querySelectorAll(t).length).join(" "), skip: !!document.querySelector('a[href="#main"], a[href^="#content"], a.sr-only') };
    for (const el of document.querySelectorAll("input:not([type=hidden]), select, textarea")) { const id = el.id; const has = (id && document.querySelector(`label[for="${id}"]`)) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label"); if (!has) out.unlabeled.push(el.outerHTML.slice(0, 90)); }
    for (const el of document.querySelectorAll("img")) if (!el.hasAttribute("alt")) out.noAlt.push(el.src.slice(-40));
    out.buttonsNoName = [...document.querySelectorAll("button, a")].filter((e) => !(e.innerText || "").trim() && !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby") && !e.querySelector("img[alt]") && !e.title).map((e) => e.outerHTML.slice(0, 90)); return out; });
  log(`[a11y] ${name}:`, JSON.stringify(r)); }
for (const [n, pa] of [["signup", "/signup"], ["login", "/login"], ["forgot", "/forgot-password"], ["buyer", `/u/${seed.maya.links.spring}`], ["landing", "/"]]) await a11y(pa, n);
// keyboard nav on login
await p.goto(BASE + "/login"); const seq = []; for (let i = 0; i < 9; i++) { await p.keyboard.press("Tab"); seq.push(await p.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return `${e.tagName.toLowerCase()}${e.name ? "[" + e.name + "]" : ""}:${(e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 18)}|outline=${cs.outlineStyle}/${cs.outlineWidth}${cs.boxShadow !== "none" ? "|shadow" : ""}`; })); }
log("[a11y] tab order /login:", seq.join("  →  "));
await p.keyboard.press("Shift+Tab"); 
// keyboard submit w/ Enter
await p.goto(BASE + "/login"); await p.fill('input[name="email"]', "x"); await p.keyboard.press("Enter"); await p.waitForTimeout(300); log("[a11y] Enter submits & shows validation:", await p.locator('[role=alert]').count() > 0, "| focus moved to:", await p.evaluate(() => document.activeElement?.getAttribute("name")));
// show/hide password toggle
const tgl = p.locator('button[aria-label*="password" i], button[aria-pressed]'); log("[a11y] password toggle:", await tgl.count(), await tgl.first().getAttribute("aria-label").catch(() => null), await tgl.first().getAttribute("aria-pressed").catch(() => null));
// buyer page keyboard: tab to checkbox, space, tab to Buy, Enter
await p.goto(`${BASE}/u/${seed.maya.links.spring}`); for (let i = 0; i < 12; i++) { await p.keyboard.press("Tab"); const id = await p.evaluate(() => document.activeElement?.id); if (id === "agree") break; } await p.keyboard.press("Space"); await p.keyboard.press("Tab"); const foc = await p.evaluate(() => document.activeElement?.getAttribute("data-testid") || document.activeElement?.tagName); await p.keyboard.press("Enter"); await p.waitForTimeout(700); log("[a11y] buyer keyboard-only: focus after checkbox+Tab:", foc, "| notice shown:", await p.locator('[data-testid=checkout-notice]').count(), "| focus on notice:", await p.evaluate(() => document.activeElement?.getAttribute("data-testid")));
// dialog focus trap / Esc on dashboard
await c.close();
{ const c2 = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': xff } }); const q = await c2.newPage(); await q.goto(BASE + "/login"); await q.fill('input[name="email"]', seed.maya.email); await q.fill('input[name="password"]', seed.password); await Promise.all([q.waitForURL("**/dashboard**"), q.locator('form button[type=submit]').click()]);
  await q.goto(BASE + "/dashboard/drops"); await q.waitForTimeout(400); await q.locator('button:has-text("Unpublish")').first().focus(); await q.keyboard.press("Enter"); await q.waitForTimeout(400); const open = await q.locator("dialog[open]").count(); const inside = await q.evaluate(() => !!document.activeElement?.closest("dialog")); log("[a11y] Unpublish confirm modal open:", open, "| focus inside dialog:", inside); await q.keyboard.press("Escape"); await q.waitForTimeout(300); log("[a11y] Esc closes modal:", (await q.locator("dialog[open]").count()) === 0);
  const rem = await q.evaluate(() => [...document.querySelectorAll("a, button")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 24).length); log("[a11y] visible a/button with height < 24px on drops list:", rem);
  // contrast spot check
  const cr = await q.evaluate(() => { const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }; const bgOf = (e) => { while (e) { const bg = getComputedStyle(e).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg; e = e.parentElement; } return "rgb(255,255,255)"; };
    const res = []; for (const sel of ["h1", "main p", "main td", "table th", "a.text-primary", "button", ".text-muted", "label", "span.rounded-full"]) { const e = [...document.querySelectorAll(sel)].find((x) => x.offsetParent && (x.innerText || "").trim()); if (!e) continue; const fg = getComputedStyle(e).color, bg = bgOf(e); const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); res.push(`${sel}: ${ratio.toFixed(2)} (${fg} on ${bg}, ${getComputedStyle(e).fontSize})`); } return res; });
  log("[a11y] contrast spot-check (dashboard/drops):"); cr.forEach((x) => log("   ", x)); await c2.close(); }
// contrast on buyer/login/badges: reuse in one pass
{ const c3 = await b.newContext({ viewport: { width: 1280, height: 900 } }); const q = await c3.newPage();
  for (const [n, pa] of [["buyer", `/u/${seed.maya.links.spring}`], ["login", "/login"], ["signup", "/signup"]]) { await q.goto(BASE + pa); const cr = await q.evaluate(() => { const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }; const bgOf = (e) => { while (e) { const bg = getComputedStyle(e).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg; e = e.parentElement; } return "rgb(255,255,255)"; };
      const out = []; const seen = new Set(); for (const e of document.querySelectorAll("h1, h2, p, label, a, button, span, small, code")) { if (!e.offsetParent || !(e.innerText || "").trim() || e.children.length > 2) continue; const fg = getComputedStyle(e).color, bg = bgOf(e); const k = fg + bg + getComputedStyle(e).fontSize; if (seen.has(k)) continue; seen.add(k); const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); const fs = parseFloat(getComputedStyle(e).fontSize), bold = +getComputedStyle(e).fontWeight >= 700; const need = fs >= 24 || (fs >= 18.66 && bold) ? 3 : 4.5; if (ratio < need) out.push(`${e.tagName.toLowerCase()} "${e.innerText.trim().slice(0, 30)}" ${ratio.toFixed(2)}<${need} (${fg} on ${bg}, ${fs}px)`); } return out; });
    log(`[a11y] contrast below WCAG AA on ${n}:`, JSON.stringify(cr)); } await c3.close(); }
// ---- meta / PWA / branding
const home = await (await fetch(BASE + "/")).text();
log("[M6-07] manifest:", (await (await fetch(BASE + "/manifest.webmanifest")).text()).slice(0, 700));
for (const i of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"]) { const r = await fetch(BASE + i); log("[M6-07] icon", i, r.status, r.headers.get("content-type"), (await r.arrayBuffer()).byteLength); }
log("[M6-07] <head> link/meta:", (home.match(/<(link|meta)[^>]*(manifest|theme-color|apple|viewport|icon|description)[^>]*>/gi) || []).join("\n  "));
fs.writeFileSync("/workspace/qa-run5/out/home.html", home);
await b.close();
