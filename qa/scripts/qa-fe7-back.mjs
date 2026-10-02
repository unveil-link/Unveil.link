// BuyPanel after redirect: browser Back from the hosted page (busy state stuck? key reuse after paying?). env BASE, SEED, OUT, WT
import * as L from "./qa-fe7-lib.mjs"; const { log, ok, BASE, seed } = L; const b = await L.browser(); const link = seed.maya.links.spring;
for (const bf of [false, true]) {
  const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": L.fakeIp(57) } }); const p = await c.newPage();
  const keys = []; p.on("request", (r) => { if (r.url().endsWith("/api/checkout") && r.method() === "POST") keys.push(r.headers()["idempotency-key"]); });
  await p.goto(`${BASE}/u/${link}`); await p.fill("#buyer-email", `back${bf}@example.test`); await p.locator("#over18").check(); await Promise.all([p.waitForURL("**/pay/mock/**"), p.locator("[data-testid=buy-button]").click()]);
  await p.locator("button:has-text('Pay (mock)')").click(); await p.waitForFunction(() => /succeeded/i.test(document.querySelector("[data-testid=mock-result]")?.textContent ?? ""));
  await p.goBack(); await p.waitForTimeout(1200); const st = await p.evaluate(() => { const b = document.querySelector("[data-testid=buy-button]"); return { disabled: b.disabled, busy: b.getAttribute("aria-busy"), text: b.innerText.trim(), nav: performance.getEntriesByType("navigation")[0]?.type }; });
  log(`   Back from hosted page (run ${bf ? "2" : "1"}): url ${p.url().replace(BASE, "")} button ${JSON.stringify(st)}`);
  ok(!st.disabled && st.busy !== "true", `Buy button usable after Back (disabled=${st.disabled}, aria-busy=${st.busy}, navigation type ${st.nav})`);
  const n0 = keys.length; await p.fill("#buyer-email", `back${bf}@example.test`); const chk = p.locator("#over18"); if (!(await chk.isChecked())) await chk.check(); await p.locator("[data-testid=buy-button]").click({ timeout: 5000 }).catch((e) => log("   click failed:", e.message.split("\n")[0])); await p.waitForTimeout(1500);
  log(`   second Buy after paying: POSTs ${keys.length - n0}, keys ${JSON.stringify(keys)}, url ${p.url().replace(BASE, "")}`); if (/pay\/mock/.test(p.url())) { const t = await p.locator("body").innerText(); log("   hosted page text now:", t.replace(/\n+/g, " | ").slice(0, 220)); }
  await c.close();
}
L.done(); await b.close();
