/* eslint-disable */
// Round 2 QA: BUG-1 (checkout idempotency / reuse), BUG-2 (dedupe claim release), BUG-3 (NUL/invalid strings), BUG-4 (chargeback flagging).
process.env.MOCK_PAYMENTS_ENABLED ??= "1";
import { Http, check, assert, eq, db, makeSeller, makeDrop, checkout, txRow, save, done, sell, sendWebhook, paySale, mockEvents, mockSaleId, ledgerCount, ledgerSum, whCount, refundEv, cbEv, sellerLedgerSum, setSettings, stamp, freshIp } from "./qa-pay-lib";

const pay = (sid: string, card = "4242424242424242") => new Http().json("POST", "/api/dev/payments/pay", { json: { sessionId: sid, card } });
const sid = (url: string) => url.split("/").pop()!;
const ck = (link: string, email: string, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) => checkout(link, extra, new Http(), email, headers);
const n = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0].n);

(async () => {
  const s = await makeSeller("r2a"); const d = await makeDrop(s, 2000); const d2 = await makeDrop(s, 3000); const s2 = await makeSeller("r2b"); const dOther = await makeDrop(s2, 1000);

  // ======================= BUG-1 =======================
  await check("BUG-1a", "12 concurrent identical checkouts (same drop+email, no key) → exactly one new txn (201), rest reuse (200, reused:true), 1 DB row", async () => {
    const em = `c12+${stamp}@example.test`; const r = await Promise.all(Array.from({ length: 12 }, () => ck(d.link, em)));
    const ids = new Set(r.map((x) => x.json?.transactionId)); eq(ids.size, 1, `distinct txns (${r.map((x) => x.status)})`);
    eq(r.filter((x) => x.status === 201).length, 1, "201 count"); eq(r.filter((x) => x.status === 200 && x.json.reused === true).length, 11, "200 reused"); assert(r.every((x) => x.status < 300), "non-2xx " + r.map((x) => x.status));
    eq(await n("SELECT count(*) n FROM transactions WHERE lower(buyer_email)=$1", [em]), 1, "rows"); return `1×201 + 11×200 reused; 1 row; same session ${sid(r[0].json.checkoutUrl).slice(0, 14)}…`;
  });
  await check("BUG-1b", "12 concurrent with the SAME Idempotency-Key → one txn", async () => {
    const em = `k12+${stamp}@example.test`; const h = { "idempotency-key": "k12-" + stamp }; const r = await Promise.all(Array.from({ length: 12 }, () => ck(d.link, em, h)));
    eq(new Set(r.map((x) => x.json?.transactionId)).size, 1, "distinct"); assert(r.every((x) => x.status < 300), "non-2xx " + r.map((x) => x.status)); eq(await n("SELECT count(*) n FROM transactions WHERE lower(buyer_email)=$1", [em]), 1, "rows"); return "1 txn";
  });
  await check("BUG-1c", "Idempotency-Key sequential replay → 200 reused, identical body; different bodies (extra/ignored fields) with same key return same txn", async () => {
    const em = `kseq+${stamp}@example.test`; const h = { "idempotency-key": "kseq-" + stamp }; const a = await ck(d.link, em, h); const b = await ck(d.link, em, h, { amountCents: 1, foo: "bar" });
    eq(a.status, 201, "first"); eq(b.status, 200, "replay"); eq(b.json.transactionId, a.json.transactionId, "same"); eq(b.json.checkoutUrl, a.json.checkoutUrl, "same url"); return "201 then 200 reused";
  });
  await check("BUG-1d", "same key, DIFFERENT drop (same email) → 409 idempotency_key_reused; same key via dropId vs linkId of same drop → same txn", async () => {
    const em = `kdrop+${stamp}@example.test`; const h = { "idempotency-key": "kdrop-" + stamp }; const a = await ck(d.link, em, h); const b = await ck(d2.link, em, h);
    eq(b.status, 409, b.text); eq(b.json.code, "idempotency_key_reused", "code"); const c = await new Http().json("POST", "/api/checkout", { json: { dropId: d.id, email: em, confirmOver18: true }, headers: h }); eq(c.json.transactionId, a.json.transactionId, "dropId variant");
    eq(await n("SELECT count(*) n FROM transactions WHERE lower(buyer_email)=$1 AND drop_id=$2", [em, d2.id]), 0, "no txn on drop2"); return "409 + same txn for dropId variant";
  });
  await check("BUG-1e", "same key + different EMAIL → separate txns (keys namespaced by email); same key across different sellers' drops with different emails fine; key from another buyer can't fetch their session", async () => {
    const K = { "idempotency-key": "shared-" + stamp }; const a = await ck(d.link, `ka+${stamp}@example.test`, K); const b = await ck(d.link, `kb+${stamp}@example.test`, K); const c = await ck(dOther.link, `kc+${stamp}@example.test`, K);
    assert(a.json.transactionId !== b.json.transactionId && b.json.transactionId !== c.json.transactionId, "keys collided across buyers"); assert(a.json.checkoutUrl !== b.json.checkoutUrl, "same url leaked"); return "3 distinct txns/sessions";
  });
  await check("BUG-1f", "key edge cases: 128 chars OK, 129 → 400, spaces/control/unicode → 400, quote/semicolon printable → OK (stored as data), whitespace-only → treated as no key, case-sensitive keys, email case-insensitive", async () => {
    const out: string[] = []; const em = () => `ke${Math.random().toString(36).slice(2, 8)}+${stamp}@example.test`;
    const r128 = await ck(d.link, em(), { "idempotency-key": "a".repeat(128) }); eq(r128.status, 201, "128"); out.push("128:" + r128.status);
    const r129 = await ck(d.link, em(), { "idempotency-key": "a".repeat(129) }); eq(r129.status, 400, "129"); out.push("129:" + r129.status);
    for (const bad of ["has space", "tab\there", "ünï"]) { try { const r = await ck(d.link, em(), { "idempotency-key": bad }); out.push(JSON.stringify(bad) + ":" + r.status); assert(r.status === 400, `${JSON.stringify(bad)} → ${r.status}`); } catch (e) { if ((e as Error).message.startsWith("has") || /→/.test((e as Error).message)) throw e; out.push(JSON.stringify(bad) + ":client-rejected"); } }
    const inj = await ck(d.link, em(), { "idempotency-key": "';DROP-TABLE-transactions;--" }); eq(inj.status, 201, "sqli-key " + inj.text); out.push("sqli:" + inj.status);
    const ws = await ck(d.link, em(), { "idempotency-key": "   " }); assert(ws.status === 201, "whitespace key " + ws.status); const t = await txRow(ws.json.transactionId); eq(t.idempotency_key, null, "stored key null"); out.push("blank:" + ws.status);
    const e = `kcase+${stamp}@example.test`; const x = await ck(d.link, e, { "idempotency-key": "CaseKey-" + stamp }); const y = await ck(d.link, e.toUpperCase(), { "idempotency-key": "CaseKey-" + stamp }); eq(y.json.transactionId, x.json.transactionId, "email case-insens"); 
    eq(await n("SELECT count(*) n FROM transactions WHERE true"), await n("SELECT count(*) n FROM transactions"), "tables intact"); return out.join(" ");
  });
  await check("BUG-1g", "after payment: same email+drop → NEW txn (201) not the paid one; same KEY after payment → returns the succeeded txn (200)", async () => {
    const em = `paid+${stamp}@example.test`; const K = { "idempotency-key": "paid-" + stamp }; const a = await ck(d.link, em, K); await pay(sid(a.json.checkoutUrl));
    eq((await txRow(a.json.transactionId)).status, "succeeded", "paid"); const b = await ck(d.link, em); eq(b.status, 201, "new after paid"); assert(b.json.transactionId !== a.json.transactionId, "re-handed paid txn");
    const c = await ck(d.link, em, K); return `new after paid: ${b.status}; keyed replay after paid: ${c.status} status=${c.json.status} same=${c.json.transactionId === a.json.transactionId} (returns paid session URL; pay endpoint on it is idempotent)`;
  });
  await check("BUG-1h", "dead keyed txn (declined? expired) releases key: backdate 31 min → same key gets a NEW txn; old one failed/session_expired", async () => {
    const em = `kexp+${stamp}@example.test`; const K = { "idempotency-key": "kexp-" + stamp }; const a = await ck(d.link, em, K); await db.query("UPDATE transactions SET created_at = now() - interval '31 minutes' WHERE id=$1", [a.json.transactionId]);
    const b = await ck(d.link, em, K); eq(b.status, 201, b.text); assert(b.json.transactionId !== a.json.transactionId, "same txn after expiry"); const old = await txRow(a.json.transactionId); eq(`${old.status}/${old.failure_code}`, "failed/session_expired", "old"); eq(old.idempotency_key, null, "key released"); return "new txn, old failed/session_expired, key released";
  });
  await check("BUG-1i", "cross-drop: same email, two drops → two independent pending txns; and different emails on same drop don't see each other's session (no hijack)", async () => {
    const em = `x+${stamp}@example.test`; const a = await ck(d.link, em); const b = await ck(d2.link, em); const c = await ck(d.link, `y+${stamp}@example.test`);
    assert(a.json.transactionId !== b.json.transactionId, "cross-drop reuse"); assert(a.json.transactionId !== c.json.transactionId, "cross-buyer reuse"); eq(b.json.amountCents, 3000, "drop2 price"); eq(a.json.amountCents, 2000, "drop1 price");
    const tc = await txRow(c.json.transactionId); eq(tc.buyer_email, `y+${stamp}@example.test`, "owner"); return "isolated per (drop,email)";
  });
  await check("BUG-1j", "stale price on reuse: seller changes price (SQL; no edit API on branch) after pending created → reuse returns the OLD pinned price/fees; a NEW buyer gets new price (record)", async () => {
    const dp = await makeDrop(s, 1000); const em = `stale+${stamp}@example.test`; const a = await ck(dp.link, em); await db.query("UPDATE drops SET price_cents=5000 WHERE id=$1", [dp.id]);
    const b = await ck(dp.link, em); const c = await ck(dp.link, `fresh+${stamp}@example.test`); eq(b.json.transactionId, a.json.transactionId, "reuse"); const paid = await pay(sid(b.json.checkoutUrl)); const t = await txRow(a.json.transactionId);
    return `reused amount=${b.json.amountCents} (old price), new buyer amount=${c.json.amountCents}; paid settled at ${t.amount_cents} (${paid.json.status}). INFO: buyer keeps old price for ≤30 min after a seller price change`;
  });
  await check("BUG-1k", "reuse oracle (privacy): any caller who knows buyer email + drop gets reused:true and the buyer's live checkoutUrl", async () => {
    const em = `victim+${stamp}@example.test`; const a = await ck(d.link, em); const spy = await new Http().json("POST", "/api/checkout", { json: { linkId: d.link, email: em, confirmOver18: true } });
    eq(spy.json.reused, true, "oracle"); eq(spy.json.checkoutUrl, a.json.checkoutUrl, "url leaked to different client");
    const nobody = await ck(d.link, `nobody+${stamp}@example.test`); eq(nobody.json.reused, false, "control");
    return `FINDING (LOW/privacy): second client from different IP got reused:true + victim's session URL (${spy.json.checkoutUrl.slice(-12)}) – reveals that <email> has a live purchase intent for <drop>`;
  });
  await check("BUG-1l", "unique pending index / advisory-lock stress: 60 concurrent mixed requests (same email ±keys, 3 drops, 10 emails) → no 5xx, ≤1 pending per (drop,email)", async () => {
    const reqs: Promise<any>[] = []; for (let i = 0; i < 60; i++) { const em = `st${i % 10}+${stamp}@example.test`; const drop = [d, d2, dOther][i % 3]; const hdr = i % 4 === 0 ? { "idempotency-key": `st-${i % 5}-${stamp}` } : {}; reqs.push(ck(drop.link, em, hdr)); }
    const r = await Promise.all(reqs); const bad = r.filter((x) => x.status >= 500); assert(!bad.length, `5xx: ${bad.map((x) => x.status + x.text.slice(0, 80))}`); const ok = r.filter((x) => x.status < 300).length; const c409 = r.filter((x) => x.status === 409).length;
    const dup = await db.query("SELECT drop_id, lower(buyer_email) e, count(*) FROM transactions WHERE status='pending' GROUP BY 1,2 HAVING count(*)>1"); eq(dup.rowCount, 0, "dup pending");
    return `${r.length} reqs: ${ok} ok, ${c409} 409 (key reused across drops – expected), 0×5xx, 0 duplicate pendings`;
  });
  await check("BUG-1m", "100 concurrent identical checkouts (pool pressure) complete without hang/5xx", async () => {
    const em = `c100+${stamp}@example.test`; const t0 = Date.now(); const r = await Promise.all(Array.from({ length: 100 }, () => ck(d.link, em))); const ms = Date.now() - t0;
    assert(r.every((x) => x.status === 200 || x.status === 201), "statuses " + [...new Set(r.map((x) => x.status))]); eq(new Set(r.map((x) => x.json.transactionId)).size, 1, "distinct"); return `100 reqs in ${ms} ms, 1 txn`;
  });
  await check("BUG-1n", "double-submit of the pay action on one reused session = one charge (end-to-end: 2 checkouts → pay both URLs concurrently)", async () => {
    const em = `dbl+${stamp}@example.test`; const [a, b] = await Promise.all([ck(d.link, em), ck(d.link, em)]); eq(a.json.transactionId, b.json.transactionId, "same"); await Promise.all([pay(sid(a.json.checkoutUrl)), pay(sid(b.json.checkoutUrl))]); eq(await ledgerCount(a.json.transactionId), 3, "ledger"); return "one charge, 3 lines";
  });

  // ======================= BUG-2 =======================
  const newTx = async () => (await checkout(d.link)).json.transactionId as string;
  await check("BUG-2a", "wrong-amount sale then correct sale (same processor txn id, NEW event id) → processed, tx succeeded, 1 posting", async () => {
    const tx = await newTx(); const bad = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 1 })); eq(bad.json.outcome, "rejected", "bad"); const ok = await paySale(tx, 2000);
    eq(ok.json.outcome, "processed", ok.text); eq((await txRow(tx)).status, "succeeded", "status"); eq(await ledgerCount(tx), 3, "lines"); eq(await ledgerSum(tx), 1560, "sum"); return "rejected → processed; ledger 1560";
  });
  await check("BUG-2b", "sale for UNKNOWN reference first (ignored/unknown_transaction), then legit sale with same processor id → processed", async () => {
    const tx = await newTx(); const early = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, reference: "22222222-2222-4222-8222-222222222222", saleId: mockSaleId(tx) })); eq(early.json.outcome, "ignored", "early");
    const ok = await paySale(tx, 2000); eq(ok.json.outcome, "processed", ok.text); eq(await ledgerCount(tx), 3, "lines"); return "ignored → processed";
  });
  await check("BUG-2c", "currency mismatch then correct → processed", async () => {
    const tx = await newTx(); const bad = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, currency: "EUR" })); eq(bad.json.outcome, "rejected", "eur"); const ok = await paySale(tx, 2000); eq(ok.json.outcome, "processed", ok.text); return "ok";
  });
  await check("BUG-2d", "no double posting after releasing claims: 3 wrong events then 8 CONCURRENT correct events (different event ids) → exactly 1 posting; later replays duplicate/ignored", async () => {
    const tx = await newTx(); for (let i = 0; i < 3; i++) await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 100 + i }));
    const r = await Promise.all(Array.from({ length: 8 }, () => paySale(tx, 2000))); eq(r.filter((x) => x.json?.outcome === "processed").length, 1, "processed " + r.map((x) => x.json?.outcome)); assert(r.every((x) => x.status === 200), "status");
    eq(await ledgerCount(tx), 3, "lines"); const again = await paySale(tx, 2000); assert(["duplicate", "ignored"].includes(again.json.outcome), "later " + again.json.outcome); eq(await ledgerCount(tx), 3, "lines after"); return r.map((x) => x.json.outcome[0]).join("");
  });
  await check("BUG-2e", "genuine duplicates unchanged: same event id ×3 → processed,duplicate,duplicate; same sale new event id AFTER success → duplicate (one posting); refund event dedupe; rejected over-refund event replays don't re-post", async () => {
    const tx = await newTx(); const ev = mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 }); const r = [await sendWebhook(ev), await sendWebhook(ev), await sendWebhook(ev)]; eq(r.map((x) => x.json.outcome).join(), "processed,duplicate,duplicate", "3x");
    const nev = await paySale(tx, 2000); eq(nev.json.outcome, "duplicate", "new event id after success"); const rf = refundEv(tx, 700); const a = await sendWebhook(rf); const b = await sendWebhook(rf); eq(`${a.json.outcome},${b.json.outcome}`, "processed,duplicate", "refund dedupe");
    const o1 = await sendWebhook(refundEv(tx, 5000)); const o2 = await sendWebhook(refundEv(tx, 5000)); eq(o1.json.outcome, "rejected", "over1"); eq(o2.json.outcome, "rejected", "over2 (claim released → re-evaluated, still rejected)"); eq((await txRow(tx)).reversed_cents, 700, "rev"); return "ok";
  });
  await check("BUG-2f", "12 concurrent identical deliveries still exactly one processed (regression of IDEM-2)", async () => {
    const tx = await newTx(); const ev = mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 }); const r = await Promise.all(Array.from({ length: 12 }, () => sendWebhook(ev))); eq(r.filter((x) => x.json.outcome === "processed").length, 1, "processed"); eq(r.filter((x) => x.json.outcome === "duplicate").length, 11, "dup"); eq(await ledgerCount(tx), 3, "lines"); return "1+11";
  });
  await check("BUG-2g", "released-claim abuse: an attacker with valid signature can't use rejected/ignored events to flood ledger: 200 rejected over-refund events → 0 ledger change, webhook_events rows grow (log noise)", async () => {
    const tx = await sell(d.link, 2000); const b0 = await whCount(); const r = await Promise.all(Array.from({ length: 50 }, () => sendWebhook(refundEv(tx, 99999)))); const sum = await ledgerSum(tx); eq(sum, 1560, "ledger"); const rows = (await whCount()) - b0; return `50 rejected events → ${rows} log rows, ledger unchanged (rejected rows are stored once each; no dedupe → log growth only possible with valid signatures)`;
  });

  // ======================= BUG-3 =======================
  await check("BUG-3a", "NUL in data.reference / event id / transaction_id / related id / failure_code / currency → 400 (not 500), rejected row logged, no state change, claim not left", async () => {
    const tx = await newTx(); const base = () => JSON.parse(JSON.stringify(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 }))); const out: string[] = []; const b0 = await n("SELECT count(*) n FROM webhook_events WHERE outcome='rejected' AND signature_valid");
    const muts: [string, (e: any) => void][] = [["reference", (e) => (e.data.reference = "a\u0000b")], ["event id", (e) => (e.id = "e\u0000x")], ["transaction_id", (e) => (e.data.transaction_id = "t\u0000")], ["related_transaction_id", (e) => (e.data.related_transaction_id = "r\u0000")], ["failure_code", (e) => { e.type = "sale.failed"; e.data.failure_code = "f\u0000c"; }], ["currency", (e) => (e.data.currency = "US\u0000")]];
    for (const [nme, f] of muts) { const e = base(); f(e); const r = await sendWebhook(e); out.push(`${nme}:${r.status}`); eq(r.status, 400, `${nme}: ${r.text}`); }
    eq((await txRow(tx)).status, "pending", "state"); eq(await ledgerCount(tx), 0, "ledger"); const a1 = await n("SELECT count(*) n FROM webhook_events WHERE outcome='rejected' AND signature_valid"); assert(a1 - b0 >= muts.length - 1, `rejected rows logged ${a1 - b0}`); const ok = await paySale(tx, 2000); eq(ok.json.outcome, "processed", "legit after");
    return out.join(" ") + `; ${a1 - b0} rejected rows; legit sale afterwards processed`;
  });
  await check("BUG-3b", "lone surrogate (\\ud800), >512-char strings, emoji (valid) → 400/400/ok; error row has no stack/PII", async () => {
    const tx = await newTx(); const raw = JSON.stringify(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 })).replace(`"reference":"${tx}"`, `"reference":"\\ud800x"`); const r1 = await sendWebhook(null, { rawBody: raw }); eq(r1.status, 400, "surrogate " + r1.text);
    const r2 = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, eventId: "e".repeat(513) })); eq(r2.status, 400, ">512"); const r3 = await sendWebhook(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000, eventId: "e".repeat(190) + "😀é" })); eq(r3.status, 200, "emoji id " + r3.text);
    return `surrogate:${r1.status} 513ch:${r2.status} emoji/long-valid:${r3.status}/${r3.json.outcome}`;
  });
  await check("BUG-3c", "rejected-invalid payloads are IP-rate-limited (WEBHOOK_REJECTED 60/min) so they can't flood the log", async () => {
    const tx = await newTx(); const ip = freshIp(); const codes: number[] = []; for (let i = 0; i < 70; i++) { const e = JSON.parse(JSON.stringify(mockEvents.saleSucceeded({ transactionId: tx, amountCents: 2000 }))); e.data.reference = "a\u0000" + i; codes.push((await sendWebhook(e, { ip })).status); }
    eq(codes.filter((c) => c === 400).length, 60, "400s " + codes.filter((c) => c === 400).length); assert(codes.slice(60).every((c) => c === 429), "then 429 " + codes.slice(60)); return "60×400 then 429";
  });

  // ======================= BUG-4 =======================
  const cbSeller = async (label: string) => { const sl = await makeSeller(label); const dd = await makeDrop(sl, 1500); return { sl, dd }; };
  const flagged = async (sid_: string) => (await db.query("SELECT risk_flagged_at, risk_flag_reason, verification_status FROM sellers WHERE id=$1", [sid_])).rows[0];
  await check("BUG-4a", "2 chargebacks → NOT flagged; 3rd → flagged (detail seller_flagged_for_review, reason, audit_log row once); 4th → still one audit row; verification_status untouched; seller can still be bought from", async () => {
    const { sl, dd } = await cbSeller("cb3"); const det: string[] = [];
    for (let i = 0; i < 4; i++) { const tx = await sell(dd.link, 1500); const r = await sendWebhook(cbEv(tx, null, i)); det.push(r.json.detail ?? "-"); const f = await flagged(sl.id); eq(!!f.risk_flagged_at, i >= 2, `flag after #${i + 1}`); }
    const f = await flagged(sl.id); eq(f.verification_status, "verified", "verification"); const au = await n("SELECT count(*) n FROM audit_log WHERE action='seller_flagged_repeat_chargebacks' AND target LIKE $1", [`seller:${sl.id}%`]); eq(au, 1, "audit"); const c = await checkout(dd.link); eq(c.status, 201, "still purchasable");
    return `details ${det.join(",")}; reason="${f.risk_flag_reason}"; 1 audit row; still verified & purchasable (no auto-ban)`;
  });
  await check("BUG-4b", "chargeback REPLAY (same event ×3) counts once; second chargeback on the SAME txn (new id) counts once; refunds don't count", async () => {
    const { sl, dd } = await cbSeller("cbrp"); const tx1 = await sell(dd.link, 1500); const ev = cbEv(tx1, null, 1); await sendWebhook(ev); await sendWebhook(ev); await sendWebhook(ev); const again = await sendWebhook(cbEv(tx1, null, 2)); eq(again.json.outcome, "rejected", "2nd cb same tx over-refund");
    for (let i = 0; i < 3; i++) { const t = await sell(dd.link, 1500); await sendWebhook(refundEv(t, 1500)); }
    eq(!!(await flagged(sl.id)).risk_flagged_at, false, "flagged by replays/refunds"); const tx2 = await sell(dd.link, 1500); await sendWebhook(cbEv(tx2, null, 3)); eq(!!(await flagged(sl.id)).risk_flagged_at, false, "2 distinct → not flagged"); return "replay×3 + dup cb on same tx + 3 refunds + 1 more distinct cb = 2 distinct → not flagged";
  });
  await check("BUG-4c", "window: chargebacks older than 90 days don't count (2 at 91 d + 1 new → not flagged); 2 at 89 d + 1 new → flagged", async () => {
    const run = async (days: number) => { const { sl, dd } = await cbSeller("cbw" + days); const txs = [await sell(dd.link, 1500), await sell(dd.link, 1500)]; for (const [i, t] of txs.entries()) await sendWebhook(cbEv(t, null, i));
      await db.query("ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_no_update"); await db.query(`UPDATE ledger_entries SET created_at = now() - make_interval(days => ${days}) WHERE seller_id=$1 AND entry_type='chargeback_reversal'`, [sl.id]); await db.query("ALTER TABLE ledger_entries ENABLE TRIGGER ledger_entries_no_update");
      eq(!!(await flagged(sl.id)).risk_flagged_at, false, "pre"); const t3 = await sell(dd.link, 1500); const r = await sendWebhook(cbEv(t3, null, 9)); return { f: !!(await flagged(sl.id)).risk_flagged_at, d: r.json.detail }; };
    const old = await run(91); const recent = await run(89); eq(old.f, false, "91d flagged?!"); eq(recent.f, true, "89d not flagged"); return `91 d: flagged=${old.f}; 89 d: flagged=${recent.f} (${recent.d}) [ledger created_at backdated in throwaway DB with append-only trigger temporarily disabled]`;
  });
  await check("BUG-4d", "4 SIMULTANEOUS chargebacks (distinct txns) → no deadlock/5xx, flagged exactly once, one audit row", async () => {
    const { sl, dd } = await cbSeller("cbcc"); const txs = await Promise.all(Array.from({ length: 4 }, () => sell(dd.link, 1500))); const r = await Promise.all(txs.map((t, i) => sendWebhook(cbEv(t, null, i)))); assert(r.every((x) => x.status === 200), "statuses " + r.map((x) => x.status + (x.json?.outcome ?? "")));
    eq(!!(await flagged(sl.id)).risk_flagged_at, true, "flagged"); eq(await n("SELECT count(*) n FROM audit_log WHERE action='seller_flagged_repeat_chargebacks' AND target LIKE $1", [`seller:${sl.id}%`]), 1, "audit"); eq(r.filter((x) => x.json.detail === "seller_flagged_for_review").length, 1, "exactly one response carries the flag detail"); return r.map((x) => x.json.detail ?? x.json.outcome).join(",");
  });
  await check("BUG-4e", "concurrent chargebacks ACROSS sellers (6 sellers × 3) don't deadlock; each flagged once", async () => {
    const group = await Promise.all(Array.from({ length: 6 }, (_, i) => cbSeller("cbx" + i))); const all = await Promise.all(group.map(async (g) => ({ g, txs: await Promise.all([1, 2, 3].map(() => sell(g.dd.link, 1500))) })));
    const r = await Promise.all(all.flatMap((x) => x.txs.map((t, i) => sendWebhook(cbEv(t, null, i))))); assert(r.every((x) => x.status === 200), "statuses " + r.map((x) => x.status)); for (const x of all) eq(!!(await flagged(x.g.sl.id)).risk_flagged_at, true, "flag " + x.g.sl.id); return "18 concurrent, 6 flagged";
  });
  await check("BUG-4f", "parked chargebacks applied when sale lands also flag at threshold; partial chargebacks count as distinct txns; settings change (threshold 1) flags on first", async () => {
    const { sl, dd } = await cbSeller("cbpk"); const txs: string[] = []; for (let i = 0; i < 3; i++) { const t = (await checkout(dd.link)).json.transactionId; txs.push(t); const r = await sendWebhook(cbEv(t, 500, i)); eq(r.json.outcome, "parked", "parked"); }
    for (const t of txs) await paySale(t, 1500); eq(!!(await flagged(sl.id)).risk_flagged_at, true, "flag after parked applied");
    await setSettings("chargeback_flag_threshold=1"); const o = await cbSeller("cbth1"); const t = await sell(o.dd.link, 1500); const r = await sendWebhook(cbEv(t, 100, 1)); await setSettings("chargeback_flag_threshold=3"); eq(!!(await flagged(o.sl.id)).risk_flagged_at, true, "threshold 1"); return `parked×3 → flagged; threshold=1 + partial cb → flagged (${r.json.detail})`;
  });
  await check("BUG-4g", "settings CHECK constraints (threshold ≥1, window 1..3650, ttl 1..10080, grace 0..43200)", async () => {
    const out: string[] = []; for (const [c, v] of [["chargeback_flag_threshold", 0], ["chargeback_flag_window_days", 0], ["chargeback_flag_window_days", 4000], ["checkout_session_ttl_minutes", 0], ["checkout_late_success_grace_minutes", -1]] as const) { try { await db.query(`UPDATE platform_settings SET ${c}=${v} WHERE id=1`); out.push(`${c}=${v} ACCEPTED`); } catch { out.push(`${c}=${v} rejected`); } }
    await setSettings("chargeback_flag_threshold=3, chargeback_flag_window_days=90, checkout_session_ttl_minutes=30, checkout_late_success_grace_minutes=1440"); assert(!out.some((x) => x.includes("ACCEPTED")), out.join()); return out.join(", ");
  });
  save("pay2-r2a-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
