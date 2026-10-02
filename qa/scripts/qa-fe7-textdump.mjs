// Dump all user-visible text (innerText + collapsed <details> + meta/og/twitter + aria/alt/title/placeholder) of every reachable page/state for a manual claim sweep.
// env BASE, SEED, OUT, WT, DB, CBEMAIL. usage: node qa-fe7-textdump.mjs  -> $OUT/fe7-textdump.txt
import * as L from "./qa-fe7-lib.mjs"; import fs from "node:fs"; const { BASE, seed } = L;
const b = await L.browser(); const out = [];
async function dump(name, p) {
  const t = await p.evaluate(() => document.body.innerText + "\n[details] " + [...document.querySelectorAll("details")].map((d) => d.textContent).join(" | "));
  const meta = await p.evaluate(() => [...document.querySelectorAll("meta[name=description],meta[property^='og:'],meta[name^='twitter:'],meta[name=robots]")].map((m) => `${m.getAttribute("name") ?? m.getAttribute("property")}=${m.content}`).concat(["title=" + document.title]));
  const attrs = await p.evaluate(() => [...document.querySelectorAll("[aria-label],[alt],[title],input[placeholder]")].map((e) => (e.getAttribute("aria-label") ?? e.getAttribute("alt") ?? e.getAttribute("title") ?? e.getAttribute("placeholder"))).filter(Boolean));
  out.push(`\n######## ${name}\n--- meta\n${meta.join("\n")}\n--- attrs\n${[...new Set(attrs)].join("\n")}\n--- text\n${t.replace(/\n{2,}/g, "\n")}`);
}
const link = seed.maya.links;
for (const [vp, w] of [["desktop", 1280]]) {
  const c = await b.newContext({ viewport: { width: w, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": L.fakeIp(81) } }); const p = await c.newPage();
  for (const [n, u] of [["landing", "/"], ["login", "/login"], ["signup", "/signup"], ["forgot-password", "/forgot-password"], ["reset-password", "/reset-password?token=x"], ["terms", "/terms"], ["privacy", "/privacy"], ["dmca", "/dmca"], ["contact", "/contact"],
    ["buyer published", `/u/${link.spring}`], ["buyer unpublished", `/u/${link.unpublished}`], ["buyer draft", `/u/${link.draft}`], ["buyer unknown", "/u/doesnotexist1"], ["404", "/nope"], ["admin login", "/admin/login"]]) {
    await p.goto(BASE + u, { waitUntil: "networkidle" }).catch(() => {}); await dump(n, p);
  }
  // buyer validation error state
  await p.goto(BASE + `/u/${link.spring}`, { waitUntil: "networkidle" }); await p.locator("[data-testid=buy-button]").click(); await p.waitForTimeout(300); await dump("buyer validation errors", p);
  await p.fill("#buyer-email", `dump+${Date.now()}@example.com`); await p.locator("[data-testid=over18]").check();
  await Promise.all([p.waitForURL("**/pay/mock/**"), p.locator("[data-testid=buy-button]").click()]); await p.waitForTimeout(500); await dump("hosted /pay/mock page", p);
  await c.close();
}
for (const [who, email] of [["maya", seed.maya.email], ["jo (pending)", seed.jo.email], ["sam (empty)", seed.sam.email], ["ned (negative)", seed.ned.email], ["never-paid cb seller", process.env.CBEMAIL]]) {
  if (!email) continue;
  const { c, p } = await L.login(b, email);
  const paths = [["overview", "/dashboard"], ["drops", "/dashboard/drops"], ["new drop", "/dashboard/drops/new"]];
  if (who === "maya") { paths.push(["published drop detail", `/dashboard/drops/${seed.maya.dropIds.spring}`], ["draft drop detail", `/dashboard/drops/${seed.maya.dropIds.draft}`]); }
  for (const [n, u] of paths) { await p.goto(BASE + u, { waitUntil: "networkidle" }).catch(() => {}); await dump(`${who}: ${n}`, p); }
  if (who === "jo (pending)") { // try to publish the pending seller's draft -> dialog
    await p.goto(BASE + `/dashboard/drops/${seed.jo.dropId}`, { waitUntil: "networkidle" }); await dump("jo: drop detail", p);
    const btn = p.getByRole("button", { name: /publish/i }).first(); if (await btn.count()) { await btn.click().catch(() => {}); await p.waitForTimeout(800); await dump("jo: after clicking Publish", p); }
  }
  await c.close();
}
fs.writeFileSync(`${L.OUT}/fe7-textdump.txt`, out.join("\n")); console.log("pages dumped:", out.length);
await b.close();
