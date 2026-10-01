// @ts-nocheck
/* eslint-disable */
// QA: stale pending sessions; seller state changes between checkout and payment.
import { check, assert, eq, db, makeSeller, makeDrop, checkout, txRow, save, done, ledgerCount, Http } from "./qa-pay4-lib";
const pay = (sid: string, card = "4242424242424242") => new Http().json("POST", "/api/dev/payments/pay", { json: { sessionId: sid, card } });
(async () => {
  const s = await makeSeller("sess"); const d = await makeDrop(s, 2000);
  await check("SESS-1", "pending checkout older than 30 days can still be paid (no session expiry)", async () => {
    const c = await checkout(d.link); await db.query("UPDATE transactions SET created_at = now() - interval '30 days' WHERE id=$1", [c.json.transactionId]);
    const r = await pay(c.json.checkoutUrl.split("/").pop()); assert(r.json?.status !== "succeeded", `30-day-old pending session was payable (status ${r.json?.status}); pending sessions never expire - ledger posted ${await ledgerCount(c.json.transactionId)} lines`); return "expired";
  });
  await check("SESS-2", "seller loses verification (failed/manual_review) after checkout started: payment still completes", async () => {
    const c = await checkout(d.link); await db.query("UPDATE sellers SET verification_status='failed' WHERE id=$1", [s.id]); const r = await pay(c.json.checkoutUrl.split("/").pop()); await db.query("UPDATE sellers SET verification_status='verified' WHERE id=$1", [s.id]);
    assert(r.json?.status !== "succeeded", `sale succeeded for a seller whose verification is now 'failed' (webhook path re-checks nothing)`); return "blocked";
  });
  await check("SESS-3", "pending tx never auto-expire: count of pending older than 1 day is 0 after cleanup job? (no cleanup job exists)", async () => {
    const n = Number((await db.query("SELECT count(*) n FROM transactions WHERE status='pending' AND created_at < now() - interval '1 day'")).rows[0].n); assert(n === 0, `${n} pending transactions >1 day old and nothing reaps them (NOTE: low; grows unbounded, status pages show pending forever)`); return "none";
  });
  save("pay4-old-session-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
