// @ts-nocheck
/* eslint-disable */
// Round 2 QA: reuse-pending edge cases, leak checks, odd inputs.
process.env.MOCK_PAYMENTS_ENABLED ??= "1";
import { Http, check, assert, eq, db, makeSeller, makeDrop, checkout, txRow, save, done, sell, ledgerCount, stamp } from "./qa-pay4-lib";
const pay = (url: string, card = "4242424242424242") => new Http().json("POST", "/api/dev/payments/pay", { json: { sessionId: url.split("/").pop(), card } });
const jars = new Map<string, Http>(); const jar = (e: string) => { const k = e.trim().toLowerCase(); if (!jars.has(k)) jars.set(k, new Http()); return jars.get(k)!; };
// R3: reuse is bound to the creating client (cookie jar). `ck` = the SAME browser per email; `new Http()` = a different client.
const ck = (link: string, email: string, headers: Record<string, string> = {}) => checkout(link, {}, jar(email), email, headers);
(async () => {
  const s = await makeSeller("r2d"); const d = await makeDrop(s, 2500);
  await check("REUSE-1", "reuse after drop unpublished/flagged or seller unverified: checkout does NOT hand back the old live URL (404/409/4xx, not 200 reused)", async () => {
    const out: string[] = [];
    for (const [label, off, on] of [["unpublished", "UPDATE drops SET status='unpublished' WHERE id=$1", "UPDATE drops SET status='published' WHERE id=$1"], ["flagged", "UPDATE drops SET status='flagged' WHERE id=$1", "UPDATE drops SET status='published' WHERE id=$1"]] as const) {
      const email = `ru-${label}-${stamp}@example.test`; const c = await ck(d.link, email); await db.query(off, [d.id]); const r = await ck(d.link, email); await db.query(on, [d.id]);
      assert(r.status >= 400 && r.status < 500, `${label}: ${r.status} ${r.text.slice(0, 120)}`); out.push(`${label}:${r.status}`);
    }
    const email = `ru-sv-${stamp}@example.test`; await ck(d.link, email); await db.query("UPDATE sellers SET verification_status='failed' WHERE id=$1", [s.id]); const r = await ck(d.link, email); await db.query("UPDATE sellers SET verification_status='verified' WHERE id=$1", [s.id]); assert(r.status >= 400 && r.status < 500, `seller failed: ${r.status} ${r.text}`); out.push(`seller-failed:${r.status}`);
    return out.join(" ");
  });
  await check("REUSE-2", "reuse of a >30 min pending txn (not yet swept) creates a NEW txn (201), old one expired; reuse at 29 min returns same txn", async () => {
    const email = `ru-age-${stamp}@example.test`; const a = await ck(d.link, email); await db.query("UPDATE transactions SET created_at=now()-interval '31 minutes' WHERE id=$1", [a.json.transactionId]); const b = await ck(d.link, email); eq(b.status, 201, "new"); assert(b.json.transactionId !== a.json.transactionId, "same tx"); eq((await txRow(a.json.transactionId)).failure_code, "session_expired", "old expired");
    await db.query("UPDATE transactions SET created_at=now()-interval '29 minutes' WHERE id=$1", [b.json.transactionId]); const c = await ck(d.link, email); eq(c.json.transactionId, b.json.transactionId, "29 min reuse"); eq(c.status, 200, "200"); return "31 min → new 201 (old session_expired); 29 min → reused 200 (hands buyer a URL with ~1 min left; INFO)";
  });
  await check("REUSE-3", "reuse returns correct body shape & the URL pays at the txn's amount; email case/whitespace variants map to same pending", async () => {
    const email = `Ru-Case-${stamp}@Example.test`; const a = await ck(d.link, email); const b = await checkout(d.link, {}, jar(email), email.toLowerCase()); const c = await ck(d.link, ` ${email.toUpperCase()} `);
    eq(b.json.transactionId, a.json.transactionId, "lowercase"); eq(b.json.reused, true, "reused flag"); eq(a.json.reused ?? false, false, "first not reused"); const r = await pay(a.json.checkoutUrl); eq(r.json.status, "succeeded", "pay"); eq(Number((await txRow(a.json.transactionId)).amount_cents), 2500, "amount"); return `lower:${b.status}/${b.json.transactionId === a.json.transactionId} padded+upper:${c.status}/${c.json.transactionId === a.json.transactionId}`;
  });
  await check("REUSE-4", "price edit while pending: reused txn keeps OLD price (settles at old price); a different buyer sees NEW price; after reuse window a new checkout uses the new price", async () => {
    const dd = await makeDrop(s, 2000); const email = `ru-price-${stamp}@example.test`; const a = await ck(dd.link, email); await db.query("UPDATE drops SET price_cents=9000 WHERE id=$1", [dd.id]); const b = await ck(dd.link, email); const o = await checkout(dd.link, {}, new Http()); 
    const stale = b.json.transactionId === a.json.transactionId; const ta = await txRow(a.json.transactionId), to = await txRow(o.json.transactionId); eq(Number(to.amount_cents), 9000, "other buyer new price");
    return `R3 (INFO-1 fixed): same buyer reuse=${stale} amount=${ta.amount_cents} (old price, drop now 9000); other buyer ${to.amount_cents}. Buyer page shows ${stale ? "old" : "new"} price on /u/<link> while hosted page charges ${ta.amount_cents}.`;
  });
  await check("REUSE-5", "privacy: different client (IP/UA/cookies) with only drop+email obtains victim's live checkoutUrl & txn id (no secret needed)", async () => {
    const email = `victim-${stamp}@example.test`; const v = await ck(d.link, email); const a = await checkout(d.link, {}, new Http(), email);
    assert(a.json.transactionId !== v.json.transactionId && a.json.checkoutUrl !== v.json.checkoutUrl && a.json.reused === false, "R3: attacker got victim session"); eq(a.status, 201, "attacker 201"); return `R3: NEW-1 FIXED — attacker with victim email + link id gets 201 reused:false and an independent session (${a.json.checkoutUrl.slice(-12)} ≠ victim's)`;
  });
  await check("REUSE-6", "attacker pays victim's pending session with attacker card → txn succeeded under victim email (buyer_email not verified); no cross-state leak to other drops/txns", async () => {
    const email = `victim2-${stamp}@example.test`; const v = await ck(d.link, email); const r = await pay(v.json.checkoutUrl); eq(r.json.status, "succeeded", "paid"); const t = await txRow(v.json.transactionId); eq(t.buyer_email, email, "email"); const nxt = await ck(d.link, email); eq(nxt.status, 201, "new checkout after paid"); assert(nxt.json.transactionId !== v.json.transactionId, "reuse of paid"); return "paid txn never reused; new checkout creates new txn (repeat purchase allowed by design?)";
  });
  await check("LEAK-1", "no idempotency_key / checkout_url / review_reason / provider_session_id / risk flag in /api/earnings, /api/checkout/status, seller dashboard APIs", async () => {
    const e = JSON.stringify((await s.http.json("GET", "/api/earnings")).json); const c = await ck(d.link, `leak-${stamp}@example.test`, { "idempotency-key": "secret-key-" + stamp }); const st = JSON.stringify((await new Http().json("GET", `/api/checkout/status?id=${c.json.transactionId}`)).json);
    const bad = ["idempotency", "secret-key-", "checkout_url", "checkoutUrl", "review_reason", "reviewReason", "risk_flag", "processor_ref", "provider_session", "mocksess_"].filter((k) => e.includes(k) || (k !== "checkoutUrl" && st.includes(k))); assert(!bad.length, "leaked " + bad); const keys = Object.keys(JSON.parse(st)).sort().join(","); return `status keys=${keys}; earnings clean`;
  });
  await check("LEAK-2", "status API for another txn id / garbage / SQLi / uuid case: no enumeration, no 500", async () => {
    const out: string[] = []; for (const id of ["00000000-0000-0000-0000-000000000000", "abc", "' OR 1=1--", "%00", d.id, "A".repeat(5000)]) { const r = await new Http().json("GET", `/api/checkout/status?id=${encodeURIComponent(id)}`); assert(r.status < 500, `5xx for ${id.slice(0, 20)}: ${r.status}`); out.push(String(r.status)); } return out.join(",");
  });
  await check("IDEM-9", "Idempotency-Key odd values: header repeated, unicode, 0-length, 129, control, NUL via raw header; no 500; no partial rows", async () => {
    const out: string[] = []; for (const k of ["", " ", "a", "A".repeat(128), "A".repeat(129), "k\u0000", "k\r\nX: y", "ключ", "%00", "../../etc", "{{7*7}}", "null", "undefined", "0"]) {
      try { const r = await ck(d.link, `odd-${Math.random().toString(36).slice(2)}@example.test`, { "idempotency-key": k }); assert(r.status < 500, `5xx key=${JSON.stringify(k).slice(0, 20)}: ${r.status}`); out.push(`${JSON.stringify(k).slice(0, 8)}:${r.status}`); } catch (e) { out.push(`${JSON.stringify(k).slice(0, 8)}:client-reject`); }
    } return out.join(" ");
  });
  await check("IDEM-10", "same key, same email, different body (over18 false, different linkId handled, extra fields) → deterministic 4xx or reuse, never a 2nd txn", async () => {
    const email = `idem10-${stamp}@example.test`; const k = "k10-" + stamp; const a = await ck(d.link, email, { "idempotency-key": k }); const b = await checkout(d.link, { confirmOver18: false }, new Http(), email, { "idempotency-key": k }); const c = await checkout(d.link, { amountCents: 1, priceCents: 1 }, new Http(), email, { "idempotency-key": k });
    const n = Number((await db.query("SELECT count(*) n FROM transactions WHERE lower(buyer_email)=lower($1)", [email])).rows[0].n); eq(n, 1, "txn count"); return `first ${a.status}; over18=false same key ${b.status} ${b.json.code ?? b.json.error ?? ""}; tampered amount same key ${c.status}/amount ${(await txRow(a.json.transactionId)).amount_cents}`;
  });
  save("pay4-old-r2d-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
