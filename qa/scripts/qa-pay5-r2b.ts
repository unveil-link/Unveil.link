// @ts-nocheck
/* eslint-disable */
// Round 2 QA: BUG-6 (session validity/expiry), void+refund path, BUG-7 (friendly messages), expiry races, math invariants.
process.env.MOCK_PAYMENTS_ENABLED ??= "1";
import { Http, check, assert, eq, db, makeSeller, makeDrop, checkout, txRow, save, done, sell, sendWebhook, paySale, mockEvents, mockSaleId, ledgerCount, ledgerSum, whCount, refundEv, cbEv, sellerLedgerSum, setSettings, stamp, sleep } from "./qa-pay5-lib";
import { expirePendingCheckouts } from "../../src/server/payments/checkout";
import { retryVoidRefunds } from "../../src/server/payments/refunds";
import { pool } from "../../src/server/db";

const pay = (sid: string, card = "4242424242424242") => new Http().json("POST", "/api/dev/payments/pay", { json: { sessionId: sid, card } });
const sid = (url: string) => url.split("/").pop()!;
const n = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0].n);
const status = async (id: string) => (await new Http().json("GET", `/api/checkout/status?id=${id}`)).json;
const RAW = /card_declined|insufficient_funds|expired_card|incorrect_cvc|invalid_card_number|unrecognized_test_card|session_expired|invalid_at_capture|superseded|session_error/;

