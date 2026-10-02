// FE-07/FE-08 + M4-09: dashboard UI vs GET /api/earnings vs independent ledger recompute (maya, ned, boundaries, isolation). env BASE, SEED, DB, OUT, WT
import * as L from "./qa-fe5-lib.mjs"; const { log, ok, usd, BASE, seed } = L;
const db = await L.dbc(); const b = await L.browser();
const sid = async (email) => (await db.query("select id from sellers where email=$1", [email])).rows[0].id;
// independent truth from raw ledger rows (written differently from payments/earnings.ts)
async function truth(id) {
  const rows = (await db.query("select entry_type t, component c, amount_cents a, (available_at <= clock_timestamp()) av from ledger_entries where seller_id=$1", [id])).rows;
  const s = (f) => rows.filter(f).reduce((x, r) => x + r.a, 0);
  const po = (await db.query("select status, sum(amount_cents)::int a from payouts where seller_id=$1 group by 1", [id])).rows; const P = (st) => po.filter((r) => st.includes(r.status)).reduce((x, r) => x + r.a, 0);
  const t = { gross: s((r) => r.t === "sale_credit"), plat: -s((r) => r.c === "platform_fee"), proc: -s((r) => r.c === "processing_fee"), refunded: -s((r) => r.t === "refund_reversal" && r.c === "gross"), cb: -s((r) => r.t === "chargeback_reversal" && r.c === "gross"), cbfee: -s((r) => r.t === "chargeback_fee"),
    sales: rows.filter((r) => r.t === "sale_credit").length, paid: P(["paid"]), open: P(["requested", "approved"]), avail: s((r) => r.av), pend: s((r) => !r.av), net: s((r) => !["payout_debit", "payout_reversal"].includes(r.t)) };
  t.debits = -s((r) => r.t === "payout_debit") - s((r) => r.t === "payout_reversal"); // net money out through payouts (paid+open) per ledger
  return t;
}
async function apiEarn(email) { const { cookie } = await L.apiLogin(email); const r = await fetch(BASE + "/api/earnings", { headers: { cookie } }); return { status: r.status, j: await r.json(), cc: r.headers.get("cache-control") }; }
async function ui(email, shot, vp) {
  const { c, p } = await L.login(b, email, vp); await p.waitForSelector("[data-testid=earnings-breakdown]");
  const cards = await p.evaluate(() => { const o = {}; document.querySelectorAll("[data-testid=earnings-breakdown] > *, [data-testid=balance-cards] > *").forEach((e) => { const t = e.innerText.split("\n").map((x) => x.trim()).filter(Boolean); o[t[0]] = { v: t[1], hint: t.slice(2).join(" ") }; }); return o; });
  const q = async (id) => (await p.locator(`[data-testid=${id}]`).count()) ? (await p.locator(`[data-testid=${id}]`).first().innerText()).replace(/\s+/g, " ").trim() : null;
  const out = { cards, line: await q("net-breakdown"), rev: await q("reversals"), neg: await q("negative-balance"), main: await p.locator("main").innerText(), danger: await p.locator("[data-testid=balance-cards] > *:first-child").evaluate((e) => ({ cls: e.className, valCls: e.querySelector("p.text-2xl,p.text-3xl")?.className })) };
  if (shot) await p.screenshot({ path: `${L.OUT}/${shot}`, fullPage: true }); await c.close(); return out;
}
const ch = (label, cond, msg) => ok(cond, `[${label}] ${msg}`);
async function compare(label, email, shot) {
  const id = await sid(email), t = await truth(id), a = await apiEarn(email), v = await ui(email, shot); const A = a.j;
  log(`[${label}] ledger truth: ${JSON.stringify(t)}`); log(`[${label}] API: balance=${JSON.stringify(A.balance)} lifetime=${JSON.stringify(A.lifetime)} hold=${A.holdDays} eligible=${A.payoutEligible}`);
  log(`[${label}] UI cards: ${JSON.stringify(Object.fromEntries(Object.entries(v.cards).map(([k, x]) => [k, x.v])))}`); log(`[${label}] UI line: ${v.line} | reversals: ${v.rev} | owe: ${v.neg}`);
  ch(label, a.status === 200, "GET /api/earnings 200"); ch(label, (a.cc ?? "").toLowerCase().includes("no-store"), `API Cache-Control: ${a.cc}`);
  // API vs ledger
  ch(label, A.lifetime.grossCents === t.gross && A.lifetime.platformFeeCents === t.plat && A.lifetime.processingFeeCents === t.proc && A.lifetime.refundedCents === t.refunded && A.lifetime.chargebackCents === t.cb && A.lifetime.salesCount === t.sales, "API lifetime gross/fees/refunded/chargebacks/sales == raw-ledger recompute");
  ch(label, A.balance.availableCents === t.avail && A.balance.pendingCents === t.pend, `API available ${usd(A.balance.availableCents)} / pending ${usd(A.balance.pendingCents)} == ledger recompute ${usd(t.avail)} / ${usd(t.pend)}`);
  ch(label, A.lifetime.paidOutCents === t.paid && A.lifetime.requestedPayoutCents === t.open && t.debits === t.paid + t.open, `payouts: paid ${usd(t.paid)} + open ${usd(t.open)} == ledger payout debits ${usd(t.debits)}`);
  // UI vs API (the FE-07 claim)
  const g = (k) => v.cards[k]?.v; const E = (k) => usd(k);
  ch(label, g("Gross sales") === E(A.lifetime.grossCents), `UI Gross ${g("Gross sales")}`); ch(label, g("Platform fee") === E(A.lifetime.platformFeeCents), `UI Platform fee ${g("Platform fee")}`); ch(label, g("Processing fees") === E(A.lifetime.processingFeeCents), `UI Processing ${g("Processing fees")}`);
  ch(label, g("Your earnings (net)") === E(t.net), `UI Net ${g("Your earnings (net)")} == ledger net ${E(t.net)}`);
  const availKey = A.balance.availableCents < 0 ? "Balance owed" : "Available"; ch(label, g(availKey) === E(A.balance.availableCents), `UI ${availKey} ${g(availKey)} == API ${E(A.balance.availableCents)}`);
  ch(label, g("Pending") === E(A.balance.pendingCents), `UI Pending ${g("Pending")}`); ch(label, g("In payout") === E(A.lifetime.requestedPayoutCents), `UI In payout ${g("In payout")}`); ch(label, g("Paid out") === E(A.lifetime.paidOutCents), `UI Paid out ${g("Paid out")}`);
  const sum = A.balance.availableCents + A.balance.pendingCents + A.lifetime.requestedPayoutCents + A.lifetime.paidOutCents; ch(label, sum === t.net, `available + pending + in payout + paid out = ${E(sum)} == net ${E(t.net)}`);
  ch(label, t.gross - t.refunded - t.cb - t.plat - t.proc - t.cbfee === t.net, `gross − refunded − chargebacks − platform − processing − chargeback fees = net (${E(t.net)}, cb fees ${E(t.cbfee)})`);
  // reconciliation line arithmetic
  const nums = [...v.line.matchAll(/(-?)\$([\d,]+\.\d\d)/g)].map((m) => Math.round(parseFloat(m[2].replace(/,/g, "")) * 100) * (m[1] ? -1 : 1)); const calc = nums[0] - nums.slice(1, -1).reduce((x, y) => x + y, 0); ch(label, calc === nums.at(-1) && nums.at(-1) === t.net, `reconciliation line reconciles to the cent (${v.line})`);
  if (t.cbfee) ch(label, /chargeback fees/.test(v.line) && v.line.includes(`− ${E(t.cbfee)} chargeback fees`), `line names the ${E(t.cbfee)} chargeback fee`);
  return { t, A, v };
}
log("== A. Maya (refunds, partial refund, chargeback + $5 fee, payouts, pending)");
const M = await compare("maya", seed.maya.email, "fe5-dashboard-maya-desktop.png");
ok(M.t.gross === 46700 && M.t.refunded === 3500 && M.t.cb === 800 && M.t.cbfee === 500 && M.t.paid === 15000 && M.t.open === 6000 && M.t.sales === 33, "seed values: 33 sales $467.00 gross, refunded $25+$10=$35.00, chargeback $8.00 + $5.00 fee, paid $150, requested $60");
ok(!M.v.neg && M.v.danger.cls.indexOf("border-danger") < 0 && M.v.cards["Available"], "Maya (positive) shows 'Available' card, no red/alert");
ok(M.v.cards["Pending"].hint.includes("7 days"), "Pending hint states 7-day hold"); log("   reversals line:", M.v.rev);
ok(/\$35\.00 refunded/.test(M.v.rev) && /\$8\.00 charged back/.test(M.v.rev), "refund (full+partial) and chargeback shown separately and amounts match");
log("== B. Ned (negative balance, FE-08)");
const N = await compare("ned", seed.ned.email, "fe5-dashboard-ned-desktop.png");
ok(N.A.balance.availableCents === -4680 && N.t.avail === -4680, "ledger/API available = -$46.80");
ok(N.v.cards["Balance owed"]?.v === "-$46.80" && !N.v.cards["Available"], "red card is titled 'Balance owed' with value -$46.80 (no 'Available' card)");
ok(/text-danger/.test(N.v.danger.valCls ?? "") && /border-danger/.test(N.v.danger.cls), `card styled danger (border-danger, text-danger): ${N.v.danger.cls.match(/border-danger\/\d+/)?.[0]}`);
ok(N.v.neg && /You owe \$46\.80/.test(N.v.neg) && /deducted from your future earnings/.test(N.v.neg), `alert present: ${N.v.neg?.slice(0, 120)}`);
ok(N.v.cards["Paid out"].v === "$46.80" && N.v.cards["Pending"].v === "$0.00" && N.v.cards["In payout"].v === "$0.00", "paid out $46.80, pending $0, in payout $0");
ok(N.v.cards["Your earnings (net)"].v === "$0.00" && /\$60\.00 refunded/.test(N.v.rev), "net $0.00 after full refund; $60.00 refunded shown");
ok(!(await ui(seed.maya.email)).neg, "no alert for a non-negative seller");
log("== C. Sam (no sales) and Jo (pending verification)");
for (const [n, e] of [["sam", seed.sam.email], ["jo", seed.jo.email]]) { const r = await compare(n, e); ok(r.v.cards["Gross sales"].v === "$0.00" && !/NaN|Infinity|undefined/.test(r.v.main), `${n}: zeros, no NaN/undefined`); }
log("== D. isolation / auth");
{ const na = await fetch(BASE + "/api/earnings"); ok(na.status === 401, `GET /api/earnings anonymous -> ${na.status}`);
  const ra = await fetch(BASE + "/dashboard", { redirect: "manual" }); ok([302, 303, 307, 308].includes(ra.status) && /\/login/.test(ra.headers.get("location") ?? ""), `GET /dashboard anonymous -> ${ra.status} ${ra.headers.get("location")}`);
  for (const q of ["?sellerId=" + (await sid(seed.maya.email)), "?seller=" + (await sid(seed.maya.email)), "?id=" + (await sid(seed.maya.email))]) { const { cookie } = await L.apiLogin(seed.ned.email); const r = await (await fetch(BASE + "/api/earnings" + q, { headers: { cookie } })).json(); ok(r.balance.availableCents === -4680, `Ned + ${q.slice(0, 12)}… still sees only Ned (${r.balance.availableCents})`); }
  const { cookie } = await L.apiLogin(seed.ned.email); const h = await (await fetch(BASE + "/api/earnings", { headers: { cookie, "x-seller-id": await sid(seed.maya.email) } })).json(); ok(h.balance.availableCents === -4680, "x-seller-id header ignored");
  const v = await ui(seed.ned.email); ok(!/Spring collection|Studio colour|Travel set|maya/i.test(v.main) && !/maya/i.test(JSON.stringify(v)), "Ned's dashboard HTML has none of Maya's drops/name");
  const rr = await (await fetch(BASE + "/api/earnings", { headers: { cookie: (await L.apiLogin(seed.maya.email)).cookie } })).text(); ok(!/buyer\d+\+|@example\.test/.test(rr), "API /earnings has no buyer emails"); }
