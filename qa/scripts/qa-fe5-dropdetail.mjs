// FE-15: drop detail page numbers (Sold/Revenue) == list == ledger for every Maya drop. env BASE, SEED, OUT, WT, DB
import * as L from "./qa-fe5-lib.mjs"; const { log, ok, usd, seed } = L; const b = await L.browser(); const db = await L.dbc();
const { p } = await L.login(b, seed.maya.email);
const sid = (await db.query("select id from sellers where email=$1", [seed.maya.email])).rows[0].id;
const drops = (await db.query(`select d.id, d.title, coalesce(sum(l.amount_cents) filter (where l.component='gross' and l.entry_type in ('sale_credit','refund_reversal','chargeback_reversal')),0)::int kept from drops d left join transactions t on t.drop_id=d.id left join ledger_entries l on l.transaction_id=t.id where d.seller_id=$1 group by d.id, d.title order by d.title`, [sid])).rows;
for (const d of drops) { await p.goto(`${L.BASE}/dashboard/drops/${d.id}`, { waitUntil: "networkidle" }); const t = (await p.locator("main").innerText()).replace(/\s+/g, " ");
  const m = t.match(/(Sold(?: \(net\))?|Units sold)[^$]{0,30}(\d+)[^$]{0,40}(Revenue(?: \(kept\))?|Earned)[^$]{0,10}(-?\$[\d,]+\.\d\d)/i) ?? t.match(/Revenue[^$]{0,10}(-?\$[\d,]+\.\d\d)/i);
  log(`   ${d.title}: ${m ? m[0] : "(no sold/revenue block)"}`); if (m) ok(m[m.length - 1] === usd(d.kept), `${d.title}: detail revenue ${m[m.length - 1]} == ledger ${usd(d.kept)}`); }
L.done(); await b.close(); await db.end();
