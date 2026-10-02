// FE-23 (30d6a48): header sign-up button label swap at 640px + horizontal overflow on every page at 10 widths. env BASE, SEED, OUT, WT, TAG
import * as L from "./qa-fe8-lib.mjs"; const { log, ok, seed, BASE } = L; const b = await L.browser(); const TAG = process.env.TAG ?? "branch";
const WIDTHS = [320, 360, 375, 390, 412, 639, 640, 641, 768, 1280];
const pub = [["landing", "/"], ["login", "/login"], ["signup", "/signup"], ["signin-redirect", "/signin"], ["forgot", "/forgot-password"], ["reset", "/reset-password?token=x"], ["terms", "/terms"], ["privacy", "/privacy"], ["dmca", "/dmca"], ["contact", "/contact"],
  ["buyer", `/u/${seed.maya.links.spring}`], ["buyer-unavailable", `/u/${seed.maya.links.unpublished}`], ["buyer-404", "/u/doesnotexist"], ["404", "/no-such-page"], ["admin-login", "/admin/login"], ["pay-mock-bad", "/pay/mock/nope"]];
const auth = [["dashboard", "/dashboard"], ["drops", "/dashboard/drops"], ["new-drop", "/dashboard/drops/new"], ["drop-published", `/dashboard/drops/${seed.maya.dropIds.spring}`], ["drop-draft", `/dashboard/drops/${seed.maya.dropIds.draft}`], ["drop-flagged", `/dashboard/drops/${seed.maya.dropIds.flagged}`]];
const measure = () => { const de = document.documentElement; const vw = de.clientWidth; const out = []; for (const e of document.querySelectorAll("body *")) { const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue; const cs = getComputedStyle(e); if (/\bsr-only\b/.test(String(e.className))) continue; if (r.right > vw + 0.5 || r.left < -0.5) { let p = e.parentElement, clipped = false; while (p && p !== document.body) { const o = getComputedStyle(p); if (o.overflowX !== "visible") { clipped = true; break; } p = p.parentElement; } if (!clipped) out.push(e.tagName.toLowerCase() + "." + String(e.className).slice(0, 50) + "@" + Math.round(r.right)); } } 
  const clip = []; for (const e of document.querySelectorAll("a,button,th,td,h1,h2,h3,label")) { if (/\bsr-only\b/.test(String(e.className)) || (!e.offsetParent && getComputedStyle(e).position !== "fixed")) continue; const cs = getComputedStyle(e); if (e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== "visible") clip.push(e.tagName + ":" + (e.textContent || "").trim().slice(0, 30)); }
  return { over: de.scrollWidth - vw, sw: de.scrollWidth, vw, out: out.slice(0, 4), clip: clip.slice(0, 4) }; };
