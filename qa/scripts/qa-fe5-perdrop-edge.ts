// FE-15 edge cases: per-drop Sold/Revenue (dashboard /dashboard/drops) vs raw ledger (ledger_entries x transactions) vs GET /api/earnings.
// Scenarios: all refunded (full + 2 partials), zero-sales drop, chargeback after payout, partial refund then chargeback, partial chargeback,
// over-refund, declined/pending checkouts, price edited after sale, many partial refunds. Run from worktree: BASE_URL=... npx tsx qa/scripts/qa-fe5-perdrop-edge.ts (.env: DATABASE_URL, PAYMENT_WEBHOOK_SECRET)
import { config } from "dotenv"; import crypto from "node:crypto"; import { Client } from "pg"; import { createRequire } from "node:module"; config({ path: ".env" });
const { chromium } = createRequire(process.cwd() + "/package.json")("playwright-core");
const BASE = process.env.BASE_URL!; const PW = "Sunrise-Harbor-4821"; let n = 0; const ip = () => `10.61.${Math.floor(Math.random() * 250)}.${(n++ % 250) + 1}`; let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`   ${c ? "OK  " : "FAIL"} ${m}`); if (!c) fails++; };
const usd = (c: number) => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const J = async (path: string, body: unknown, cookie?: string) => { const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip(), ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => null), ck: r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ") }; };
async function main() {
  const { mockEvents, signMockEvent } = await import("../../src/server/payments/mock/events"); const P = await import("../../src/server/payments/payouts");
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect(); const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const hook = async (ev: any) => { const sgn = signMockEvent(ev, process.env.PAYMENT_WEBHOOK_SECRET!); const w = await fetch(BASE + "/api/webhooks/mock", { method: "POST", headers: sgn.headers, body: sgn.rawBody }); return w.status; };
  const mkSeller = async (tag: string) => { const email = `qa-pd-${tag}-${crypto.randomBytes(3).toString("hex")}@example.com`; const su = await J("/api/auth/signup", { email, password: PW, displayName: "PD " + tag }); if (su.s !== 201) throw new Error("signup " + su.s); const id = (await db.query("update sellers set verification_status='verified' where email=$1 returning id", [email])).rows[0].id; return { email, id }; };
  const mkDrop = async (sid: string, title: string, cents: number, status = "published") => { const link = crypto.randomBytes(9).toString("base64url").slice(0, 12); const r = await db.query("insert into drops (seller_id,title,description,price_cents,status,public_link_id) values ($1,$2,'d',$3,$4,$5) returning id", [sid, title, cents, status, link]); return { id: r.rows[0].id as string, link }; };
  const sale = async (link: string, card = "4242424242424242") => { const c = await J("/api/checkout", { linkId: link, email: `b${crypto.randomBytes(3).toString("hex")}@example.test`, confirmOver18: true }); if (c.s !== 201) throw new Error("checkout " + c.s); const p = await J("/api/dev/payments/pay", { sessionId: c.j.checkoutUrl.split("/").pop(), card }); return { tx: c.j.transactionId as string, status: p.j?.status as string }; };
  const refund = (tx: string, amt: number | null, id: string) => hook(mockEvents.refund({ transactionId: tx, refundId: id, amountCents: amt }));
  const chargeback = (tx: string, amt: number | null) => hook(mockEvents.chargeback({ transactionId: tx, amountCents: amt }));
  const truth = async (sid: string) => (await db.query(`select d.id, d.title, coalesce(sum(l.amount_cents) filter (where l.component='gross' and l.entry_type in ('sale_credit','refund_reversal','chargeback_reversal')),0)::int kept,
      (select count(*) from (select t.id from transactions t join ledger_entries le on le.transaction_id=t.id where t.drop_id=d.id and le.component='gross' and le.entry_type in ('sale_credit','refund_reversal','chargeback_reversal') group by t.id having sum(le.amount_cents) > 0) x)::int units
      from drops d left join transactions t on t.drop_id=d.id left join ledger_entries l on l.transaction_id=t.id where d.seller_id=$1 group by d.id, d.title order by d.title`, [sid])).rows;
  const check = async (label: string, s: { email: string; id: string }, expect: Record<string, [number, number]>) => {
    const T = await truth(s.id); const lg = await J("/api/auth/login", { email: s.email, password: PW }); const A = await (await fetch(BASE + "/api/earnings", { headers: { cookie: lg.ck } })).json();
    const kept = A.lifetime.grossCents - A.lifetime.refundedCents - A.lifetime.chargebackCents;
    for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const c = await b.newContext({ viewport: vp, extraHTTPHeaders: { "x-forwarded-for": ip() } }); const p = await c.newPage();
      await p.goto(BASE + "/login"); await p.fill('input[name="email"]', s.email); await p.fill('input[name="password"]', PW); await Promise.all([p.waitForURL("**/dashboard**"), p.locator("form button[type=submit]").click()]);
      await p.goto(BASE + "/dashboard/drops"); await p.waitForLoadState("networkidle");
      const rows = vp.width > 600 ? await p.evaluate(() => [...document.querySelectorAll("tbody tr")].filter((r) => (r as HTMLElement).offsetParent).map((r) => { const td = [...r.querySelectorAll("td")].map((x) => (x as HTMLElement).innerText.trim()); return { title: td[0].split("\n")[0], sold: td[4], rev: (r.querySelector("[data-testid=drop-revenue]") as HTMLElement | null)?.innerText ?? null }; }))
        : await p.evaluate(() => [...document.querySelectorAll("li")].filter((r) => (r as HTMLElement).offsetParent && r.querySelector("[data-testid=drop-revenue]")).map((r) => { const t = (r as HTMLElement).innerText; return { title: t.split("\n")[0].trim(), sold: (t.match(/Sold(?: \(net\))?\s*\n?\s*(\d+)/) ?? [])[1], rev: (r.querySelector("[data-testid=drop-revenue]") as HTMLElement).innerText }; }));
      const tag = vp.width > 600 ? "desktop" : "mobile";
      if (tag === "desktop") console.log(`   [${label}] ledger: ${JSON.stringify(T.map((x) => [x.title, x.units, usd(x.kept)]))}  UI: ${JSON.stringify(rows.map((r: any) => [r.title, r.sold, r.rev]))}  API kept=${usd(kept)}`);
      for (const t of T) { const r: any = rows.find((x: any) => x.title === t.title); ok(!!r && r.rev === usd(t.kept) && String(r.sold) === String(t.units), `[${label}/${tag}] ${t.title}: UI Sold ${r?.sold} / ${r?.rev} == ledger ${t.units} / ${usd(t.kept)}`); const e = expect[t.title]; if (e) ok(t.units === e[0] && t.kept === e[1], `[${label}] ${t.title}: ledger truth == expected ${e[0]} / ${usd(e[1])}`); }
      ok(rows.length === T.length, `[${label}/${tag}] row count ${rows.length} == drops ${T.length}`);
      ok(rows.reduce((x: number, r: any) => x + Math.round(parseFloat((r.rev || "0").replace(/[$,]/g, "")) * 100), 0) === kept, `[${label}/${tag}] sum of per-drop revenue == API gross - refunded - charged back (${usd(kept)})`);
      if (label === "S3 chargeback-after-payout" && tag === "desktop") await p.screenshot({ path: `${process.env.OUT ?? "qa/artifacts/fe5"}/fe5-perdrop-s3-cb-after-payout.png`, fullPage: true });
      await c.close();
    }
    return { T, A };
  };
  // S1 all refunded (full, two partials summing to full, three partials)
  console.log("== S1 all sales refunded");
  { const s = await mkSeller("allref"); const d = await mkDrop(s.id, "All refunded", 2000); const a = await sale(d.link), b2 = await sale(d.link), c3 = await sale(d.link);
    await refund(a.tx, null, "rf1" + a.tx.slice(0, 6)); await refund(b2.tx, 500, "rf2a" + b2.tx.slice(0, 6)); await refund(b2.tx, 1500, "rf2b" + b2.tx.slice(0, 6)); await refund(c3.tx, 700, "rf3a" + c3.tx.slice(0, 6)); await refund(c3.tx, 700, "rf3b" + c3.tx.slice(0, 6)); await refund(c3.tx, 600, "rf3c" + c3.tx.slice(0, 6));
    const r = await check("S1 all-refunded", s, { "All refunded": [0, 0] }); console.log("   tx statuses:", JSON.stringify((await db.query("select status, amount_cents, reversed_cents from transactions where seller_id=$1 order by created_at", [s.id])).rows)); ok(r.A.lifetime.refundedCents === 6000, "API refunded $60.00"); }
  // S2 zero sales + one normal
  console.log("== S2 drop with zero sales / mixed");
  { const s = await mkSeller("zero"); await mkDrop(s.id, "Never sold", 1500); const d2 = await mkDrop(s.id, "One sale", 2000); await sale(d2.link); await mkDrop(s.id, "Draft", 900, "draft");
    await check("S2 zero-sales", s, { "Never sold": [0, 0], "One sale": [1, 2000], Draft: [0, 0] }); }
  // S3 chargeback after payout
  console.log("== S3 chargeback after payout (+ $5 fee)");
  { const s = await mkSeller("cbpay"); const d1 = await mkDrop(s.id, "Paid then disputed", 2000), d2 = await mkDrop(s.id, "Stays good", 3000); await db.query("update platform_settings set payout_hold_days=0 where id=1");
    const a = await sale(d1.link); await sale(d2.link); await sale(d2.link); const lg = await J("/api/auth/login", { email: s.email, password: PW }); const e0 = await (await fetch(BASE + "/api/earnings", { headers: { cookie: lg.ck } })).json();
    const po = await P.requestPayout(s.id, e0.balance.availableCents); await P.approvePayout(po.id); await P.markPayoutPaid(po.id); await db.query("update platform_settings set chargeback_fee_cents=500, payout_hold_days=7 where id=1");
    console.log("   chargeback webhook ->", await chargeback(a.tx, null)); await db.query("update platform_settings set chargeback_fee_cents=0 where id=1");
    const r = await check("S3 chargeback-after-payout", s, { "Paid then disputed": [0, 0], "Stays good": [2, 6000] }); console.log("   balance:", JSON.stringify(r.A.balance), "paid out:", r.A.lifetime.paidOutCents); ok(r.A.balance.availableCents < 0, `seller now owes ${usd(-r.A.balance.availableCents)} (negative balance) while per-drop revenue stays ledger-true`); }
  // S4 partial refund then chargeback on the same sale; S5 partial chargeback; S6 over-refund
  console.log("== S4 partial refund then chargeback; S5 partial chargeback; S6 over-refund");
  { const s = await mkSeller("combo"); const d = await mkDrop(s.id, "Combo", 4000); const a = await sale(d.link), c5 = await sale(d.link), c6 = await sale(d.link), c7 = await sale(d.link);
    await refund(a.tx, 1500, "rf4" + a.tx.slice(0, 6)); console.log("   chargeback after partial refund ->", await chargeback(a.tx, null));
    console.log("   partial chargeback $10 ->", await chargeback(c5.tx, 1000));
    console.log("   over-refund $50 of $40 ->", await refund(c6.tx, 5000, "rf6" + c6.tx.slice(0, 6)));
    console.log("   refund $15 + chargeback $30 (more than the $25 remaining) ->", await refund(c7.tx, 1500, "rf7" + c7.tx.slice(0, 6)), await chargeback(c7.tx, 3000));
    const r = await check("S4-S6 combos", s, {}); console.log("   tx rows:", JSON.stringify((await db.query("select status, amount_cents, reversed_cents from transactions where seller_id=$1 order by created_at", [s.id])).rows)); ok(r.T[0].kept >= 0, "revenue never negative"); }
  // S7 pending + declined + price edited after sale
  console.log("== S7 pending/declined checkouts ignored; price edited after the sale");
  { const s = await mkSeller("pend"); const d = await mkDrop(s.id, "Pending mix", 2000); await sale(d.link); const dec = await sale(d.link, "4000000000000002"); await J("/api/checkout", { linkId: d.link, email: `pending${crypto.randomBytes(2).toString("hex")}@example.test`, confirmOver18: true });
    await db.query("update drops set price_cents=9900 where id=$1", [d.id]); console.log("   declined pay status:", dec.status);
    await check("S7 pending-declined-priceedit", s, { "Pending mix": [1, 2000] }); }
  // S8 many sales on one drop, isolation between sellers
  console.log("== S8 two sellers, same-titled drops (isolation)");
  { const s1 = await mkSeller("isoa"), s2 = await mkSeller("isob"); const d1 = await mkDrop(s1.id, "Same title", 1000), d2 = await mkDrop(s2.id, "Same title", 1000); await sale(d1.link); await sale(d2.link); await sale(d2.link); await check("S8 iso A", s1, { "Same title": [1, 1000] }); await check("S8 iso B", s2, { "Same title": [2, 2000] }); }
  console.log(`RESULT fails=${fails}`); await b.close(); await db.end(); (await import("../../src/server/db")).pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
