// FE-14 original repro: buy through the UI at /u/<id>, pay with 4242, observe copy on buyer page / hosted page / dashboard. env BASE, SEED, OUT, WT, DB
import * as L from "./qa-fe4-lib.mjs"; const { log, ok, seed, BASE } = L; const b = await L.browser();
const BAD = /receipt|instant(ly)?\s+download|download instantly|delivered immediately|unlock the moment|Unlock for|and download|download right away|files are delivered/i;
const link = seed.maya.links.spring;
for (const [name, vp] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const c = await b.newContext({ viewport: vp, extraHTTPHeaders: { "x-forwarded-for": L.fakeIp(61) } }); const p = await c.newPage();
  await p.goto(`${BASE}/u/${link}`, { waitUntil: "networkidle" });
  const label = await p.locator("label[for=buyer-email], label:has(#buyer-email)").first().innerText().catch(() => null) ?? await p.locator("#buyer-email").evaluate((e) => document.querySelector(`label[for="${e.id}"]`)?.textContent);
  ok(label?.trim() === "Email", `[${name}] email label is exactly "Email" (got ${JSON.stringify(label)})`);
  const btn = (await p.locator("[data-testid=buy-button]").innerText()).trim(); ok(/^Pay \$12\.00$/.test(btn), `[${name}] button reads "${btn}" (was "Unlock for $12.00")`);
  const form = (await p.locator("[data-testid=buy-form]").innerText()).replace(/\s+/g, " "); ok(/Pay by card · No account needed(?! ·)/.test(form) && !/Instant/.test(form), `[${name}] sub-line: "...${form.match(/Pay by card[^$]*?(?=All sales)/)?.[0]?.trim()}"`);
  ok((await p.locator("[data-testid=sales-final]").innerText()).trim() === "All sales are final. Because this is a digital product, purchases can't be refunded or exchanged once completed.", `[${name}] sales-final text has no "delivered immediately"`);
  const body = (await p.locator("body").innerText()).replace(/\s+/g, " ");
  ok(/Access after payment/.test(body) && /Once your payment is confirmed, we’ll share how to access your files\. Delivery options are coming soon\./.test(body), `[${name}] trust point "Access after payment ... Delivery options are coming soon."`);
  ok(/Just pay — nothing to sign up for\./.test(body), `[${name}] "Just pay — nothing to sign up for."`);
  const hits = body.split(/(?<=[.!?])\s+/).filter((s) => BAD.test(s)); ok(hits.length === 0, `[${name}] no receipt/instant-download/unlock promise on buyer page (hits: ${JSON.stringify(hits)})`);
  const remaining = body.match(/[^.]*unlock after purchase[^.]*\./i)?.[0]; log(`   (residual) [${name}] buyer page preview note: "${remaining?.trim()}"`);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(overflow <= 0, `[${name}] no horizontal overflow (${overflow}px)`);
  if (name === "desktop") await p.screenshot({ path: `${L.OUT}/fe4-buyer-copy-desktop.png`, fullPage: true }); else await p.screenshot({ path: `${L.OUT}/fe4-buyer-copy-mobile.png`, fullPage: true });
  // buy: UI -> hosted -> pay
  await p.locator("[data-testid=buy-button]").click(); await p.waitForTimeout(250);
  ok(!(await p.locator("[data-testid=buy-form]").innerText()).match(BAD), `[${name}] validation state: no promise text`);
  await p.fill("#buyer-email", `fe14+${Date.now()}@example.com`); await p.locator("[data-testid=over18]").check();
  await Promise.all([p.waitForURL("**/pay/mock/**"), p.locator("[data-testid=buy-button]").click()]);
  const hosted = (await p.locator("body").innerText()).replace(/\s+/g, " "); ok(!BAD.test(hosted) && /All sales are final\. Because this is a digital product, purchases/.test(hosted), `[${name}] hosted mock page: SALES_FINAL_TEXT updated, no promise`);
  await p.fill("input[name=card], input[autocomplete=cc-number], #card", "4242424242424242").catch(() => {}); await p.locator("button[type=submit]").first().click(); await p.waitForTimeout(2000);
  const after = (await p.locator("body").innerText()).replace(/\s+/g, " "); ok(/Payment succeeded/.test(after) && !BAD.test(after), `[${name}] after payment: "${after.slice(after.indexOf("Payment succeeded") - 5, after.indexOf("Payment succeeded") + 70)}" — no receipt/download promise; links: ${JSON.stringify(await p.locator("a").allInnerTexts())}`);
  await c.close();
}
// dashboard how-it-works + overview
const { c, p } = await L.login(b, seed.sam.email); await p.waitForLoadState("networkidle"); await p.waitForTimeout(500); const t = (await p.locator("main").innerText()).replace(/\s+/g, " ");
ok(/Buyers pay by card — no account needed\./.test(t) && !/download instantly/i.test(t), `dashboard "How it works": "${t.match(/1\. Upload[^]*?needed\.[^A-Z]*/)?.[0]}"`);
for (const u of ["/dashboard", "/dashboard/drops", "/dashboard/new"]) { await p.goto(BASE + u, { waitUntil: "networkidle" }); const x = (await p.locator("body").innerText()).replace(/\s+/g, " "); ok(!BAD.test(x), `[dashboard ${u}] no promise (${x.match(BAD)?.[0] ?? "-"})`); }
// rate-limit countdown label (default-limit server) keeps copy tidy
{ const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": L.fakeIp(62) } }); const q = await c2.newPage(); await q.goto(`${process.env.BASE_LIM}/u/${link}`, { waitUntil: "networkidle" });
  for (let i = 0; i < 11; i++) { await q.fill("#buyer-email", `rl${i}+${Date.now()}@example.com`); if (!(await q.locator("[data-testid=over18]").isChecked())) await q.locator("[data-testid=over18]").check(); const bt = await q.locator("[data-testid=buy-button]").innerText(); if (/Try again/.test(bt)) break; await Promise.all([q.waitForURL("**/pay/mock/**").catch(() => {}), q.locator("[data-testid=buy-button]").click()]); await q.waitForTimeout(400); if (q.url().includes("/pay/mock")) await q.goBack({ waitUntil: "networkidle" }); }
  await q.waitForTimeout(600); const bt = (await q.locator("[data-testid=buy-button]").innerText()).trim(); ok(/^Try again in \d+s$/.test(bt) && !BAD.test(await q.locator("body").innerText()), `rate-limit state label "${bt}"`); await c2.close(); }
L.done(); await b.close();