async function pageCheck(p, w, name, u) {
  await p.goto(BASE + u, { waitUntil: "networkidle" }); const r = await p.evaluate(measure);
  ok(r.over <= 0 && r.clip.length === 0, `[${TAG} ${w}px] ${name}: overflow ${r.over}px (sw ${r.sw}/vw ${r.vw}) offenders ${JSON.stringify(r.out)} clipped ${JSON.stringify(r.clip)}`);
}
// ---- landing header detail
const lum = (c) => { const [r, g, bl] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
for (const w of WIDTHS) {
  const c = await b.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, hasTouch: w < 640 }); const p = await c.newPage(); await p.goto(BASE + "/", { waitUntil: "networkidle" });
  const h = await p.evaluate(() => { const hd = document.querySelector("header"); const a = [...hd.querySelectorAll("a")].filter((x) => x.getAttribute("href") === "/signup"); const a0 = a[0]; const bb = a0.getBoundingClientRect(); const cs = getComputedStyle(a0);
    const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number); let bgEl = a0, bg = parse(getComputedStyle(bgEl).backgroundColor); while (bg.length === 4 && bg[3] === 0 && bgEl.parentElement) { bgEl = bgEl.parentElement; bg = parse(getComputedStyle(bgEl).backgroundColor); }
    const si = [...hd.querySelectorAll("a")].find((x) => /sign in/i.test(x.textContent)); const sb = si.getBoundingClientRect();
    const spans = [...a0.querySelectorAll("span")].map((s) => ({ t: s.textContent, disp: getComputedStyle(s).display, w: Math.round(s.getBoundingClientRect().width) }));
    return { n: a.length, href: a0.getAttribute("href"), inner: a0.innerText, text: a0.textContent, w: Math.round(bb.width), h: Math.round(bb.height), right: Math.round(bb.right), color: parse(cs.color), bg, fs: cs.fontSize, spans, signin: { href: si.getAttribute("href"), w: Math.round(sb.width), h: Math.round(sb.height) }, lines: (() => { const vis = [...a0.querySelectorAll("span")].find((x) => getComputedStyle(x).display !== "none"); const rg = document.createRange(); rg.selectNodeContents(vis ?? a0); return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size; })() }; });
  const want = w < 640 ? "Sign up" : "Create your account";
  ok(h.inner === want, `[${TAG} ${w}px] header button visible text = "${h.inner}" (want "${want}")`);
  ok(h.n === 1 && h.href === "/signup", `[${TAG} ${w}px] header signup link count ${h.n} href ${h.href}`);
  const asName = await p.locator("header").getByRole("link", { name: want, exact: true }).count(); const other = await p.locator("header").getByRole("link", { name: w < 640 ? "Create your account" : "Sign up", exact: true }).count();
  const both = await p.locator("header").getByRole("link", { name: /sign up.*create|create.*sign up/i }).count();
  ok(asName === 1 && other === 0 && both === 0, `[${TAG} ${w}px] accessible name = "${want}" only (matches ${asName}, other label ${other}, merged ${both}); spans ${JSON.stringify(h.spans)}`);
  const snap = await p.locator("header").ariaSnapshot(); if ([320, 639, 640].includes(w)) fs_write(`header-aria-${TAG}-${w}.txt`, snap);
  const cr = (() => { const [a, b2] = [lum(h.color.slice(0, 3)), lum(h.bg.slice(0, 3))]; return (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05); })();
  ok(cr >= 4.5, `[${TAG} ${w}px] contrast of button text ${JSON.stringify(h.color)} on ${JSON.stringify(h.bg)} = ${cr.toFixed(2)}:1 (>=4.5)`);
  log(`   INFO [${TAG} ${w}px] signup button ${h.w}x${h.h}px (lines ${h.lines}, right edge ${h.right}/${w}, font ${h.fs}); sign-in link ${h.signin.href} ${h.signin.w}x${h.signin.h}`);
  log(`   INFO [${TAG} ${w}px] tap target height ${h.h}px -> ${h.h >= 44 ? "meets 44px guideline" : h.h >= 24 ? "meets WCAG 2.2 AA 24px minimum, below 44px guideline" : "TOO SMALL"}`);
  ok(h.h >= 24 && h.w >= 24, `[${TAG} ${w}px] tap target >= 24x24 CSS px (WCAG 2.5.8)`);
  ok(h.lines <= 1, `[${TAG} ${w}px] header button on one line (${h.lines} line)`);
  // click it
  await Promise.all([p.waitForURL("**/signup", { timeout: 8000 }).catch(() => {}), p.locator('header a[href="/signup"]').first().click()]); ok(new URL(p.url()).pathname === "/signup", `[${TAG} ${w}px] click header button -> ${new URL(p.url()).pathname}`);
  await c.close();
}
import fs from "node:fs"; function fs_write(n, t) { fs.writeFileSync(`${L.OUT}/${TAG}-${n}`, t); }
// ---- zoom / text-scale: 320px at 200% font size via CSS zoom emulation (viewport 160 CSS px is not realistic) -> use 320 with forced larger root font
{ const c = await b.newContext({ viewport: { width: 320, height: 800 } }); const p = await c.newPage(); await p.goto(BASE + "/", { waitUntil: "networkidle" }); await p.addStyleTag({ content: "html{font-size:20px !important}" }); const r = await p.evaluate(measure); log(`   INFO [${TAG}] 320px with root font 20px (125% text zoom): overflow ${r.over}px ${JSON.stringify(r.out)}`); await c.close(); }
// ---- all pages
for (const w of WIDTHS) {
  const c = await b.newContext({ viewport: { width: w, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": L.fakeIp() } }); const p = await c.newPage();
  for (const [n, u] of pub) await pageCheck(p, w, n, u);
  await c.close();
}
for (const [who, email, pages] of [["maya", seed.maya.email, auth], ["ned", seed.ned.email, [["dashboard", "/dashboard"], ["drops", "/dashboard/drops"]]]]) for (const w of WIDTHS) {
  const { c, p } = await L.login(b, email, { width: w, height: 900 });
  for (const [n, u] of pages) await pageCheck(p, w, `${who} ${n}`, u);
  await c.close();
}
// screenshots of the header at the boundary
for (const w of [320, 639, 640, 641]) { const c = await b.newContext({ viewport: { width: w, height: 300 }, deviceScaleFactor: 2 }); const p = await c.newPage(); await p.goto(BASE + "/", { waitUntil: "networkidle" }); await p.screenshot({ path: `${L.OUT}/fe8-header-${TAG}-${w}.png`, clip: { x: 0, y: 0, width: w, height: 70 } }); await c.close(); }
await b.close(); L.done();