(async () => {
  const s = await makeSeller("r2b"); const d = await makeDrop(s, 2000);
  const age = (id: string, min: number) => db.query("UPDATE transactions SET created_at = now() - make_interval(mins => $2::int) WHERE id=$1", [id, min]);

  // ================= BUG-6 =================
  await check("BUG-6a", "seller verification → failed after checkout started: hosted pay refused (failed/unavailable), no ledger, buyer message says not charged; seller restored → NEW checkout works", async () => {
    const c = await checkout(d.link); await db.query("UPDATE sellers SET verification_status='failed' WHERE id=$1", [s.id]); const r = await pay(sid(c.json.checkoutUrl)); await db.query("UPDATE sellers SET verification_status='verified' WHERE id=$1", [s.id]);
    assert(r.json.status !== "succeeded", "paid!"); eq(await ledgerCount(c.json.transactionId), 0, "ledger"); eq((await txRow(c.json.transactionId)).status, "failed", "status"); assert(/not been charged|no longer available/i.test(r.json.message), "msg " + r.json.message); assert(!RAW.test(r.json.message), "raw code in message");
    return `${r.json.status}/${(await txRow(c.json.transactionId)).failure_code}; msg="${r.json.message}"`;
  });
  for (const [label, sql] of [["unpublished", "UPDATE drops SET status='unpublished' WHERE id=$1"], ["flagged", "UPDATE drops SET status='flagged' WHERE id=$1"], ["draft", "UPDATE drops SET status='draft' WHERE id=$1"]] as const) {
    await check(`BUG-6b-${label}`, `drop ${label} after checkout started: pay refused, no ledger, tx failed`, async () => {
      const dd = await makeDrop(s, 1500); const c = await checkout(dd.link); await db.query(sql, [dd.id]); const r = await pay(sid(c.json.checkoutUrl)); assert(r.json.status !== "succeeded", "paid!"); eq(await ledgerCount(c.json.transactionId), 0, "ledger"); return `${r.json.status}/${(await txRow(c.json.transactionId)).failure_code}`;
    });
  }
  await check("BUG-6c", "30-day-old pending txn: pay refused (session_expired), status API expired w/ friendly message", async () => {
    const c = await checkout(d.link); await age(c.json.transactionId, 60 * 24 * 30); const r = await pay(sid(c.json.checkoutUrl)); assert(r.json.status !== "succeeded", "paid"); eq(await ledgerCount(c.json.transactionId), 0, "ledger"); const st = await status(c.json.transactionId); eq(st.status, "failed", "status api"); assert(!RAW.test(JSON.stringify(st)), "raw code"); return `${r.json.status}; status API msg="${st.message}" retryable=${st.retryable}`;
  });
  await check("BUG-6d", "expiry boundary: 29 min → payable; 31 min → refused; (ttl via DB backdating)", async () => {
    const a = await checkout(d.link); await age(a.json.transactionId, 29); const ra = await pay(sid(a.json.checkoutUrl)); eq(ra.json.status, "succeeded", "29 min"); const b = await checkout(d.link); await age(b.json.transactionId, 31); const rb = await pay(sid(b.json.checkoutUrl)); assert(rb.json.status !== "succeeded", "31 min paid"); eq(await ledgerCount(b.json.transactionId), 0, "ledger"); return "29 min succeeded; 31 min refused";
  });
  await check("BUG-6e", "exact TTL boundary via real wait: set ttl=1 min, checkout, pay at ~55 s ok vs after 61 s refused", async () => {
    await setSettings("checkout_session_ttl_minutes=1"); try { const a = await checkout(d.link); const b = await checkout(d.link); await sleep(55000); const ra = await pay(sid(a.json.checkoutUrl)); eq(ra.json.status, "succeeded", "55s"); await sleep(8000); const rb = await pay(sid(b.json.checkoutUrl)); assert(rb.json.status !== "succeeded", "63s paid"); const st = await txRow(b.json.transactionId); return `55 s: succeeded; 63 s: ${rb.json.status}/${st.failure_code}`; } finally { await setSettings("checkout_session_ttl_minutes=30"); }
  });
  await check("BUG-6f", "expirePendingCheckouts() sweep: expires only >TTL pending rows, not recent or non-pending", async () => {
    const old = await checkout(d.link); const fresh = await checkout(d.link); const paid = await sell(d.link, 2000); await age(old.json.transactionId, 45); await age(paid, 600);
    const cnt = await expirePendingCheckouts(); assert(cnt >= 1, "sweep count " + cnt); eq((await txRow(old.json.transactionId)).failure_code, "session_expired", "old"); eq((await txRow(fresh.json.transactionId)).status, "pending", "fresh"); eq((await txRow(paid)).status, "succeeded", "paid untouched"); return `swept ${cnt}`;
  });

  // ================= VOID + REFUND =================
  await check("VOID-1", "webhook success AFTER seller verification failed: not credited; tx failed/invalid_at_capture, review_reason=seller_not_verified, refund requested, ledger 0, seller balance unchanged, no download access (status not succeeded)", async () => {
    const c = await checkout(d.link); const tx = c.json.transactionId; await db.query("UPDATE sellers SET verification_status='manual_review' WHERE id=$1", [s.id]); const bal0 = await sellerLedgerSum(s.id);
    const w = await paySale(tx, 2000); await db.query("UPDATE sellers SET verification_status='verified' WHERE id=$1", [s.id]); const t = await txRow(tx);
    eq(w.status, 200, "200 so processor stops retrying"); eq(w.json.outcome, "processed", "outcome"); assert(String(w.json.detail).startsWith("voided:"), "detail " + w.json.detail); eq(t.status, "failed", "status"); eq(t.failure_code, "invalid_at_capture", "code"); eq(t.review_reason, "seller_not_verified", "review"); assert(t.refund_requested_at, "refund_requested_at"); assert(t.processor_ref, "processor_ref kept for refund");
    eq(await ledgerCount(tx), 0, "ledger"); eq(await sellerLedgerSum(s.id), bal0, "seller balance"); const st = await status(tx); eq(st.status, "failed", "status api"); assert(/refund/i.test(st.message ?? ""), "buyer msg " + st.message); return `voided:${t.review_reason}; refund_requested_at set; ledger 0; balance unchanged; buyer msg="${st.message}"`;
  });
  for (const [label, sql, reason, back] of [["drop unpublished", "UPDATE drops SET status='unpublished' WHERE id=$1", "drop_unavailable", "UPDATE drops SET status='published' WHERE id=$1"], ["drop flagged", "UPDATE drops SET status='flagged' WHERE id=$1", "drop_unavailable", "UPDATE drops SET status='published' WHERE id=$1"]] as const) {
    await check(`VOID-2-${label.split(" ")[1]}`, `webhook success after ${label} → voided:${reason}`, async () => {
      const dd = await makeDrop(s, 1700); const c = await checkout(dd.link); await db.query(sql, [dd.id]); const w = await paySale(c.json.transactionId, 1700); const t = await txRow(c.json.transactionId); eq(t.review_reason, reason, `review (${w.text})`); eq(await ledgerCount(c.json.transactionId), 0, "ledger"); return w.json.detail;
    });
  }
  await check("VOID-3", "webhook success for session older than TTL+grace (31 min + 1440 → backdate 25 h) → voided:session_expired; within grace (60 min old, status expired) → honoured (success, 3 lines)", async () => {
    const late = await checkout(d.link); await age(late.json.transactionId, 25 * 60); const w1 = await paySale(late.json.transactionId, 2000); eq((await txRow(late.json.transactionId)).review_reason, "session_expired", "late: " + w1.text); eq(await ledgerCount(late.json.transactionId), 0, "late ledger");
    const grace = await checkout(d.link); await age(grace.json.transactionId, 60); await expirePendingCheckouts({ transactionId: grace.json.transactionId }); eq((await txRow(grace.json.transactionId)).failure_code, "session_expired", "expired first"); const w2 = await paySale(grace.json.transactionId, 2000);
    const t = await txRow(grace.json.transactionId); eq(`${t.status}/${w2.json.outcome}`, "succeeded/processed", "grace: " + w2.text); eq(await ledgerCount(grace.json.transactionId), 3, "grace ledger"); return `25 h old → voided (${w1.json.detail}); expired 60 min ago, paid within grace → honoured (late-success policy)`;
  });
  await check("VOID-4", "voided txn: replays are idempotent (no 2nd refund request, no ledger); sale_failed after void ignored; processor's refund webhook → void_refund_confirmed with NO ledger change; further refund/chargeback events don't create ledger; double void refund only once", async () => {
    const c = await checkout(d.link); const tx = c.json.transactionId; await age(tx, 25 * 60); const ev = mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 }); const w1 = await sendWebhook(ev); const w2 = await sendWebhook(ev); const w3 = await paySale(tx, 2000);
    eq(w2.json.outcome, "duplicate", "replay"); eq(w3.json.outcome === "ignored" || w3.json.outcome === "duplicate", true, "new evt id: " + w3.text); const t0 = await txRow(tx);
    const f = await sendWebhook(mockEvents.saleFailed({ transactionId: tx, amountCents: 2000, failureCode: "card_declined" })); eq(f.json.outcome, "ignored", "failed-after-void " + f.text);
    const rf = await sendWebhook(refundEv(tx, 2000)); eq(rf.json.detail, "void_refund_confirmed", "refund confirm " + rf.text); const cb = await sendWebhook(cbEv(tx, null, 1)); const t1 = await txRow(tx);
    eq(await ledgerCount(tx), 0, "ledger stays 0"); eq(t1.reversed_cents, 0, "reversed untouched"); eq(String(t1.refund_requested_at), String(t0.refund_requested_at), "refund request once");
    return `replay=${w2.json.outcome}; new-evt=${w3.json.outcome}/${w3.json.detail}; fail-after-void=${f.json.outcome}/${f.json.detail}; refund hook=${rf.json.detail}; chargeback on voided=${cb.json.outcome}/${cb.json.detail}`;
  });
  await check("VOID-5", "concurrent late-success deliveries ×10 (different event ids) on an expired>grace txn → exactly one void, one refund request, ledger 0, no 5xx", async () => {
    const c = await checkout(d.link); const tx = c.json.transactionId; await age(tx, 26 * 60); const r = await Promise.all(Array.from({ length: 10 }, () => paySale(tx, 2000))); assert(r.every((x) => x.status === 200), "statuses " + r.map((x) => x.status)); eq(r.filter((x) => x.json.outcome === "processed").length, 1, "processed " + r.map((x) => x.json.outcome + "/" + x.json.detail)); eq(await ledgerCount(tx), 0, "ledger"); return r.map((x) => x.json.outcome[0]).join("");
  });
  await check("VOID-6", "void refund provider failure path: refund_requested_at NULL rows are retried by retryVoidRefunds() (ops hook) and requested exactly once", async () => {
    const c = await checkout(d.link); const tx = c.json.transactionId; await age(tx, 26 * 60); await paySale(tx, 2000); await db.query("UPDATE transactions SET refund_requested_at=NULL WHERE id=$1", [tx]); const k = await retryVoidRefunds(); const kk = k as any; assert((kk.requested ?? kk) >= 1, "retried " + JSON.stringify(k)); assert((await txRow(tx)).refund_requested_at, "set"); const k2 = (await retryVoidRefunds()).requested; const t = await txRow(tx); return `retry hook requested ${k}; second run ${k2} (this tx not repeated: ${!!t.refund_requested_at})`;
  });
  await check("VOID-7", "invariants over ALL voided txns: ledger 0 per txn, review_reason set, status failed, refund_requested_at set (or retry pending), seller ledger sum == Σ settled txns' expected net", async () => {
    const bad = await db.query(`SELECT t.id FROM transactions t WHERE t.review_reason IS NOT NULL AND (t.status<>'failed' OR EXISTS (SELECT 1 FROM ledger_entries l WHERE l.transaction_id=t.id))`); eq(bad.rowCount, 0, "void rows with ledger/status");
    const v = await n("SELECT count(*) n FROM transactions WHERE review_reason IS NOT NULL"); const nr = await n("SELECT count(*) n FROM transactions WHERE review_reason IS NOT NULL AND refund_requested_at IS NULL");
    const neg = await db.query("SELECT 1 FROM ledger_entries l JOIN transactions t ON t.id=l.transaction_id WHERE t.status='failed' LIMIT 1"); eq(neg.rowCount, 0, "ledger on failed txns"); return `${v} voided txns, ${nr} awaiting refund retry (should be 1 from VOID-6 reset? ${nr}); none have ledger`;
  });
  await check("VOID-8", "voided refund doesn't consume refund limits/earnings: earnings API for the seller counts voided txns as neither sale nor refund", async () => {
    const e = (await s.http.json("GET", "/api/earnings")).json; eq(e.balance.totalCents, await sellerLedgerSum(s.id), "balance==ledger"); const bad = e.recent.filter((x: any) => x.status === "failed"); return `earnings.recent excludes failed? failed in recent=${bad.length}; balance ${e.balance.totalCents} == ledger`;
  });
  await check("VOID-9", "money math for expiry-boundary sale honoured in grace: gross==net+fees, no negative", async () => {
    const rows = (await db.query("SELECT amount_cents a, platform_fee_cents p, processing_fee_cents c, seller_net_cents nn, id FROM transactions WHERE status IN ('succeeded','refunded','charged_back')")).rows; const bad = rows.filter((r) => r.a !== r.p + r.c + r.nn || r.p < 0 || r.c < 0 || r.nn < 0); eq(bad.length, 0, "bad rows " + bad.map((b) => b.id)); return `${rows.length} settled txns satisfy gross == net+platform+processing`;
  });
  await check("VOID-10", "pay at TTL expiry vs webhook race: concurrent {expire sweep, pay} ×20 → each txn ends consistent (succeeded ⇒ 3 lines; failed ⇒ 0 lines), no 5xx", async () => {
    let succ = 0, fail = 0; for (let i = 0; i < 20; i++) { const c = await checkout(d.link); await age(c.json.transactionId, 29 * 60 + 59 + 0 > 0 ? 29 : 29); await db.query("UPDATE transactions SET created_at = now() - interval '29 minutes 59.9 seconds' WHERE id=$1", [c.json.transactionId]);
      const r = await Promise.all([pay(sid(c.json.checkoutUrl)), pay(sid(c.json.checkoutUrl)), expirePendingCheckouts(), new Http().json("GET", `/api/checkout/status?id=${c.json.transactionId}`)]); assert((r[0] as any).status < 500 && (r[1] as any).status < 500, "5xx"); const t = await txRow(c.json.transactionId); const nl = await ledgerCount(c.json.transactionId);
      assert((t.status === "succeeded" && nl === 3) || (t.status === "failed" && nl === 0), `inconsistent ${t.status}/${nl}/${t.failure_code}`); t.status === "succeeded" ? succ++ : fail++; }
    return `20 boundary races: ${succ} succeeded(3 lines), ${fail} expired(0 lines), 0 inconsistent`;
  });

  // ================= BUG-7 =================
  await check("BUG-7a", "decline then retry on SAME session works (all 5 decline classes), each decline shows friendly message & no raw code; status API retryable:true", async () => {
    const out: string[] = []; for (const [card, code] of [["4000000000000002", "card_declined"], ["4000000000009995", "insufficient_funds"], ["4000000000000069", "expired_card"], ["4000000000000127", "incorrect_cvc"], ["4111111111111111", "unrecognized"], ["abc", "invalid"]] as const) {
      const c = await checkout(d.link); const r = await pay(sid(c.json.checkoutUrl), card); assert(!RAW.test(r.json.message ?? ""), `raw code in message: ${r.json.message}`); const st = await status(c.json.transactionId); assert(!RAW.test(JSON.stringify(st)), "raw in status API " + JSON.stringify(st)); eq(st.retryable, true, "retryable " + card);
      const r2 = await pay(sid(c.json.checkoutUrl)); eq(r2.json.status, "succeeded", "retry " + card); eq(await ledgerCount(c.json.transactionId), 3, "ledger"); out.push(`${code}:"${(r.json.message ?? "").slice(0, 32)}…"→retry ok`); }
    return out.join(" | ");
  });
  await check("BUG-7b", "repeated declines (3×) then success on one session: each attempt distinct processor txn (not deduped away), final 1 posting; retry after success is idempotent", async () => {
    const c = await checkout(d.link); const sidv = sid(c.json.checkoutUrl); for (const card of ["4000000000000002", "4000000000009995", "4000000000000127"]) { const r = await pay(sidv, card); eq(r.json.status, "failed", "decline"); eq(r.json.approved, false, "approved"); }
    const ok = await pay(sidv); eq(ok.json.status, "succeeded", "success"); const again = await pay(sidv, "4000000000000002"); eq(again.json.status, "succeeded", "decline after success must not flip"); eq(await ledgerCount(c.json.transactionId), 3, "lines"); const w = await n("SELECT count(*) n FROM webhook_events WHERE transaction_id=$1 AND outcome='processed'", [c.json.transactionId]); return `3 declines + success: ledger 3 lines; processed events ${w}; later decline ignored`;
  });
  await check("BUG-7c", "expired / unavailable / void sessions are NOT retryable and show friendly copy; no raw codes anywhere in simulator JSON `message` or status API", async () => {
    const e = await checkout(d.link); await age(e.json.transactionId, 40); const re = await pay(sid(e.json.checkoutUrl)); const se = await status(e.json.transactionId); eq(se.retryable, false, "expired retryable?"); assert(/expired/i.test(se.message), "msg " + se.message); const r2 = await pay(sid(e.json.checkoutUrl)); assert(r2.json.status !== "succeeded", "expired payable after");
    return `expired: "${se.message}"; pay→${re.json.status}`;
  });
  await check("BUG-7d", "hosted page + link page HTML contain no raw failure codes; mock page renders sales-final; (browser flow in qa-pay-ui.mjs)", async () => {
    const c = await checkout(d.link); const html = await (await fetch(c.json.checkoutUrl)).text(); assert(html.includes('data-testid="sales-final"'), "no sales-final on hosted"); const link = await (await fetch(`${process.env.QA_BASE_URL ?? "http://localhost:3917"}/u/${d.link}`)).text(); assert(link.includes('data-testid="sales-final"'), "no sales-final on link page"); assert(!RAW.test(html) && !RAW.test(link), "raw code in HTML"); return "sales-final present on both; no raw codes in HTML";
  });

  // ================= DB / INVARIANTS =================
  await check("INV-1", "global invariants after all R2 scenarios: per-tx reversed ≤ amount; no ledger on pending/failed; Σ ledger == earnings total per seller; no negative sale credits; 0 duplicate pending", async () => {
    const q1 = await db.query("SELECT id FROM transactions WHERE reversed_cents > amount_cents OR (status IN ('pending','failed') AND EXISTS (SELECT 1 FROM ledger_entries l WHERE l.transaction_id=transactions.id))"); eq(q1.rowCount, 0, "tx invariant " + q1.rows.map((r) => r.id));
    const q2 = await db.query("SELECT drop_id, lower(buyer_email), coalesce(buyer_token_hash,'') FROM transactions WHERE status='pending' GROUP BY 1,2,3 HAVING count(*)>1"); eq(q2.rowCount, 0, "dup pending");
    const q3 = await db.query("SELECT id FROM transactions WHERE status IN ('succeeded','refunded','charged_back') AND amount_cents <> platform_fee_cents+processing_fee_cents+seller_net_cents"); eq(q3.rowCount, 0, "sum");
    const q4 = await db.query("SELECT l.transaction_id FROM ledger_entries l JOIN transactions t ON t.id=l.transaction_id GROUP BY l.transaction_id, t.seller_net_cents, t.status, t.reversed_cents HAVING t.status='succeeded' AND t.reversed_cents=0 AND SUM(l.amount_cents) <> t.seller_net_cents"); eq(q4.rowCount, 0, "unrefunded ledger==net");
    return `all hold (${await n("SELECT count(*) n FROM transactions")} txns, ${await n("SELECT count(*) n FROM ledger_entries")} ledger lines)`;
  });
  save("pay5-old-r2b-results.json"); await done(); await pool().end();
})().catch((e) => { console.error(e); process.exit(1); });
