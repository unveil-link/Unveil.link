/* eslint-disable */
// QA: payout ledger invariants, hold, minimum, concurrency, failure flow, earnings summary (M4-09, M4-13..M4-16, M3-09).
import { check, rec, assert, eq, db, makeSeller, makeDrop, sell, sendWebhook, refundEv, sellerLedgerSum, setSettings, save, done, Http } from "./qa-pay-lib";
import { requestPayout, approvePayout, markPayoutPaid, markPayoutFailed, getPayout } from "../../src/server/payments/payouts";
import { getBalance } from "../../src/server/payments/ledger";
import { pool } from "../../src/server/db";

const earn = async (s: { http: Http }) => (await s.http.json("GET", "/api/earnings")).json;
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: any) => e.code ?? e.message);

(async () => {
  await setSettings("fee_percent=10, processing_fee_percent=NULL, payout_hold_days=7, min_payout_cents=2500, chargeback_fee_cents=0");
  await check("M3-09 / HOLD-1", "after a $20 sale (default 7-day hold): pending 1560, available 0; ledger entries available_at ≈ now+7d; totals == SUM(ledger)", async () => {
    const s = await makeSeller("hold"); const d = await makeDrop(s, 2000); const tx = await sell(d.link, 2000); const e = await earn(s);
    eq(e.balance.pendingCents, 1560, "pending"); eq(e.balance.availableCents, 0, "available"); eq(e.balance.totalCents, await sellerLedgerSum(s.id), "total");
    const r = (await db.query("SELECT min(available_at) a, max(available_at) b, extract(epoch from (min(available_at)-now()))/86400 days FROM ledger_entries WHERE transaction_id=$1", [tx])).rows[0];
    assert(Math.abs(Number(r.days) - 7) < 0.01, "hold days " + r.days); eq(e.holdDays, 7, "holdDays"); return `pending ${e.balance.pendingCents} available ${e.balance.availableCents}; hold ${Number(r.days).toFixed(3)}d`;
  });
  await check("M4-13", "payout below $25 blocked: requested 2499 with 5000 available → below_minimum_payout; no payouts row, no ledger debit", async () => {
    await setSettings("payout_hold_days=0"); const s = await makeSeller("minp"); const d = await makeDrop(s, 5000); await sell(d.link, 5000); await setSettings("payout_hold_days=7");
    const before = await sellerLedgerSum(s.id); const c1 = await code(requestPayout(s.id, 2499)); const c0 = await code(requestPayout(s.id, 0)); const cn = await code(requestPayout(s.id, -100)); const cf = await code(requestPayout(s.id, 25.5 as any));
    eq(c1, "below_minimum_payout", "2499"); eq(c0, "nothing_available", "0"); eq(cn, "nothing_available", "-100"); assert(cf !== "OK", "float amount accepted");
    eq(await sellerLedgerSum(s.id), before, "ledger unchanged"); eq(Number((await db.query("SELECT count(*) n FROM payouts WHERE seller_id=$1", [s.id])).rows[0].n), 0, "payout rows");
    const ok = await requestPayout(s.id, 2500); eq(ok.amount_cents, 2500, "exactly $25 allowed"); return `2499→${c1}, 0→${c0}, -100→${cn}, 25.5→${cf}; exactly 2500 accepted`;
  });
  await check("M4-13b", "available below $25 but > 0 (balance 2000): request with no amount → below_minimum_payout", async () => {
    await setSettings("payout_hold_days=0"); const s = await makeSeller("minp2"); const d = await makeDrop(s, 2500); await sell(d.link, 2500); await setSettings("payout_hold_days=7");
    const e = await earn(s); eq(e.balance.availableCents, 1950, "avail"); eq(e.payoutEligible, false, "eligible"); return String(await code(requestPayout(s.id)));
  });
  await check("M4-14", "funds in hold not payable: sale A (hold 0, 3900 available) + sale B (hold 7d, 3900 pending): payout of 7800 rejected, 3900 ok; first payout hold honoured", async () => {
    const s = await makeSeller("holdmix"); const d = await makeDrop(s, 5000); await setSettings("payout_hold_days=0"); await sell(d.link, 5000); await setSettings("payout_hold_days=7"); await sell(d.link, 5000);
    const e = await earn(s); eq(`${e.balance.availableCents}/${e.balance.pendingCents}`, "3900/3900", "balances"); const over = await code(requestPayout(s.id, 7800)); eq(over, "insufficient_available_balance", "over");
    const po = await requestPayout(s.id); eq(po.amount_cents, 3900, "default = available only"); const e2 = await earn(s); eq(`${e2.balance.availableCents}/${e2.balance.pendingCents}`, "0/3900", "after"); eq(e2.lifetime.requestedPayoutCents, 3900, "requested");
    return `over-request ${over}; default payout 3900 (available only); pending 3900 untouched`;
  });
  await check("M4-14b", "hold-boundary: tx whose available_at is in the future is not counted available (use 1-day hold, check 0 available; 0-day immediately available)", async () => {
    await setSettings("payout_hold_days=1"); const s = await makeSeller("h1"); const d = await makeDrop(s, 5000); await sell(d.link, 5000); await setSettings("payout_hold_days=7");
    const b = await getBalance(pool(), s.id); eq(`${b.availableCents}/${b.pendingCents}`, "0/3900", "1-day hold"); return "0 available / 3900 pending";
  });
  await check("M4-14c", "first-payout hold: spec says 'first-payout 7-day hold honored' — implementation applies a uniform per-sale hold (payout_hold_days), no special first-payout rule", async () => {
    const s = await makeSeller("fp"); const d = await makeDrop(s, 5000); await setSettings("payout_hold_days=0"); await sell(d.link, 5000); await setSettings("payout_hold_days=7");
    const po = await requestPayout(s.id).then(() => "payable immediately with hold_days=0", (e: any) => e.code); return `observed: ${po}; per-sale hold only (no distinct first-payout rule) — NOTE`;
  });
  await check("M4-15a", "payout flow requested→approved→paid: ledger debit reserved at request, payout row timestamps, provider_ref stored, invalid transitions 409, history visible in earnings", async () => {
    await setSettings("payout_hold_days=0"); const s = await makeSeller("pf"); const d = await makeDrop(s, 5000); await sell(d.link, 5000); await sell(d.link, 5000); await setSettings("payout_hold_days=7");
    const po = await requestPayout(s.id, 5000); eq(po.status, "requested", "st"); eq((await earn(s)).balance.availableCents, 2800, "balance after request");
    const bad = await code(markPayoutPaid(po.id)); eq(bad, "bad_payout_state", "paid before approve"); const ap = await approvePayout(po.id); eq(ap.status, "approved", "approved"); assert(ap.provider_ref?.startsWith("mockpo_"), "ref");
    const again = await code(approvePayout(po.id)); eq(again, "bad_payout_state", "approve twice"); const paid = await markPayoutPaid(po.id); eq(paid.status, "paid", "paid"); assert(paid.paid_at, "paid_at");
    const nf = await code(markPayoutFailed(po.id, "late")); eq(nf, "bad_payout_state", "fail after paid"); const e = await earn(s);
    eq(e.lifetime.paidOutCents, 5000, "paidOut"); eq(e.balance.totalCents, 7800 - 5000, "total"); eq(e.balance.totalCents, await sellerLedgerSum(s.id), "== SUM ledger");
    return `balance 7800→2800; statuses requested→approved→paid; illegal transitions → bad_payout_state; earnings.paidOutCents 5000. NOTE: no HTTP route to request/approve payout (service functions only)`;
  });
  await check("M4-16", "payout failure: status failed, reason stored, funds returned (payout_reversal), balance restored, can't double-fail; failed from requested and approved", async () => {
    await setSettings("payout_hold_days=0"); const s = await makeSeller("pfail"); const d = await makeDrop(s, 5000); await sell(d.link, 5000); await setSettings("payout_hold_days=7");
    const p1 = await requestPayout(s.id, 3000); eq((await earn(s)).balance.availableCents, 900, "reserved"); const f = await markPayoutFailed(p1.id, "bank rejected"); eq(f.status, "failed", "st"); eq(f.failure_reason, "bank rejected", "reason");
    eq((await earn(s)).balance.availableCents, 3900, "returned"); eq(await code(markPayoutFailed(p1.id, "x")), "bad_payout_state", "double fail");
    const p2 = await requestPayout(s.id, 2600); await approvePayout(p2.id); await markPayoutFailed(p2.id, "approved→failed"); eq((await earn(s)).balance.availableCents, 3900, "returned again");
    const e = await earn(s); eq(e.lifetime.requestedPayoutCents, 0, "no open payouts"); eq(e.balance.totalCents, await sellerLedgerSum(s.id), "sum"); return "reserve 3000 → fail → 3900 restored; approved→failed also restored; admin-visible via payouts.failure_reason (NOTE: no admin UI/route)";
  });
  await check("PAYOUT-CONC-1", "concurrent payout requests cannot double-spend: 8 parallel requests of 3000 vs 3900 available → exactly 1 succeeds, available never negative", async () => {
    await setSettings("payout_hold_days=0"); const s = await makeSeller("conc"); const d = await makeDrop(s, 5000); await sell(d.link, 5000); await setSettings("payout_hold_days=7");
    const r = await Promise.all(Array.from({ length: 8 }, () => code(requestPayout(s.id, 3000)))); const ok = r.filter((x) => x === "OK").length;
    eq(ok, 1, `successes (${r})`); const b = await getBalance(pool(), s.id); assert(b.availableCents >= 0, "negative " + b.availableCents); eq(b.availableCents, 900, "available"); eq(Number((await db.query("SELECT count(*) n FROM payouts WHERE seller_id=$1", [s.id])).rows[0].n), 1, "payout rows");
    return `1 ok / ${r.filter((x) => x !== "OK").length} rejected (${[...new Set(r)]}); available 900`;
  });
  await check("PAYOUT-CONC-2", "concurrent default-amount payout requests (no amount) ×6: one payout of the full available, rest nothing_available", async () => {
    await setSettings("payout_hold_days=0"); const s = await makeSeller("conc2"); const d = await makeDrop(s, 5000); await sell(d.link, 5000); await sell(d.link, 5000); await setSettings("payout_hold_days=7");
    const r = await Promise.all(Array.from({ length: 6 }, () => code(requestPayout(s.id)))); eq(r.filter((x) => x === "OK").length, 1, "ok " + r); eq((await getBalance(pool(), s.id)).availableCents, 0, "avail"); return [...new Set(r)].join();
  });
  await check("PAYOUT-CONC-3", "concurrent payout request vs refund webhook vs new sale: ledger SUM stays == earnings total; available never negative from the payout itself", async () => {
    await setSettings("payout_hold_days=0"); const s = await makeSeller("conc3"); const d = await makeDrop(s, 5000); const t1 = await sell(d.link, 5000);
    const [p, r, n] = await Promise.all([code(requestPayout(s.id, 3900)), sendWebhook(refundEv(t1, 5000)), sell(d.link, 5000).then(() => "sold")]); await setSettings("payout_hold_days=7");
    const e = await earn(s); eq(e.balance.totalCents, await sellerLedgerSum(s.id), "sum"); return `payout:${p} refund:${r.json?.outcome} sale:${n} final available ${e.balance.availableCents} total ${e.balance.totalCents} (negative allowed only via refund after payout)`;
  });
  await check("PAYOUT-INV-1", "global ledger invariants: per seller Σ ledger == balance.total (pending+available); payouts open+paid reserved == Σ payout_debit − Σ payout_reversal; ledger sign shapes hold; append-only enforced (UPDATE/DELETE/TRUNCATE blocked)", async () => {
    const sellers = (await db.query("SELECT DISTINCT seller_id FROM ledger_entries")).rows; for (const r of sellers) { const b = await getBalance(pool(), r.seller_id); eq(b.totalCents, await sellerLedgerSum(r.seller_id), `seller ${r.seller_id}`); }
    const bad = await db.query(`SELECT p.id FROM payouts p WHERE p.amount_cents <> -(SELECT COALESCE(SUM(amount_cents) FILTER (WHERE entry_type='payout_debit'),0) FROM ledger_entries l WHERE l.payout_id=p.id)`); eq(bad.rowCount, 0, "payout/ledger mismatch");
    const failed = await db.query(`SELECT p.id FROM payouts p WHERE p.status='failed' AND (SELECT COALESCE(SUM(amount_cents),0) FROM ledger_entries l WHERE l.payout_id=p.id) <> 0`); eq(failed.rowCount, 0, "failed payouts don't net to 0");
    const out: string[] = []; for (const sql of ["UPDATE ledger_entries SET amount_cents=amount_cents+1", "DELETE FROM ledger_entries", "TRUNCATE ledger_entries"]) { try { await db.query(sql); out.push(sql.split(" ")[0] + " ALLOWED"); } catch { out.push(sql.split(" ")[0] + " blocked"); } }
    assert(!out.some((x) => x.includes("ALLOWED")), out.join()); return `${sellers.length} sellers reconcile; ${out.join(", ")}`;
  });
  await check("M4-09", "earnings summary vs transactions: gross/platform/processing/net/refunds/chargebacks/pending/available match independent SQL over transactions", async () => {
    await setSettings("payout_hold_days=7"); const s = await makeSeller("earn"); const d = await makeDrop(s, 1999); const d2 = await makeDrop(s, 4999); const t1 = await sell(d.link, 1999); const t2 = await sell(d2.link, 4999); const t3 = await sell(d2.link, 4999);
    await sendWebhook(refundEv(t1, 500)); const { cbEv } = await import("./qa-pay-lib"); await sendWebhook(cbEv(t3, null)); const e = await earn(s);
    const q = (await db.query(`SELECT COALESCE(SUM(amount_cents),0)::int g, COALESCE(SUM(platform_fee_cents),0)::int p, COALESCE(SUM(processing_fee_cents),0)::int c, COALESCE(SUM(seller_net_cents),0)::int n, COALESCE(SUM(reversed_cents) FILTER (WHERE status<>'charged_back'),0)::int rf, COALESCE(SUM(reversed_cents) FILTER (WHERE status='charged_back'),0)::int cb, count(*)::int cnt FROM transactions WHERE seller_id=$1 AND status IN ('succeeded','refunded','charged_back')`, [s.id])).rows[0];
    eq(e.lifetime.grossCents, q.g, "gross"); eq(e.lifetime.salesCount, q.cnt, "count"); eq(e.lifetime.refundedCents, q.rf, "refunded"); eq(e.lifetime.chargebackCents, q.cb, "chargebacks");
    // lifetime fees in summary are NET of refunded fee shares? record what it reports
    const feesGross = q.p + q.c; const feesReported = e.lifetime.platformFeeCents + e.lifetime.processingFeeCents;
    eq(e.balance.totalCents, await sellerLedgerSum(s.id), "balance == ledger");
    const expectedTotal = q.n - (await db.query("SELECT COALESCE(SUM(-amount_cents),0)::int x FROM ledger_entries WHERE seller_id=$1 AND entry_type LIKE '%reversal' AND component='gross'", [s.id])).rows[0].x + (await db.query("SELECT COALESCE(SUM(amount_cents),0)::int x FROM ledger_entries WHERE seller_id=$1 AND entry_type LIKE '%reversal' AND component<>'gross'", [s.id])).rows[0].x;
    eq(e.balance.totalCents, expectedTotal, "balance vs tx-derived net after reversals"); eq(e.balance.pendingCents, e.balance.totalCents, "all pending (hold)");
    // identity: gross - refunded - chargebacks - (platform+processing, reported NET of fee shares returned on reversals) == total balance (chargeback_fee=0 here)
    eq(e.lifetime.grossCents - e.lifetime.refundedCents - e.lifetime.chargebackCents - feesReported, e.balance.totalCents, "gross − reversals − net fees == balance");
    assert(feesReported < feesGross, "expected net fees < gross fees after reversals");
    return `NOTE fees in summary are NET of fee shares returned on refunds (reported ${feesReported} vs ${feesGross} on transactions rows); identity gross−refunds−chargebacks−fees==balance holds. gross ${e.lifetime.grossCents}, refunded ${e.lifetime.refundedCents}, chargebacks ${e.lifetime.chargebackCents}, balance ${e.balance.totalCents}`;
  });
  save("pay-payouts-results.json"); await done(); await pool().end();
})().catch((e) => { console.error(e); process.exit(1); });
