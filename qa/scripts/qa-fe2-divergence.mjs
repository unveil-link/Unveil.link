// FE-01 divergence check: builds a seller on a DB migrated with payments/abstraction migrations 005-007 (ledger, partial refunds,
// pending/failed tx, requested/approved payouts) and compares (a) payments' lifetime/balance SQL (copied from earnings.ts/ledger.ts)
// with (b) what the Frontend dashboard (data.ts) shows. env BASE (app on that DB), DB (that DB)
import pg from "pg"; import crypto from "node:crypto"; import { chromium } from "playwright-core";
const BASE = process.env.BASE; const db = new pg.Client({ connectionString: process.env.DB }); await db.connect(); const log = (...a) => console.log(...a);
const usd = (c) => (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const email = `div-${crypto.randomBytes(3).toString("hex")}@example.com`, pw = "Sunrise-Harbor-4821";
const r = await fetch(BASE + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email, password: pw, displayName: "Divergence Tester" }) }); log("signup", r.status);
const sid = (await db.query("select id from sellers where email=$1", [email])).rows[0].id;
await db.query("update sellers set verification_status='verified' where id=$1", [sid]);
const drop = (await db.query("insert into drops(seller_id,public_link_id,title,price_cents,status) values($1,$2,'Div drop',2000,'published') returning id", [sid, crypto.randomBytes(9).toString("base64url")])).rows[0].id;
async function tx({ amt, plat, proc, status, reversed = 0, ledger = true, future = false, refund = null, chargeback = null, cbFee = 0 }) {
  const net = amt - plat - proc;
  const id = (await db.query("insert into transactions(drop_id,seller_id,buyer_email,amount_cents,platform_fee_cents,processing_fee_cents,seller_net_cents,status,provider,reversed_cents) values($1,$2,$3,$4,$5,$6,$7,$8,'test',$9) returning id", [drop, sid, "buyer@example.test", amt, plat, proc, net, status, reversed])).rows[0].id;
  if (!ledger) return id;
  const at = future ? "now() + interval '7 days'" : "now() - interval '1 day'"; const post = crypto.randomUUID();
  const ins = (type, comp, a, p = post, when = at) => db.query(`insert into ledger_entries(posting_id,seller_id,transaction_id,entry_type,component,amount_cents,available_at) values($1,$2,$3,$4,$5,$6,${when})`, [p, sid, id, type, comp, a]);
  await ins("sale_credit", "gross", amt); await ins("platform_fee", "platform_fee", -plat); await ins("processing_fee", "processing_fee", -proc);
  for (const [kind, g] of [["refund", refund], ["chargeback", chargeback]]) if (g) { const p2 = crypto.randomUUID(), f = g / amt; const t = kind + "_reversal"; await ins(t, "gross", -g, p2); await ins(t, "platform_fee", Math.round(plat * f), p2); await ins(t, "processing_fee", Math.round(proc * f), p2); }
  if (cbFee) await ins("chargeback_fee", "chargeback_fee", -cbFee, crypto.randomUUID(), "now()");
  return id;
}
await tx({ amt: 2000, plat: 200, proc: 88, status: "succeeded" });
await tx({ amt: 2000, plat: 200, proc: 88, status: "succeeded" });
await tx({ amt: 10000, plat: 1000, proc: 320, status: "succeeded", reversed: 4000, refund: 4000 }); // PARTIAL refund $40 of $100
await tx({ amt: 5000, plat: 500, proc: 175, status: "refunded", reversed: 5000, refund: 5000 });
await tx({ amt: 2500, plat: 250, proc: 103, status: "charged_back", reversed: 2500, chargeback: 2500, cbFee: 1500 });
await tx({ amt: 3000, plat: 300, proc: 117, status: "pending", ledger: false });
await tx({ amt: 3000, plat: 300, proc: 117, status: "failed", ledger: false });
await tx({ amt: 1000, plat: 100, proc: 59, status: "succeeded", future: true }); // inside 7-day hold
const po = async (amt, status) => { const id = (await db.query("insert into payouts(seller_id,amount_cents,status,provider_ref) values($1,$2,$3,$4) returning id", [sid, amt, status, "p" + crypto.randomBytes(4).toString("hex")])).rows[0].id; if (status !== "failed") await db.query("insert into ledger_entries(posting_id,seller_id,payout_id,entry_type,component,amount_cents,available_at) values($1,$2,$3,'payout_debit','payout',$4,now())", [crypto.randomUUID(), sid, id, -amt]); };
await po(1000, "paid"); await po(3000, "requested"); await po(2000, "approved"); await po(500, "failed");
// --- payments' numbers (SQL copied from payments/abstraction earnings.ts + ledger.ts getBalance)
const l = (await db.query(`SELECT COALESCE(SUM(amount_cents) FILTER (WHERE entry_type='sale_credit'),0) gross, COALESCE(-SUM(amount_cents) FILTER (WHERE component='platform_fee'),0) platform, COALESCE(-SUM(amount_cents) FILTER (WHERE component='processing_fee'),0) processing, COALESCE(-SUM(amount_cents) FILTER (WHERE entry_type='refund_reversal' AND component='gross'),0) refunded, COALESCE(-SUM(amount_cents) FILTER (WHERE entry_type='chargeback_reversal' AND component='gross'),0) chargebacks, COUNT(*) FILTER (WHERE entry_type='sale_credit') sales, COALESCE(SUM(amount_cents) FILTER (WHERE available_at > clock_timestamp()),0) pending, COALESCE(SUM(amount_cents) FILTER (WHERE available_at <= clock_timestamp()),0) available FROM ledger_entries WHERE seller_id=$1`, [sid])).rows[0];
const p = (await db.query(`SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='paid'),0) paid, COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('requested','approved')),0) open FROM payouts WHERE seller_id=$1`, [sid])).rows[0];
const pay = { gross: +l.gross, platform: +l.platform, processing: +l.processing, refunded: +l.refunded, chargebacks: +l.chargebacks, sales: +l.sales, paid: +p.paid, open: +p.open, balAvailable: +l.available, balPending: +l.pending };
log("PAYMENTS (ledger) :", JSON.stringify(Object.fromEntries(Object.entries(pay).map(([k, v]) => [k, k === "sales" ? v : usd(v)]))));
// --- Frontend UI
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] }); const pg_ = await (await b.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
await pg_.goto(BASE + "/login"); await pg_.fill('input[name="email"]', email); await pg_.fill('input[name="password"]', pw); await Promise.all([pg_.waitForURL("**/dashboard**"), pg_.locator("form button[type=submit]").click()]); await pg_.waitForTimeout(600);
const main = (await pg_.locator("main").innerText()).replace(/\n+/g, " | "); log("FRONTEND main text:", main.slice(0, 900));
await pg_.screenshot({ path: "qa/artifacts/frontend-dashboard-r2/dashboard-divergence-payments-schema.png", fullPage: true });
const card = (label) => { const m = main.match(new RegExp(label + " \\| ([-\\$,\\d.]+)")); return m && m[1]; };
const ui = { gross: card("Gross sales"), platform: card("Platform fee"), processing: card("Processing fees"), net: card("Your earnings \\(net\\)"), available: card("Available"), pendingPayouts: card("Pending payouts"), paidOut: card("Paid out") };
log("FRONTEND cards:", JSON.stringify(ui));
const payNet = pay.gross - pay.refunded - pay.chargebacks - pay.platform - pay.processing;
log(`EXPECTED by payments rules: gross ${usd(pay.gross)}, platform ${usd(pay.platform)}, processing ${usd(pay.processing)}, refunded ${usd(pay.refunded)}, charged back ${usd(pay.chargebacks)}, net(lifetime, before payouts/chargeback fee) ${usd(payNet)}, available(ledger, incl. chargeback fee & open payouts) ${usd(pay.balAvailable)}, pending(hold) ${usd(pay.balPending)}, open payouts ${usd(pay.open)}, paid ${usd(pay.paid)}`);
const feGross = (await db.query("select COALESCE(SUM(amount_cents),0) g from transactions where seller_id=$1", [sid])).rows[0].g;
log(`DIVERGENCE gross: FE SUM(amount_cents) over ALL statuses = ${usd(+feGross)} vs payments ledger gross ${usd(pay.gross)}`);
await b.close(); await db.end();
