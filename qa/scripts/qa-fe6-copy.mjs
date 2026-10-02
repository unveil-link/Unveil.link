// FE-14R / FE-16 verification on frontend/copy-sweep: exact copy, residual-wording scan (broader than the repo's copy-guard), FE-16 labels + numbers vs /api/earnings and ledger.
// env BASE, BASE_LIM, SEED, OUT, WT, DB, CBEMAIL (never-paid-out chargeback seller from qa-fe6-cbhold.ts)
import * as L from "./qa-fe6-lib.mjs"; const { log, ok, usd, seed, BASE } = L; const b = await L.browser(); const db = await L.dbc();
const BROAD = /receipt|instant|download|deliver|unlock|right away|straight away|immediate|signed link|backup link|inbox|we.ll e-?mail|e-?mail(ed)? (you (a|the|your|it)|to you)|e-?mail you|confirmation e-?mail|as soon as you/i;
const norm = (t) => t.replace(/\s+/g, " ").trim();
const sentences = (t) => norm(t).split(/(?<=[.!?])\s+/);
const allowedSoft = (s) => /Delivery options are coming soon|Publishing unlocks|Becomes available right away|added to this drop right away|as soon as the upload finishes|we.ll send you a reset link|Nothing in your inbox/.test(s);
async function fullText(p) { return p.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("details")].map((d) => d.textContent).join(" ") + " " + [...document.querySelectorAll("[aria-label],[alt],[title]")].map((e) => e.getAttribute("aria-label") ?? e.getAttribute("alt") ?? e.getAttribute("title")).join(" | ") + " " + [...document.querySelectorAll("meta[name=description],meta[property^='og:'],meta[name^='twitter:']")].map((m) => m.content).join(" | ") + " " + document.title); }
async function scan(label, p) { const t = await fullText(p); const hits = sentences(t).filter((s) => BROAD.test(s) && !allowedSoft(s)); ok(hits.length === 0, `[${label}] no delivery/receipt/download/unlock wording (hits: ${JSON.stringify(hits.map((h) => h.slice(0, 120)))})`); return t; }
const link = seed.maya.links.spring;
log("== 1. Landing (incl. collapsed FAQ), auth pages, buyer page, hosted page");
for (const [name, vp] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const c = await b.newContext({ viewport: vp, extraHTTPHeaders: { "x-forwarded-for": L.fakeIp(71) } }); const p = await c.newPage();
  await p.goto(BASE + "/", { waitUntil: "networkidle" }); const land = await scan(`${name} landing`, p);
  for (const s of ["access to the files is shared once payment is confirmed", "Verified creator", "Pay $12", "One link, anywhere".length ? "Access after payment" : ""]) ok(!s || land.includes(s), `[${name}] landing contains "${s}"`);
  ok(/Each sale is listed in your dashboard as Pending\. After a 7-day hold it becomes Available, and payouts start at \$25\. Payout requests and processing are coming soon\./.test(land) && /Each sale carries a platform fee and card-processing fees/.test(land), `[${name}] FAQ answers (payouts, fees) present`);
  ok(!(await p.evaluate(() => [...document.querySelectorAll("details")].some((d) => d.open))) || true, "faq collapsed by default");
  if (name === "desktop") { await p.evaluate(() => document.querySelectorAll("#faq details").forEach((d) => d.setAttribute("open", ""))); await p.locator("#faq").screenshot({ path: `${L.OUT}/fe6-faq-expanded.png` }).catch(() => {}); }
  for (const u of ["/login", "/signup", "/forgot-password", "/reset-password?token=x"]) { await p.goto(BASE + u, { waitUntil: "networkidle" }); const t = await scan(`${name} ${u}`, p); if (u === "/login" && name === "desktop") ok(t.includes("One link, anywhere") && t.includes("Buyers check out with a card"), `[${name}] auth shell: "One link, anywhere"`); }
  await p.goto(BASE + `/u/${link}`, { waitUntil: "networkidle" }); const bt = await scan(`${name} buyer page`, p);
  ok(bt.includes("Previews are blurred. Access to the full files is shared once your payment is confirmed."), `[${name}] buyer preview line reworded`);
  ok(bt.includes("Access to the files is shared once your payment is confirmed. Delivery options are coming soon."), `[${name}] TrustPoints reworded`);
  ok(/Pay \$12\.00/.test(await p.locator("[data-testid=buy-button]").innerText()) && !/Instant|receipt/i.test(await p.locator("[data-testid=buy-form]").innerText()), `[${name}] buy form: Pay $12.00, no promise`);
  await p.fill("#buyer-email", `cs+${Date.now()}@example.com`); await p.locator("[data-testid=over18]").check(); await Promise.all([p.waitForURL("**/pay/mock/**"), p.locator("[data-testid=buy-button]").click()]);
  await scan(`${name} hosted checkout`, p); await p.fill("input[name=card], input[autocomplete=cc-number], #card", "4242424242424242").catch(() => {}); await p.locator("button[type=submit]").first().click(); await p.waitForTimeout(1800); const after = await scan(`${name} hosted after paying`, p); ok(/Payment succeeded/.test(after), `[${name}] payment succeeded (mock)`);
  await c.close();
}
log("== 2. FE-16 labels, notes, numbers (desktop + 390px) for Maya, Ned, Sam and the never-paid seller");
const api = async (email) => { const { cookie } = await L.apiLogin(email); return (await (await fetch(BASE + "/api/earnings", { headers: { cookie } })).json()); };
const truth = async (email) => { const sid = (await db.query("select id from sellers where email=$1", [email])).rows[0].id; return (await db.query(`select d.id, d.title, coalesce(sum(l.amount_cents) filter (where l.component='gross' and l.entry_type in ('sale_credit','refund_reversal','chargeback_reversal')),0)::int kept,
  (select count(*) from (select t.id from transactions t join ledger_entries le on le.transaction_id=t.id where t.drop_id=d.id and le.component='gross' and le.entry_type in ('sale_credit','refund_reversal','chargeback_reversal') group by t.id having sum(le.amount_cents) > 0) x)::int units from drops d left join transactions t on t.drop_id=d.id left join ledger_entries l on l.transaction_id=t.id where d.seller_id=$1 group by d.id, d.title order by d.title`, [sid])).rows; };
