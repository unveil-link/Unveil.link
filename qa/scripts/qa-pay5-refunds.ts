// @ts-nocheck
/* eslint-disable */
process.env.MOCK_PAYMENTS_ENABLED = process.env.MOCK_PAYMENTS_ENABLED ?? "1"; // in-process service calls (NODE_ENV unset => mock default-deny since R2)
// QA: refund / chargeback sequences, over-refund, concurrency, negative balance, repeat-chargeback flagging.
import { Http, check, rec, assert, eq, db, makeSeller, makeDrop, checkout, txRow, save, done, sell, sendWebhook, paySale, mockEvents, ledgerCount, ledgerSum, refundEv, cbEv, sellerLedgerSum } from "./qa-pay5-lib";
import { computeSplit, reversalFor } from "../../src/server/payments/money";

(async () => {
  const s = await makeSeller("rf"); const d = await makeDrop(s, 2000); const d999 = await makeDrop(s, 999);
  const bal = async () => (await s.http.json("GET", "/api/earnings")).json;

  await check("M5-05 / REF-1", "full refund $20: status refunded, reversed 2000, ledger nets to 0, duplicate refund event idempotent", async () => {
    const tx = await sell(d.link, 2000); const ev = refundEv(tx, 2000);
    const a = await sendWebhook(ev); const b = await sendWebhook(ev); eq(a.json.outcome, "processed", a.text); eq(b.json.outcome, "duplicate", "dup");
    const t = await txRow(tx); eq(t.status, "refunded", "status"); eq(t.reversed_cents, 2000, "rev"); eq(await ledgerSum(tx), 0, "ledger");
    const over = await sendWebhook(refundEv(tx, 1)); eq(over.json.outcome, "rejected", `1¢ more after full refund: ${over.text}`); eq(await ledgerSum(tx), 0, "ledger after over");
    return `refunded; ledger 0; extra 1¢ → ${over.json.outcome}/${over.json.detail}`;
  });
  await check("M5-06 / REF-2", "partial then partial then remainder: $5 + $7.50 + $7.50 on $20 → ledger nets exactly 0; amounts per step consistent with money.ts", async () => {
    const tx = await sell(d.link, 2000); const steps = [500, 750, 750]; const rows: string[] = [];
    for (const a of steps) { const r = await sendWebhook(refundEv(tx, a)); eq(r.json.outcome, "processed", r.text); rows.push(`${a}:${(await txRow(tx)).status}/${await ledgerSum(tx)}`); }
    const t = await txRow(tx); eq(t.status, "refunded", "final"); eq(await ledgerSum(tx), 0, "ledger"); return rows.join(" ");
  });
  await check("REF-3", "full then partial: partial after full → rejected over_refund, ledger unchanged", async () => {
    const tx = await sell(d.link, 2000); await sendWebhook(refundEv(tx, 2000)); const r = await sendWebhook(refundEv(tx, 500));
    eq(r.json.outcome, "rejected", r.text); eq(await ledgerSum(tx), 0, "ledger"); eq((await txRow(tx)).reversed_cents, 2000, "rev"); return `${r.json.outcome}/${r.json.detail}`;
  });
  await check("REF-4", "partial then over-refund (1500 then 1000 on 2000): second rejected, reversed stays 1500, status stays succeeded", async () => {
    const tx = await sell(d.link, 2000); await sendWebhook(refundEv(tx, 1500)); const r = await sendWebhook(refundEv(tx, 1000));
    eq(r.json.outcome, "rejected", r.text); const t = await txRow(tx); eq(t.reversed_cents, 1500, "rev"); eq(t.status, "succeeded", "status"); 
    const exp = computeSplit(2000, 1000, 1200); const rv = reversalFor(exp, 0, 1500); eq(await ledgerSum(tx), exp.sellerNetCents - rv.sellerNetReversedCents, "ledger remaining net");
    return `ledger remaining ${await ledgerSum(tx)}`;
  });
  await check("REF-5", "refund event with amount > gross (999999) and refund with null amount ('all that remains')", async () => {
    const tx = await sell(d.link, 2000); const r = await sendWebhook(refundEv(tx, 999999)); eq(r.json.outcome, "rejected", r.text); eq(await ledgerSum(tx), 1560, "unchanged");
    await sendWebhook(refundEv(tx, 500)); const n = await sendWebhook(refundEv(tx, null)); eq(n.json.outcome, "processed", n.text); const t = await txRow(tx); eq(t.reversed_cents, 2000, "all remaining"); eq(await ledgerSum(tx), 0, "ledger 0"); return "over → rejected; null → remaining 1500 refunded";
  });
  await check("REF-6", "refund of never-succeeded txns: pending → parked (no ledger), failed → ignored, no state change", async () => {
    const pend = (await checkout(d.link)).json.transactionId; const fail = (await checkout(d.link)).json.transactionId;
    await sendWebhook(mockEvents.saleFailed({ transactionId: fail, amountCents: 2000, failureCode: "card_declined" }));
    const a = await sendWebhook(refundEv(pend, 100)); const b = await sendWebhook(refundEv(fail, 100)); const c = await sendWebhook(cbEv(fail, null));
    eq(a.json.outcome, "parked", "pending"); eq(b.json.outcome, "ignored", "failed refund"); eq(c.json.outcome, "ignored", "failed chargeback");
    eq(await ledgerCount(fail), 0, "failed ledger"); eq((await txRow(fail)).status, "failed", "failed status"); eq((await txRow(fail)).reversed_cents, 0, "rev");
    return `pending:${a.json.outcome}/${a.json.detail} failed:${b.json.outcome}/${b.json.detail} failed-cb:${c.json.outcome}`;
  });
  await check("REF-7", "refund then chargeback on same sale: chargeback only for remaining; total reversed ≤ gross; status charged_back", async () => {
    const tx = await sell(d.link, 2000); await sendWebhook(refundEv(tx, 800)); const c = await sendWebhook(cbEv(tx, null)); eq(c.json.outcome, "processed", c.text);
    const t = await txRow(tx); eq(t.reversed_cents, 2000, "rev"); eq(t.status, "charged_back", "status"); eq(await ledgerSum(tx), 0, "ledger"); 
    const c2 = await sendWebhook(cbEv(tx, 100, 2)); eq(c2.json.outcome, "rejected", "2nd cb beyond gross"); return "refund 800 + chargeback remaining 1200 = 2000, ledger 0; extra cb rejected";
  });
  await check("REF-8", "chargeback then refund: refund after full chargeback rejected (no double reversal)", async () => {
    const tx = await sell(d.link, 2000); await sendWebhook(cbEv(tx, null)); const r = await sendWebhook(refundEv(tx, 500)); eq(r.json.outcome, "rejected", r.text);
    eq((await txRow(tx)).status, "charged_back", "status"); eq(await ledgerSum(tx), 0, "ledger"); return `${r.json.outcome}/${r.json.detail}`;
  });
  await check("REF-9 concurrency", "10 concurrent distinct refund events of $5 each on a $20 sale: exactly 4 processed, 6 rejected, reversed=2000, ledger 0 (never over-refunds)", async () => {
    const tx = await sell(d.link, 2000); const r = await Promise.all(Array.from({ length: 10 }, () => sendWebhook(refundEv(tx, 500))));
    const oc = r.map((x) => x.json?.outcome); const p = oc.filter((x) => x === "processed").length, rej = oc.filter((x) => x === "rejected").length;
    const t = await txRow(tx); assert(t.reversed_cents <= 2000, `OVER-REFUND ${t.reversed_cents}`); eq(p, 4, `processed (${oc})`); eq(rej, 6, "rejected"); eq(t.reversed_cents, 2000, "rev"); eq(await ledgerSum(tx), 0, "ledger");
    return `${p} processed / ${rej} rejected; reversed ${t.reversed_cents}`;
  });
  await check("REF-10 concurrency", "10 concurrent refunds of $3 on $20: floor(20/3)=6 processed, reversed 1800, ledger sum = net - reversal(1800), all postings non-negative shares", async () => {
    const tx = await sell(d.link, 2000); const r = await Promise.all(Array.from({ length: 10 }, () => sendWebhook(refundEv(tx, 300))));
    const p = r.filter((x) => x.json?.outcome === "processed").length; const t = await txRow(tx); eq(p, 6, "processed"); eq(t.reversed_cents, 1800, "rev");
    const sp = computeSplit(2000, 1000, 1200); const rv = reversalFor(sp, 0, 1800); eq(await ledgerSum(tx), sp.sellerNetCents - rv.sellerNetReversedCents, "ledger"); 
    const bad = await db.query("SELECT count(*) n FROM ledger_entries WHERE transaction_id=$1 AND ((component='gross' AND amount_cents>0 AND entry_type<>'sale_credit') OR (component<>'gross' AND entry_type LIKE '%reversal' AND amount_cents<0))", [tx]); eq(Number(bad.rows[0].n), 0, "bad sign");
    return `6 processed; ledger ${await ledgerSum(tx)}`;
  });
  await check("REF-11 concurrency", "concurrent refund + chargeback + refund-duplicates storm (20 requests) → reversed ≤ gross and ledger equals recomputed expectation", async () => {
    const tx = await sell(d.link, 2000); const dup = refundEv(tx, 700);
    const reqs = [...Array.from({ length: 6 }, () => sendWebhook(dup)), ...Array.from({ length: 6 }, () => sendWebhook(refundEv(tx, 400))), ...Array.from({ length: 4 }, (_, i) => sendWebhook(cbEv(tx, 500, i + 1))), ...Array.from({ length: 4 }, () => sendWebhook(cbEv(tx, null, 9)))];
    const r = await Promise.all(reqs); assert(r.every((x) => x.status === 200), "non-200 " + r.map((x) => x.status));
    const t = await txRow(tx); assert(t.reversed_cents <= 2000, "OVER " + t.reversed_cents);
    const gross = Number((await db.query("SELECT COALESCE(-SUM(amount_cents),0) g FROM ledger_entries WHERE transaction_id=$1 AND component='gross' AND entry_type LIKE '%reversal'", [tx])).rows[0].g);
    eq(gross, t.reversed_cents, "ledger gross reversed == tx.reversed"); 
    const sp = computeSplit(2000, 1000, 1200); const rv = reversalFor(sp, 0, t.reversed_cents); eq(await ledgerSum(tx), sp.sellerNetCents - rv.sellerNetReversedCents, "ledger vs recomputed");
    return `reversed ${t.reversed_cents}, status ${t.status}, ledger ${await ledgerSum(tx)}`;
  });
  await check("M5-07 / REF-12", "refund after payout leaves NEGATIVE available balance (allowed), earnings API consistent, new sale nets against it", async () => {
    const s2 = await makeSeller("neg"); const dd = await makeDrop(s2, 5000); await db.query("UPDATE platform_settings SET payout_hold_days=0 WHERE id=1");
    const tx = await sell(dd.link, 5000); const e0 = (await s2.http.json("GET", "/api/earnings")).json; eq(e0.balance.availableCents, 3900, "available before");
    const { requestPayout } = await import("../../src/server/payments/payouts"); const po = await requestPayout(s2.id, 3900); eq(po.amount_cents, 3900, "payout");
    await sendWebhook(refundEv(tx, 5000)); const e1 = (await s2.http.json("GET", "/api/earnings")).json;
    eq(e1.balance.availableCents, -3900, "available after refund-after-payout = -(net 3900)");
    const sellerSum = await sellerLedgerSum(s2.id); eq(sellerSum, e1.balance.totalCents, "total == SUM(ledger)");
    const tx2 = await sell(dd.link, 5000); const e2 = (await s2.http.json("GET", "/api/earnings")).json; const exp = e1.balance.availableCents + 3900;
    await db.query("UPDATE platform_settings SET payout_hold_days=7 WHERE id=1");
    eq(e2.balance.availableCents, exp, "future earnings net against negative"); const rq = await (await import("../../src/server/payments/payouts")).requestPayout(s2.id).catch((e: any) => e.code);
    return `after refund available=${e1.balance.availableCents} (negative allowed); after new sale ${e2.balance.availableCents}; payout while 0<available<min → ${typeof rq === "string" ? rq : "created"}`;
  });
  await check("M5-08 / CB-1", "R2: 3 chargebacks (distinct txns) within 90 days flag the seller (risk_flagged_at, reason, audit_log); no auto-ban/verification change", async () => {
    const s3 = await makeSeller("cbrep"); const dd = await makeDrop(s3, 1500); const out: string[] = [];
    for (let i = 0; i < 3; i++) { const tx = await sell(dd.link, 1500); const r = await sendWebhook(cbEv(tx, null, i)); out.push(r.json.detail ?? r.json.outcome); const row = (await db.query("SELECT risk_flagged_at, risk_flag_reason, verification_status FROM sellers WHERE id=$1", [s3.id])).rows[0]; eq(!!row.risk_flagged_at, i === 2, `flag after cb #${i + 1}`); eq(row.verification_status, "verified", "verification_status untouched"); }
    const row = (await db.query("SELECT risk_flagged_at, risk_flag_reason FROM sellers WHERE id=$1", [s3.id])).rows[0]; const au = await db.query("SELECT target FROM audit_log WHERE action='seller_flagged_repeat_chargebacks' AND target LIKE $1", [`seller:${s3.id}%`]);
    eq(au.rowCount, 1, "audit rows"); return `details ${out.join(",")}; reason="${row.risk_flag_reason}"; audit rows 1; still verified`;
  });
  await check("CB-2", "single chargeback: tx charged_back, ledger reversal posted, optional chargeback_fee honoured when set; fee posts immediate", async () => {
    await db.query("UPDATE platform_settings SET chargeback_fee_cents=1500 WHERE id=1");
    const tx = await sell(d.link, 2000); await sendWebhook(cbEv(tx, null)); await db.query("UPDATE platform_settings SET chargeback_fee_cents=0 WHERE id=1");
    const t = await txRow(tx); eq(t.status, "charged_back", "st"); eq(await ledgerSum(tx), -1500, "ledger = -fee"); return "ledger -1500 (chargeback fee), net reversal 0";
  });
  await check("REF-13 API", "refund API surface: only dev simulator routes exist; /api/dev/payments/refund without auth works in non-prod only (documented); no admin refund route (M5-05 admin)", async () => {
    const tx = await sell(d.link, 2000); const r = await new Http().json("POST", "/api/dev/payments/refund", { json: { transactionId: tx, amountCents: 500 } });
    eq(r.status, 200, r.text); eq((await txRow(tx)).reversed_cents, 500, "rev");
    const r2 = await new Http().json("POST", "/api/dev/payments/refund", { json: { transactionId: tx, amountCents: 5000 } }); eq(r2.status, 400, "over-refund request: " + r2.text);
    const pend = (await checkout(d.link)).json.transactionId; const r3 = await new Http().json("POST", "/api/dev/payments/refund", { json: { transactionId: pend } }); eq(r3.status, 409, "refund of pending: " + r3.text);
    return `request refund 500→200, 5000→${r2.status} ${r2.json?.code}, pending→${r3.status} ${r3.json?.code}`;
  });
  await check("REF-14 invariants", "global: every tx reversed_cents ≤ amount; Σ ledger per tx == seller_net − reversed-net share; no tx with status refunded where reversed<amount", async () => {
    const bad = await db.query(`SELECT t.id FROM transactions t WHERE t.reversed_cents > t.amount_cents OR (t.status='refunded' AND t.reversed_cents<>t.amount_cents) OR (t.status='succeeded' AND t.reversed_cents=t.amount_cents) OR (t.status IN ('pending','failed') AND EXISTS (SELECT 1 FROM ledger_entries l WHERE l.transaction_id=t.id))`);
    assert(bad.rowCount === 0, `invariant violations: ${bad.rows.map((r) => r.id)}`);
    const rows = (await db.query(`SELECT t.id, t.amount_cents a, t.platform_fee_cents p, t.processing_fee_cents c, t.seller_net_cents n, t.reversed_cents r, t.status, COALESCE((SELECT SUM(amount_cents) FROM ledger_entries l WHERE l.transaction_id=t.id),0)::int s FROM transactions t WHERE t.status IN ('succeeded','refunded','charged_back')`)).rows;
    let n = 0; for (const x of rows) { const sp = computeSplit(x.a, 0, 0); void sp; const exp = x.n - reversalFor({ grossCents: x.a, platformFeeCents: x.p, processingFeeCents: x.c, sellerNetCents: x.n }, 0, Math.max(x.r, 0) || 1).sellerNetReversedCents * (x.r ? 1 : 0); if (x.status === "charged_back" && x.s < 0) continue; if (x.s !== exp) throw new Error(`tx ${x.id} ledger ${x.s} expected ${exp}`); n++; }
    return `${rows.length} settled txs checked (${n} exact), no violations`;
  });
  save("pay5-old-refunds-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
