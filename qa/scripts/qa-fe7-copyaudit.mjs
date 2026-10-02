// FE-14 residual audit: render every reachable page (anon + seller), collect visible text + <meta> + JSON-LD/manifest, list each sentence that promises instant delivery / receipt / download / unlock.
// env BASE, SEED, OUT, WT, DB. usage: BASE=http://localhost:4401 TAG=polish node qa-fe7-copyaudit.mjs
import * as L from "./qa-fe7-lib.mjs"; import fs from "node:fs"; const { log, BASE, seed } = L;
const TAG = process.env.TAG ?? "x";
const RE = /(instant(ly)?|right away|straight away|immediate(ly)?|receipt|download|deliver(y|ed|s)?|unlock|as soon as|the moment|backup (download )?link|emailed?|we.ll (send|email)|access (to )?your files)/i;
const b = await L.browser(); const hits = []; const pagesSeen = [];
function sentences(t) { return t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+|\s·\s|\s\|\s/).map((x) => x.trim()).filter(Boolean); }
async function audit(name, url, page) {
  const html = await page.content(); const text = await page.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("details")].map((d) => d.textContent).join(" "));  // include collapsed <details> (FAQ)
  const meta = await page.evaluate(() => [...document.querySelectorAll("meta[name=description],meta[property^='og:'],meta[name^='twitter:']")].map((m) => [m.getAttribute("name") ?? m.getAttribute("property"), m.content]).concat([["title", document.title]]));
  const alts = await page.evaluate(() => [...document.querySelectorAll("[aria-label],[alt],[title],input[placeholder]")].map((e) => ["attr", e.getAttribute("aria-label") ?? e.getAttribute("alt") ?? e.getAttribute("title") ?? e.getAttribute("placeholder")]));
  pagesSeen.push(name);
  const seen = new Set();
  const add = (kind, s) => { if (RE.test(s) && !seen.has(kind + s)) { seen.add(kind + s); hits.push({ page: name, url, kind, text: s.slice(0, 260) }); } };
  for (const s of sentences(text)) add("visible", s);
  for (const [k, v] of meta) if (v) add("meta:" + k, v);
  for (const [, v] of alts) if (v) add("attr", v);
  return html;
}
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
const link = seed.maya.links;
const anon = [["landing", "/"], ["login", "/login"], ["signup", "/signup"], ["forgot-password", "/forgot-password"], ["reset-password", "/reset-password?token=x"], ["terms", "/terms"], ["privacy", "/privacy"], ["dmca", "/dmca"], ["contact", "/contact"],
  ["buyer /u/<published>", `/u/${link.spring}`], ["buyer /u/<unpublished> (unavailable)", `/u/${link.unpublished}`], ["buyer /u/<draft>", `/u/${link.draft}`], ["buyer /u/<unknown> (404)", "/u/doesnotexist1"], ["404 page", "/nope"], ["design page", "/design"], ["admin login", "/admin"], ["admin login2", "/admin/login"]];