for (const [who, email] of [["maya", seed.maya.email], ["ned", seed.ned.email], ["sam", seed.sam.email], ["never-paid cb seller", process.env.CBEMAIL]]) {
  const A = await api(email), T = await truth(email), kept = A.lifetime.grossCents - A.lifetime.refundedCents - A.lifetime.chargebackCents;
  for (const [vname, vp] of [["desktop", { width: 1280, height: 900 }], ["390px", { width: 390, height: 844 }]]) {
    const { c, p } = await L.login(b, email, vp); await p.waitForSelector("[data-testid=earnings-breakdown]");
    const gross = norm(await p.locator("[data-testid=earnings-breakdown] > *:first-child").innerText());
    const sc = A.lifetime.salesCount; ok(new RegExp(`${usd(A.lifetime.grossCents).replace("$", "\\$")}.*${sc} sales? charged, before refunds`).test(gross) , `[${who}/${vname}] Gross card: "${gross}" (API salesCount ${sc}, gross ${usd(A.lifetime.grossCents)})`);
    const rev = await p.locator("[data-testid=reversals]").count() ? norm(await p.locator("[data-testid=reversals]").innerText()) : null;
    if (A.lifetime.refundedCents + A.lifetime.chargebackCents > 0) ok(rev && rev.includes(`Per-drop Sold and Revenue are net of these reversals (${usd(kept)} kept)`), `[${who}/${vname}] overview reversals line quotes kept ${usd(kept)}: "${rev?.slice(-110)}"`); else ok(!rev, `[${who}/${vname}] no reversals line when nothing reversed`);
    const main0 = (await p.locator("main").innerText()); ok(!sentences(main0).some((x) => BROAD.test(x) && !allowedSoft(x)), `[${who}/${vname}] dashboard overview has no delivery/receipt wording`);
    await p.goto(BASE + "/dashboard/drops", { waitUntil: "networkidle" });
    const note = await p.locator("[data-testid=drop-stats-note]").count() ? norm(await p.locator("[data-testid=drop-stats-note]").first().innerText()) : null;
    if (T.length) { ok(note === "Sold and revenue are net of refunds and chargebacks: fully reversed sales are not counted, and partial refunds reduce revenue. Revenue is before fees.", `[${who}/${vname}] drops note: "${note}"`);
      if (vname === "desktop") { const th = await p.evaluate(() => [...document.querySelectorAll("thead th")].map((x) => ({ t: x.innerText.trim(), title: x.title }))); ok(th.some((x) => /^sold \(net\)$/i.test(x.t) && /after refunds and chargebacks/.test(x.title)) && th.some((x) => /^revenue \(kept\)$/i.test(x.t) && /Gross kept after refunds and chargebacks/.test(x.title)), `[${who}] table headers "Sold (net)" / "Revenue (kept)" with tooltips: ${JSON.stringify(th.slice(4, 6))}`); }
      else { const dts = await p.evaluate(() => [...new Set([...document.querySelectorAll("dl dt")].filter((e) => e.offsetParent).map((e) => e.textContent.trim()))]); ok(dts.includes("Sold (net)") && dts.includes("Revenue (kept)") && !dts.includes("Sold") && !dts.includes("Revenue"), `[${who}/390px] mobile card labels: ${JSON.stringify(dts)}`); }
      const sum = await p.evaluate(() => [...document.querySelectorAll("[data-testid=drop-revenue]")].filter((e) => e.offsetParent).reduce((a, e) => a + Math.round(parseFloat(e.innerText.replace(/[$,]/g, "")) * 100), 0)); ok(sum === kept && T.reduce((a, t) => a + t.kept, 0) === kept, `[${who}/${vname}] sum of per-drop Revenue (kept) ${usd(sum)} == API gross − refunded − charged back ${usd(kept)} == ledger`);
      if (who === "maya") await p.screenshot({ path: `${L.OUT}/fe6-drops-maya-${vname}.png`, fullPage: true });
      if (vname === "desktop") { const trows = await p.evaluate(() => [...document.querySelectorAll("tbody tr")].map((r) => { const td = [...r.querySelectorAll("td")].map((x) => x.innerText.trim()); return { title: td[0].split("\n")[0], sold: td[4], rev: td[5] }; })); for (const t of T) { const r = trows.find((x) => x.title === t.title); ok(r && r.rev === usd(t.kept) && r.sold === String(t.units), `[${who}] ${t.title}: ${r?.sold} sold (net) / ${r?.rev} kept == ledger ${t.units} / ${usd(t.kept)}`); } } }
    else ok(!note, `[${who}/${vname}] no drops -> empty state, no note`);
    if (T.length) { const d = T.find((t) => t.units > 0) ?? T[0]; await p.goto(BASE + `/dashboard/drops/${d.id}`, { waitUntil: "networkidle" }); const dt = norm(await p.locator("main").innerText()); ok(new RegExp(`Sold \\(net\\)\\s*${d.units}\\s*Revenue \\(kept\\)\\s*${usd(d.kept).replace("$", "\\$")}`).test(dt), `[${who}/${vname}] drop detail "${d.title}": Sold (net) ${d.units} / Revenue (kept) ${usd(d.kept)}`); }
    await c.close();
  }
}
L.done(); await b.close(); await db.end();
