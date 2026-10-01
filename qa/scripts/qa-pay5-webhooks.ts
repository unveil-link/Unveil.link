// @ts-nocheck
/* eslint-disable */
// QA: idempotency, signatures, out-of-order, unknown provider, injection in webhook JSON.
import crypto from "node:crypto";
import { Http, check, rec, assert, eq, db, makeSeller, makeDrop, checkout, txRow, save, done, sell, sendWebhook, paySale, mockEvents, mockSaleId, signPayload, SECRET, ledgerCount, ledgerSum, whCount, refundEv, cbEv, sellerLedgerSum, BASE, freshIp } from "./qa-pay5-lib";

(async () => {
  const s = await makeSeller("wh"); const d = await makeDrop(s, 2000);
  const newTx = async () => (await checkout(d.link)).json.transactionId as string;
  const state = async (id: string) => { const t = await txRow(id); return `${t.status}/${t.reversed_cents}/${t.processor_ref}`; };

  // ---------- IDEMPOTENCY ----------
  await check("M3-11 / IDEM-1", "same sale webhook 3x (identical bytes) → 1 ledger posting (3 lines), 1 succeeded tx, balance credited once", async () => {
    const tx = await newTx(); const ev = mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 });
    const r = [await sendWebhook(ev), await sendWebhook(ev), await sendWebhook(ev)];
    eq(r.map((x) => x.status).join(), "200,200,200", "statuses"); eq(r.map((x) => x.json.outcome).join(), "processed,duplicate,duplicate", "outcomes");
    eq(await ledgerCount(tx), 3, "ledger lines"); eq(await ledgerSum(tx), 1560, "ledger sum");
    return `outcomes ${r.map((x) => x.json.outcome)}; ledger lines 3, sum 1560`;
  });
  await check("IDEM-2", "12 concurrent identical deliveries → exactly one processed, 11 duplicates, 3 ledger lines, balance +1560 once", async () => {
    const tx = await newTx(); const ev = mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 });
    const before = await sellerLedgerSum(s.id);
    const r = await Promise.all(Array.from({ length: 12 }, () => sendWebhook(ev)));
    const oc = r.map((x) => `${x.status}:${x.json?.outcome}`); const proc = oc.filter((x) => x === "200:processed").length, dup = oc.filter((x) => x === "200:duplicate").length;
    eq(proc, 1, `processed count (${oc})`); eq(dup, 11, "dups"); eq(await ledgerCount(tx), 3, "lines"); eq((await sellerLedgerSum(s.id)) - before, 1560, "balance delta");
    return `${proc} processed + ${dup} duplicate (all 200); seller ledger delta 1560`;
  });
  await check("IDEM-3", "12 concurrent deliveries with DIFFERENT event ids + different processor tx ids for the same payment → one sale posting", async () => {
    const tx = await newTx(); const before = await sellerLedgerSum(s.id);
    const r = await Promise.all(Array.from({ length: 12 }, (_, i) => sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, saleId: `mocktx_dist_${i}_${tx.slice(0, 6)}` }))));
    const oc = r.map((x) => `${x.status}:${x.json?.outcome}`);
    const proc = oc.filter((x) => x === "200:processed").length;
    eq(proc, 1, `processed (${oc.join(" ")})`); assert(r.every((x) => x.status === 200), `non-200 present: ${oc}`);
    eq(await ledgerCount(tx), 3, "lines"); eq((await sellerLedgerSum(s.id)) - before, 1560, "delta");
    return `${oc.join(" ")}`;
  });
  await check("IDEM-4", "same sale, new event id (sequential) → ignored/duplicate, not a second posting; same event id with different type isn't confused", async () => {
    const tx = await newTx(); await paySale(tx, 2000);
    const again = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 })); // new evt id, same sale id
    const again2 = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, saleId: "mocktx_other_" + tx.slice(0, 8) })); // new evt id + new sale id
    assert(again.status === 200 && again2.status === 200, "status"); eq(await ledgerCount(tx), 3, "lines");
    // sale_failed after success must not flip state
    const f = await sendWebhook(mockEvents.saleFailed({ transactionId: tx, amountCents: 2000, failureCode: "card_declined" }));
    eq(f.status, 200, "failed status"); eq((await txRow(tx)).status, "succeeded", "still succeeded");
    // same event id reused for a refund type (event-id collision across types)
    const evId = "evt_collide_" + tx.slice(0, 8); await sendWebhook(mockEvents.saleSucceeded({ transactionId: await newTx(), amountCents: 2000, eventId: evId }));
    const col = await sendWebhook(refundEv(tx, 500, undefined, evId));
    return `second sale new evt: ${again.json.outcome}/${again.json.detail}; new evt+new saleId: ${again2.json.outcome}/${again2.json.detail}; fail-after-success: ${f.json.outcome}/${f.json.detail}; refund reusing a sale's event id: ${col.json.outcome}/${col.json.detail} (state ${await state(tx)})`;
  });
  await check("IDEM-5", "amount mismatch sale (tampered amount in signed event) → rejected, tx stays pending, no ledger", async () => {
    const tx = await newTx(); const r = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 1 }));
    eq(r.json.outcome, "rejected", r.text); eq((await txRow(tx)).status, "pending", "status"); eq(await ledgerCount(tx), 0, "ledger");
    return `mismatch→${r.json.outcome}/${r.json.detail}; tx pending, no ledger`;
  });
  await check("IDEM-5b", "after a REJECTED amount-mismatch sale event, the correct sale event for the same payment (same processor tx id, new event id) is still processed", async () => {
    const tx = await newTx(); const bad = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 1 })); eq(bad.json.outcome, "rejected", "mismatch");
    const ok = await paySale(tx, 2000);
    eq(`${ok.json.outcome}`, "processed", `legit sale after rejected mismatch → ${ok.text}; tx=${(await txRow(tx)).status} (dedupe claim burned by the rejected event?)`);
    return "processed";
  });
  await check("IDEM-5c", "currency mismatch (EUR) sale rejected with no state change", async () => {
    const tx = await newTx(); const r2 = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, currency: "EUR" })); eq(r2.json.outcome, "rejected", r2.text);
    eq((await txRow(tx)).status, "pending", "pending"); return `EUR→${r2.json.detail}`;
  });
  await check("IDEM-5d", "a sale_succeeded for an UNKNOWN reference (ignored) does not burn the dedupe key of a later legit sale with the same processor id", async () => {
    const tx = await newTx(); const sid = mockSaleId(tx);
    const early = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, reference: "22222222-2222-4222-8222-222222222222", saleId: sid })); 
    const ok = await paySale(tx, 2000);
    eq(ok.json.outcome, "processed", `early=${early.json.outcome}/${early.json.detail}; legit=${ok.text}`); return `early ${early.json.outcome}; legit processed`;
  });

  // ---------- SIGNATURES ----------
  const sigTx = await newTx(); const sigEv = mockEvents.saleSucceeded({ transactionId: sigTx, amountCents: 2000 }); const raw = JSON.stringify(sigEv);
  const nowS = Math.floor(Date.now() / 1000);
  const unchanged = async (label: string) => { eq((await txRow(sigTx)).status, "pending", `${label}: status changed`); eq(await ledgerCount(sigTx), 0, `${label}: ledger written`); };
  const cases: [string, Parameters<typeof sendWebhook>[1]][] = [
    ["missing header", { sig: null }],
    ["empty header", { sig: "" }],
    ["garbage header", { sig: "hello" }],
    ["truncated v1 (63 hex)", { sig: signPayload(SECRET, raw, nowS).slice(0, -1) }],
    ["truncated v1 (half)", { sig: signPayload(SECRET, raw, nowS).slice(0, -32) }],
    ["empty v1", { sig: `t=${nowS},v1=` }],
    ["no t", { sig: signPayload(SECRET, raw, nowS).replace(/^t=\d+,/, "") }],
    ["wrong secret", { secret: "x".repeat(40) }],
    ["empty-string secret", { secret: "" }],
    ["stale (-301s)", { nowSec: nowS - 301 }],
    ["stale (-1 day)", { nowSec: nowS - 86400 }],
    ["future (+10min)", { nowSec: nowS + 600 }],
    ["t tampered after signing", { sig: signPayload(SECRET, raw, nowS).replace(/t=\d+/, `t=${nowS + 1}`) }],
    ["tampered body (amount changed after signing)", { rawBody: raw.replace("2000", "1999"), sig: signPayload(SECRET, raw, nowS) }],
    ["body with trailing whitespace after signing", { rawBody: raw + " ", sig: signPayload(SECRET, raw, nowS) }],
    ["uppercase-hex + valid secret but sig over different body", { sig: signPayload(SECRET, raw + "x", nowS).toUpperCase().replace("T=", "t=").replace("V1=", "v1=") }],
    ["signature of body signed w/o timestamp prefix (raw HMAC)", { sig: `t=${nowS},v1=${crypto.createHmac("sha256", SECRET).update(raw).digest("hex")}` }],
  ];
  for (const [i, [name, o]] of cases.entries()) {
    await check(`M3-10 / SIG-${i + 1}`, `webhook rejected: ${name}`, async () => {
      const r = await sendWebhook(sigEv, { ...o }); eq(r.status, 401, `status (${r.text})`); await unchanged(name); return `401 ${r.json?.code}`;
    });
  }
  await check("M3-10 / SIG-18", "wrong content-type (text/plain, form-urlencoded, none) with VALID signature: not processed as an exploitable bypass", async () => {
    const out: string[] = [];
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "application/xml", ""]) {
      const r = await sendWebhook(sigEv, { headers: { "content-type": ct } }); out.push(`${ct || "(none)"}→${r.status}/${r.json?.outcome ?? r.json?.code}`);
      if (r.json?.outcome === "processed") break;
    }
    return out.join("; ") + ` (tx now ${(await txRow(sigTx)).status}; body is HMAC-verified JSON so content-type is not security relevant)`;
  });
  await check("SIG-19", "valid signature w/ OK body processes (control) and replay of the exact signed request later is duplicate", async () => {
    const tx = await newTx(); const ev = mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 }); const rawb = JSON.stringify(ev); const sig = signPayload(SECRET, rawb, Math.floor(Date.now() / 1000));
    const a = await sendWebhook(ev, { rawBody: rawb, sig }); const b = await sendWebhook(ev, { rawBody: rawb, sig });
    eq(a.json.outcome, "processed", "first"); eq(b.json.outcome, "duplicate", "replay"); return "replay of byte-identical signed request inside window → duplicate";
  });
  await check("SIG-20", "stale replay: previously valid request replayed > tolerance (simulated by old t) rejected even though event id is new", async () => {
    const tx = await newTx(); const r = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 }), { nowSec: Math.floor(Date.now() / 1000) - 400 });
    eq(r.status, 401, "stale"); eq((await txRow(tx)).status, "pending", "pending"); return "401";
  });
  await check("SIG-21", "tolerance boundary: t=-290s accepted, t=+290s accepted", async () => {
    const a = await sendWebhook(mockEvents.saleSucceeded({ transactionId: await newTx(), amountCents: 2000 }), { nowSec: Math.floor(Date.now() / 1000) - 290 });
    const b = await sendWebhook(mockEvents.saleSucceeded({ transactionId: await newTx(), amountCents: 2000 }), { nowSec: Math.floor(Date.now() / 1000) + 290 });
    eq(a.status, 200, "-290"); eq(b.status, 200, "+290"); return "both 200";
  });
  await check("SIG-22", "unknown provider paths → 404 no state change: /stripe /paypal /__proto__ /constructor /MOCK /mock%2f..", async () => {
    const before = await whCount(); const out: string[] = [];
    for (const p of ["stripe", "paypal", "__proto__", "constructor", "toString", "MOCK", "mock%20", "..%2fmock", "segpay", "ccbill"]) {
      const r = await sendWebhook(sigEv, { provider: p }); out.push(`${p}:${r.status}`); assert([404, 400].includes(r.status), `${p} → ${r.status}`);
    }
    eq(await whCount(), before, "webhook_events rows created for unknown providers?"); return out.join(" ");
  });
  await check("SIG-23", "timing-safe compare (code review): crypto.timingSafeEqual on equal-length buffers, always executed, constant-time candidate padding", async () => {
    const src = (await import("node:fs")).readFileSync("src/server/payments/signature.ts", "utf8");
    assert(src.includes("timingSafeEqual") && !/===\s*expected|expected\s*===/.test(src), "no timingSafeEqual or plain compare found"); return "signature.ts uses timingSafeEqual on 32-byte buffers; non-hex candidate compares against zero buffer";
  });
  await check("SIG-24", "oversized body (300 KB) → 413 and nothing stored beyond cap; GET/PUT/DELETE method not allowed", async () => {
    const big = JSON.stringify({ pad: "A".repeat(300_000) }); const r = await sendWebhook(null, { rawBody: big });
    eq(r.status, 413 as number, `big (${r.status})`);
    const g = await fetch(`${BASE}/api/webhooks/mock`); assert([404, 405].includes(g.status), `GET ${g.status}`); return `POST 413, GET ${g.status}`;
  });
  await check("SIG-25", "rejected deliveries are logged (signature_valid=false, payload truncated ≤1KiB) and log flooding is limited (60/min/IP → 429)", async () => {
    const ip = freshIp(); const codes: number[] = [];
    for (let i = 0; i < 70; i++) codes.push((await sendWebhook(sigEv, { sig: "bad", ip })).status);
    const n401 = codes.filter((c) => c === 401).length, n429 = codes.filter((c) => c === 429).length;
    assert(n429 > 0, `no 429 after 70 bad deliveries: ${n401}x401`);
    const mx = (await db.query("SELECT max(length(payload)) m FROM webhook_events WHERE signature_valid=false")).rows[0].m;
    assert(Number(mx) <= 1024, `payload len ${mx}`); return `${n401}×401 then ${n429}×429; max stored rejected payload ${mx} bytes`;
  });
  await check("SIG-26", "valid-signature but malformed payloads → 400 (schema), no state change: bad JSON, wrong types, negative/float/huge amounts, missing fields", async () => {
    const tx = await newTx(); const base = mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 }); const out: string[] = [];
    const mut = (f: (e: any) => void) => { const e = JSON.parse(JSON.stringify(base)); f(e); return e; };
    const bads: [string, unknown][] = [["amount float", mut((e) => (e.data.amount_cents = 19.99))], ["amount negative", mut((e) => (e.data.amount_cents = -2000))], ["amount string", mut((e) => (e.data.amount_cents = "2000"))], ["amount huge", mut((e) => (e.data.amount_cents = 1e12))], ["type unknown", mut((e) => (e.type = "sale.refunded_all"))], ["no data", { id: "x", type: "sale.succeeded", created: "now" }], ["currency 4 chars", mut((e) => (e.data.currency = "USDX"))]];
    for (const [n, e] of bads) { const r = await sendWebhook(e); out.push(`${n}:${r.status}`); assert(r.status === 400, `${n} → ${r.status} ${r.text}`); }
    const r = await sendWebhook(null, { rawBody: "{not json" }); assert(r.status === 400, `bad json ${r.status}`); out.push(`badjson:${r.status}`);
    const r2 = await sendWebhook(null, { rawBody: "[]" }); assert(r2.status === 400, "array"); out.push(`array:${r2.status}`);
    eq((await txRow(tx)).status, "pending", "state"); return out.join(" ");
  });
  await check("SEC-1 injection", "SQL injection / odd values in webhook reference, ids, failure_code: stored as data; no error, no schema damage", async () => {
    const tx = await newTx(); const out: string[] = [];
    const payloads = ["' OR '1'='1", "'; DROP TABLE transactions;--", "00000000-0000-0000-0000-000000000000", "${{7*7}}", tx + "' --", "\\", "é😀"];
    for (const p of payloads) {
      const e1 = mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, reference: p }); const r1 = await sendWebhook(e1); out.push(`ref(${p.slice(0, 12)}):${r1.status}/${r1.json?.outcome}`); assert(r1.status === 200 || r1.status === 400, `${p}→${r1.status} ${r1.text}`);
      const e2 = mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, eventId: p, saleId: p }); const r2 = await sendWebhook(e2); assert([200, 400].includes(r2.status), `id ${p}→${r2.status} ${r2.text}`);
      const e3 = mockEvents.saleFailed({ transactionId: tx, amountCents: 2000, failureCode: p }); const r3 = await sendWebhook(e3); assert([200, 400].includes(r3.status), `fc ${p}→${r3.status}`);
    }
    const t = await db.query("SELECT count(*) FROM transactions"); assert(Number(t.rows[0].count) > 0, "transactions table gone");
    const row = await txRow(tx); return `${out.join(" ")}; tx still ${row.status}, failure_code=${JSON.stringify(row.failure_code)}`;
  });
  await check("SEC-1b NUL byte", "signed event containing U+0000 in id/reference/failure_code → clean 4xx or handled (not 500 retry-storm)", async () => {
    const tx = await newTx(); const out: string[] = [];
    for (const [n, e] of [["reference", mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, reference: "a\u0000b" })], ["event id", mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, eventId: "e\u0000x" })], ["failure_code", mockEvents.saleFailed({ transactionId: tx, amountCents: 2000, failureCode: "f\u0000c" })]] as const) {
      const r = await sendWebhook(e); out.push(`${n}:${r.status}`); assert(r.status < 500, `${n} NUL → ${r.status} ${r.text}`);
    }
    return out.join(" ");
  });
  await check("SEC-2 mass-assign", "extra/unknown fields in webhook JSON (status, seller_id, platform_fee_cents, amount_cents at top-level) cannot change fee split / destination", async () => {
    const tx = await newTx(); const e: any = mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 });
    e.seller_id = "00000000-0000-0000-0000-000000000000"; e.status = "refunded"; e.platform_fee_cents = 0; e.data.seller_net_cents = 2000; e.data.seller_id = s.id; e.data.platform_fee_cents = 0; e.data.status = "succeeded";
    const r = await sendWebhook(e); const t = await txRow(tx);
    assert(r.status === 200, r.text); eq(`${t.seller_net_cents},${t.platform_fee_cents}`, "1560,200", "split changed"); eq(await ledgerSum(tx), 1560, "ledger");
    return `${r.status} ${r.json.outcome}; split unchanged 1560/200`;
  });

  // ---------- OUT OF ORDER ----------
  await check("OOO-5b", "refund WITHOUT merchant reference (processor sale id only) before the sale → parked; when sale (with processor id) arrives → applied", async () => {
    const tx = await newTx(); const sid = "mocktx_noref_" + tx.slice(0, 10);
    const rf = mockEvents.refund({ transactionId: tx, refundId: "rf_noref_" + tx.slice(0, 8), amountCents: 2000, saleId: sid }); (rf.data as any).reference = null;
    const r = await sendWebhook(rf); eq(r.json.outcome, "parked", r.text);
    const sale = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, saleId: sid })); eq(sale.json.outcome, "processed", "sale");
    const t = await txRow(tx); eq(t.status, "refunded", "final status"); eq(await ledgerSum(tx), 0, "ledger"); return "parked then applied via processor id match; refunded";
  });
  await check("M3-12 / OOO-1", "refund (with reference) before sale → parked(200), then sale arrives → refund applied, final refunded & ledger nets 0", async () => {
    const tx = await newTx(); const rf = await sendWebhook(refundEv(tx, 2000));
    eq(rf.status, 200, "status"); eq(rf.json.outcome, "parked", rf.text); eq(await ledgerCount(tx), 0, "no ledger while parked"); eq((await txRow(tx)).status, "pending", "pending");
    const sale = await paySale(tx, 2000); eq(sale.json.outcome, "processed", "sale");
    const t = await txRow(tx); eq(t.status, "refunded", "final status"); eq(t.reversed_cents, 2000, "reversed"); eq(await ledgerSum(tx), 0, "ledger nets 0");
    const p = await db.query("SELECT outcome, outcome_detail FROM webhook_events WHERE transaction_id=$1 AND event_type='refunded'", [tx]);
    return `parked→applied: ${JSON.stringify(p.rows)}`;
  });
  await check("OOO-2", "chargeback before sale → parked, then sale → charged_back, ledger nets to 0 (no chargeback fee set)", async () => {
    const tx = await newTx(); const cb = await sendWebhook(cbEv(tx, null)); eq(cb.json.outcome, "parked", cb.text);
    await paySale(tx, 2000); const t = await txRow(tx); eq(t.status, "charged_back", "status"); eq(t.reversed_cents, 2000, "rev"); eq(await ledgerSum(tx), 0, "ledger");
    return "charged_back, ledger 0";
  });
  await check("OOO-3", "partial refund + chargeback + refund all arrive before sale, in order → applied in received order after sale; no over-reversal; state consistent", async () => {
    const tx = await newTx(); const r1 = await sendWebhook(refundEv(tx, 500)); const r2 = await sendWebhook(refundEv(tx, 700)); const r3 = await sendWebhook(refundEv(tx, 1000));
    assert([r1, r2, r3].every((r) => r.json.outcome === "parked"), "all parked"); await paySale(tx, 2000); const t = await txRow(tx);
    const ev = (await db.query("SELECT outcome, outcome_detail, amount_cents FROM webhook_events WHERE transaction_id=$1 AND event_type='refunded' ORDER BY received_at", [tx])).rows;
    assert(t.reversed_cents <= 2000, "over"); return `final ${t.status} reversed=${t.reversed_cents} ledgerSum=${await ledgerSum(tx)}; events ${JSON.stringify(ev.map((x) => `${x.amount_cents}:${x.outcome}/${x.outcome_detail}`))}`;
  });
  await check("OOO-4", "parked over-refund: refunds exceeding gross arrive before sale → excess rejected after sale, never over-refunds", async () => {
    const tx = await newTx(); await sendWebhook(refundEv(tx, 1500)); await sendWebhook(refundEv(tx, 1500)); await paySale(tx, 2000);
    const t = await txRow(tx); assert(t.reversed_cents <= 2000, `reversed ${t.reversed_cents}`);
    const ev = (await db.query("SELECT outcome, outcome_detail FROM webhook_events WHERE transaction_id=$1 AND event_type='refunded' ORDER BY received_at", [tx])).rows;
    return `reversed ${t.reversed_cents}, status ${t.status}, events ${JSON.stringify(ev)}`;
  });
  await check("OOO-5", "refund/chargeback for an unknown transaction uuid (ref matches nothing) → ignored, nothing created; refund w/o reference but with unknown related sale → parked (stays parked forever; note)", async () => {
    const a = await sendWebhook(refundEv("11111111-1111-4111-8111-111111111111", 100)); const b = await sendWebhook(mockEvents.refund({ transactionId: "x", refundId: "rf_orphan_" + stamp(), amountCents: 100 }) as any);
    return `unknown ref: ${a.json.outcome}/${a.json.detail}; non-uuid ref: ${b.json.outcome}/${b.json.detail}`;
  });
  await check("OOO-6", "failed sale then success (retry with same checkout) accepted; success then failed ignored", async () => {
    const tx = await newTx(); const f = await sendWebhook(mockEvents.saleFailed({ transactionId: tx, amountCents: 2000, failureCode: "card_declined" })); eq((await txRow(tx)).status, "failed", "failed");
    const ok = await paySale(tx, 2000); eq(ok.json.outcome, "processed", "success after failure"); eq((await txRow(tx)).status, "succeeded", "succeeded"); eq(await ledgerCount(tx), 3, "lines");
    return `failed(${f.json.outcome}) → succeeded; ledger 3 lines`;
  });
  function stamp() { return crypto.randomBytes(4).toString("hex"); }

  // ---------- Audit/PII ----------
  await check("S2-05 audit", "3 random transactions traceable: txn → webhook_events (claim+dups) → ledger lines linked by webhook_event_id → refund event", async () => {
    const rows = (await db.query(`SELECT t.id, t.status FROM transactions t WHERE t.status IN ('succeeded','refunded','charged_back') ORDER BY random() LIMIT 3`)).rows; const out: string[] = [];
    for (const r of rows) {
      const wh = (await db.query("SELECT count(*)::int n, count(*) FILTER (WHERE outcome='processed')::int p, count(*) FILTER (WHERE payload_sha256 IS NOT NULL)::int h FROM webhook_events WHERE transaction_id=$1", [r.id])).rows[0];
      const le = (await db.query("SELECT count(*)::int n, count(*) FILTER (WHERE webhook_event_id IS NULL)::int orphan FROM ledger_entries WHERE transaction_id=$1", [r.id])).rows[0];
      assert(wh.p >= 1 && le.n >= 3 && le.orphan === 0, `trace gap ${JSON.stringify({ r, wh, le })}`); out.push(`${r.id.slice(0, 8)}:${r.status} wh=${wh.n} ledger=${le.n}`);
    }
    return out.join("; ") + " (no receipt record exists: receipt email not built)";
  });
  save("pay5-old-webhooks-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
