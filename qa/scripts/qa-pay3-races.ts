// @ts-nocheck
/* eslint-disable */
// QA: races between event types, refund re-delivery under new event ids, log inspection.
import fs from "node:fs";
import { check, assert, eq, db, makeSeller, makeDrop, checkout, txRow, save, done, sell, sendWebhook, mockEvents, ledgerCount, ledgerSum, refundEv, cbEv, sellerLedgerSum } from "./qa-pay3-lib";
(async () => {
  const s = await makeSeller("race"); const d = await makeDrop(s, 2000);
  await check("RACE-1", "sale and refund webhooks delivered CONCURRENTLY (15 trials): final state always refunded, ledger nets 0, exactly 3+3 lines, no 5xx", async () => {
    const out: string[] = [];
    for (let i = 0; i < 15; i++) {
      const tx = (await checkout(d.link)).json.transactionId; const [a, b] = await Promise.all([sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 })), sendWebhook(refundEv(tx, 2000))]);
      assert(a.status === 200 && b.status === 200, `trial ${i}: ${a.status}/${b.status} ${a.text} ${b.text}`);
      const t = await txRow(tx); assert(t.status === "refunded" && t.reversed_cents === 2000, `trial ${i}: ${t.status} rev ${t.reversed_cents} (sale=${a.json.outcome} refund=${b.json.outcome}/${b.json.detail})`); eq(await ledgerSum(tx), 0, `ledger trial ${i}`); eq(await ledgerCount(tx), 6, "lines"); out.push(`${a.json.outcome[0]}${b.json.outcome[0]}`);
    }
    return `15/15 consistent (sale,refund outcomes: ${out.join(" ")})`;
  });
  await check("RACE-2", "sale_succeeded racing sale_failed (12 trials): final state consistent with ledger", async () => {
    for (let i = 0; i < 12; i++) { const tx = (await checkout(d.link)).json.transactionId; await Promise.all([sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 })), sendWebhook(mockEvents.saleFailed({ transactionId: tx, amountCents: 2000, failureCode: "card_declined" }))]); const t = await txRow(tx); const n = await ledgerCount(tx);
      assert((t.status === "succeeded" && n === 3), `trial ${i}: ${t.status} ledger ${n} (success must win regardless of order or be consistent)`); }
    return "always succeeded/3 lines (success after failure accepted; failure after success ignored)";
  });
  await check("RACE-3", "refund re-delivered under NEW event id with the same processor refund id → duplicate, not a second refund", async () => {
    const tx = await sell(d.link, 2000); const a = await sendWebhook(refundEv(tx, 500, "rf_same_" + tx.slice(0, 8))); const b = await sendWebhook(refundEv(tx, 500, "rf_same_" + tx.slice(0, 8)));
    eq(a.json.outcome, "processed", "first"); eq(b.json.outcome, "duplicate", "re-delivery"); eq((await txRow(tx)).reversed_cents, 500, "rev"); return "duplicate via (provider, processor tx id, type) key";
  });
  await check("RACE-4", "two DIFFERENT partial refunds that reuse the same processor refund id (processor bug / collision): second silently dropped as duplicate → books understate refund (record)", async () => {
    const tx = await sell(d.link, 2000); const a = await sendWebhook(refundEv(tx, 500, "rf_collide_" + tx.slice(0, 8))); const b = await sendWebhook(refundEv(tx, 700, "rf_collide_" + tx.slice(0, 8)));
    return `first ${a.json.outcome}, second (different amount, same refund id) ${b.json.outcome}; reversed ${(await txRow(tx)).reversed_cents} — by design dedupe key; NOTE only`;
  });
  await check("LOG-1", "app logs: no stack traces/secrets: PAYMENT_WEBHOOK_SECRET / SESSION_SECRET never printed; list distinct error lines", async () => {
    const logs = ["qa/artifacts/pay3-server-3717.log", "qa/artifacts/pay3-server-3718.log"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
    for (const k of ["PAYMENT_WEBHOOK_SECRET", "SESSION_SECRET", "SIGNED_URL_SECRET"]) assert(!logs.includes(process.env[k]!), `${k} value in logs`);
    const errs = [...new Set(logs.split("\n").filter((l) => /error|fail/i.test(l)).map((l) => l.slice(0, 160)))]; return `no secrets in logs; ${errs.length} distinct error-ish lines: ${errs.slice(0, 4).join(" | ")}`;
  });
  save("pay3-old-races-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
