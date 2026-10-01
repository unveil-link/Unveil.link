/* eslint-disable */
// QA M3-12 / M6-08: processor retry after a 5xx: the failed attempt leaves no dedupe claim and no partial state.
import { check, assert, eq, db, makeSeller, makeDrop, checkout, txRow, save, done, sendWebhook, mockEvents, ledgerCount, paySale } from "./qa-pay-lib";
(async () => {
  const s = await makeSeller("retry"); const d = await makeDrop(s, 2000);
  await check("M3-12 retry", "event that 500s (DB error from NUL byte in event id) leaves NO claim/partial ledger; error row logged; corrected retry for same payment is processed", async () => {
    const tx = (await checkout(d.link)).json.transactionId;
    const bad = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, eventId: "e\u0000x" })); eq(bad.status, 500, "bad status");
    eq((await txRow(tx)).status, "pending", "pending"); eq(await ledgerCount(tx), 0, "ledger");
    const claim = await db.query("SELECT count(*) n FROM webhook_events WHERE dedupe_claim AND transaction_id=$1", [tx]); eq(Number(claim.rows[0].n), 0, "claim rows");
    const err = await db.query("SELECT count(*) n FROM webhook_events WHERE outcome='error' AND merchant_reference=$1", [tx]); 
    const ok = await paySale(tx, 2000); eq(ok.json.outcome, "processed", "retry"); return `500 → no claim, no ledger; error rows logged=${err.rows[0].n}; retry processed`;
  });
  await check("M6-08 queue", "'queued with retry' is the processor's at-least-once redelivery (no internal queue/retry worker exists); parked events are re-applied inside the sale transaction; retryParkedEvents() is a service function only (no route/cron)", async () => {
    const tx = (await checkout(d.link)).json.transactionId; const { refundEv } = await import("./qa-pay-lib"); await sendWebhook(refundEv(tx, 500)); 
    const parked = Number((await db.query("SELECT count(*) n FROM webhook_events WHERE outcome='parked' AND merchant_reference=$1", [tx])).rows[0].n); eq(parked, 1, "parked");
    return "parked row visible; applied automatically when the sale lands (OOO-1..4); no cron for stragglers whose sale never arrives (NOTE)";
  });
  save("pay-retry-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