for (const [n, u] of anon) { await p.goto(BASE + u, { waitUntil: "networkidle" }).catch(() => {}); await audit(n, u, p); }
// buyer page interactive states: validation errors + checkout (hosted mock page) + declined + success return
await p.goto(BASE + `/u/${link.spring}`, { waitUntil: "networkidle" });
await p.locator("[data-testid=buy-button]").click(); await p.waitForTimeout(300); await audit("buyer /u/<published> after empty submit (validation)", `/u/${link.spring}`, p);
await p.fill("#buyer-email", `audit+${Date.now()}@example.com`); await p.locator("[data-testid=over18]").check();
await Promise.all([p.waitForURL("**/pay/mock/**"), p.locator("[data-testid=buy-button]").click()]);
await p.waitForTimeout(500); const payUrl = p.url().replace(BASE, ""); await audit("hosted mock checkout /pay/mock/<session>", "/pay/mock/<session>", p);
await p.fill("input[name=card], input[autocomplete=cc-number], #card", "4000000000000002").catch(() => {});
const payBtn = p.locator("button[type=submit]").first(); await payBtn.click().catch(() => {}); await p.waitForTimeout(1500); await audit("hosted mock checkout after declined card", "/pay/mock/<session>", p);
// successful payment on a fresh session
await p.goto(BASE + `/u/${link.spring}`, { waitUntil: "networkidle" }); await p.fill("#buyer-email", `audit2+${Date.now()}@example.com`); await p.locator("[data-testid=over18]").check();
await Promise.all([p.waitForURL("**/pay/mock/**"), p.locator("[data-testid=buy-button]").click()]); await p.waitForTimeout(400);
await p.fill("input[name=card], input[autocomplete=cc-number], #card", "4242424242424242").catch(() => {}); await p.locator("button[type=submit]").first().click().catch(() => {}); await p.waitForTimeout(2500);
await audit("hosted mock checkout after successful payment (return/success state)", p.url().replace(BASE, ""), p);
const afterPayHtml = await p.content(); fs.writeFileSync(`${L.OUT}/fe7-copyaudit-${TAG}-after-pay.html`, afterPayHtml);
await p.screenshot({ path: `${L.OUT}/fe7-hosted-after-pay-${TAG}.png`, fullPage: true });
// seller pages
const { c, p: sp } = await L.login(b, seed.maya.email);
const dropId = seed.maya.dropIds.spring;
for (const [n, u] of [["dashboard overview", "/dashboard"], ["dashboard drops", "/dashboard/drops"], ["dashboard new drop", "/dashboard/new"], ["dashboard drop detail", `/dashboard/drops/${dropId}`], ["dashboard draft drop detail", `/dashboard/drops/${seed.maya.dropIds.draft}`]]) { await sp.goto(BASE + u, { waitUntil: "networkidle" }); await audit(n, u, sp); }
const { c: c2, p: jp } = await L.login(b, seed.jo.email); await jp.goto(BASE + "/dashboard", { waitUntil: "networkidle" }); await audit("dashboard overview (pending seller 'jo')", "/dashboard", jp);
const { c: c3, p: sm } = await L.login(b, seed.sam.email); await sm.goto(BASE + "/dashboard", { waitUntil: "networkidle" }); await audit("dashboard overview (empty seller 'sam')", "/dashboard", sm);
// static endpoints
for (const u of ["/manifest.webmanifest", "/robots.txt", "/sitemap.xml"]) { const r = await fetch(BASE + u); const t = r.status === 200 ? await r.text() : ""; pagesSeen.push(u + ` (${r.status})`); for (const s of sentences(t)) if (RE.test(s)) hits.push({ page: u, url: u, kind: "static", text: s.slice(0, 260) }); }
// mail dir (any email the app sent during this run)
const md = process.env.MAIL_DIR; let mails = 0; if (md && fs.existsSync(md)) for (const f of fs.readdirSync(md)) { mails++; const t = fs.readFileSync(md + "/" + f, "utf8"); const subj = (t.match(/^subject:\s*(.*)$/im) ?? [])[1]; for (const s of sentences(t)) if (RE.test(s)) hits.push({ page: `email file ${f.slice(0, 30)} (subject: ${subj})`, url: "mail", kind: "email", text: s.slice(0, 200) }); }
log(`pages audited (${pagesSeen.length}): ${pagesSeen.join(" | ")}; mail files: ${mails}`);
const bypage = {}; for (const h of hits) (bypage[h.page] ??= []).push(`[${h.kind}] ${h.text}`);
for (const [k, v] of Object.entries(bypage)) { log(`## ${k}`); for (const x of v) log(`   - ${x}`); }
fs.writeFileSync(`${L.OUT}/fe7-copyaudit-${TAG}.json`, JSON.stringify({ pagesSeen, hits }, null, 1));
await b.close();