log("== E. FE-15 per-drop Sold/Revenue vs /api/earnings vs raw ledger");
// independent per-drop truth from ledger_entries joined to transactions (does NOT use transactions.reversed_cents / status)
async function dropTruth(sellerEmail) {
  const id = await sid(sellerEmail);
  return (await db.query(`select d.id, d.title,
      coalesce(sum(l.amount_cents) filter (where l.component='gross' and l.entry_type in ('sale_credit','refund_reversal','chargeback_reversal')),0)::int kept,
      (select count(*) from (select t.id from transactions t join ledger_entries le on le.transaction_id=t.id where t.drop_id=d.id and le.component='gross' and le.entry_type in ('sale_credit','refund_reversal','chargeback_reversal') group by t.id having sum(le.amount_cents) > 0) x)::int units
    from drops d left join transactions t on t.drop_id=d.id left join ledger_entries l on l.transaction_id=t.id where d.seller_id=$1 group by d.id, d.title order by d.title`, [id])).rows;
}
async function uiDrops(email, vp, shot) {
  const { c, p } = await L.login(b, email, vp); await p.goto(BASE + "/dashboard/drops"); await p.waitForLoadState("networkidle");
  const rows = await p.evaluate(() => [...document.querySelectorAll("tbody tr")].filter((r) => r.offsetParent).map((r) => { const td = [...r.querySelectorAll("td")].map((x) => x.innerText.trim()); return { title: td[0].split("\n")[0], cells: td, rev: r.querySelector("[data-testid=drop-revenue]")?.innerText ?? null }; }));
  const cards = await p.evaluate(() => [...document.querySelectorAll("li")].filter((r) => r.offsetParent && r.querySelector("[data-testid=drop-revenue]")).map((r) => ({ text: r.innerText.replace(/\s+/g, " "), rev: r.querySelector("[data-testid=drop-revenue]").innerText })));
  if (shot) await p.screenshot({ path: `${L.OUT}/${shot}`, fullPage: true }); await c.close(); return { rows, cards };
}
for (const [name, em] of [["maya", seed.maya.email], ["ned", seed.ned.email], ["sam", seed.sam.email], ["jo", seed.jo.email]]) {
  const T = await dropTruth(em); const A = (await apiEarn(em)).j; const kept = A.lifetime.grossCents - A.lifetime.refundedCents - A.lifetime.chargebackCents;
  const U = await uiDrops(em, { width: 1280, height: 900 }, name === "maya" ? "fe5-drops-maya-desktop.png" : null);
  const Um = await uiDrops(em, { width: 390, height: 844 }, name === "maya" ? "fe5-drops-maya-mobile.png" : null);
  log(`[${name}] ledger per-drop: ${JSON.stringify(T.map((x) => [x.title, x.units, usd(x.kept)]))}`); log(`[${name}] UI desktop rows: ${JSON.stringify(U.rows.map((r) => [r.title, r.cells[5] ?? null, r.rev]))}`);
  const sumUi = U.rows.reduce((x, r) => x + (r.rev ? Math.round(parseFloat(r.rev.replace(/[$,]/g, "")) * 100) : 0), 0);
  ok(sumUi === kept && T.reduce((x, y) => x + y.kept, 0) === kept, `[${name}] sum of per-drop UI revenue ${usd(sumUi)} == API gross - refunded - charged back ${usd(kept)} == ledger per-drop sum`);
  for (const t of T) { const r = U.rows.find((x) => x.title === t.title); if (!r) { ok(false, `[${name}] ${t.title}: row missing`); continue; } ok(r.rev === usd(t.kept) && parseInt(r.cells[4] ?? r.cells[3]) >= 0, `[${name}] ${t.title}: UI revenue ${r.rev} == ledger ${usd(t.kept)}; cells=${JSON.stringify(r.cells)}`); const sold = r.cells.filter((x) => /^\d+$/.test(x)); ok(sold.includes(String(t.units)), `[${name}] ${t.title}: Sold ${t.units} shown (numeric cells ${sold})`); const m = Um.cards.find((x) => x.text.includes(t.title)); if (m) ok(m.rev === usd(t.kept), `[${name}] ${t.title}: mobile card revenue ${m.rev} == ${usd(t.kept)}`); }
}
{ const T = await dropTruth(seed.maya.email); log("   maya drops (ledger):", JSON.stringify(T.map((x) => ({ t: x.title, units: x.units, kept: x.kept })))); ok(T.reduce((x, y) => x + y.kept, 0) === 42400, "Maya's per-drop sum == $424.00 (467 - 35 refunded - 8 charged back)"); }
L.done(); await b.close(); await db.end();
