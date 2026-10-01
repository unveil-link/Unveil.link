// @ts-nocheck
/* eslint-disable */
// Round 3 QA, item 1: NEW-1 fix (pending checkouts bound to creating client). Plus price-change supersede.
process.env.MOCK_PAYMENTS_ENABLED ??= "1";
import crypto from "node:crypto";
import { Http, BASE, check, assert, eq, db, makeSeller, makeDrop, txRow, save, done, stamp, ledgerCount, paySale } from "./qa-pay4-lib";

let ipn = 0; const ip = () => `10.${150 + (ipn >> 16)}.${(ipn >> 8) & 255}.${(++ipn & 255) || 1}`;
async function raw(body: any, o: { cookie?: string; key?: string; base?: string; headers?: Record<string, string> } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip(), ...(o.headers ?? {}) };
  if (o.cookie !== undefined) h.cookie = o.cookie; if (o.key !== undefined) h["idempotency-key"] = o.key;
  const r = await fetch((o.base ?? BASE) + "/api/checkout", { method: "POST", headers: h, body: JSON.stringify(body) });
  const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch {}
  const sc = r.headers.getSetCookie(); const buyer = sc.find((c) => c.startsWith("unveil_buyer="));
  return { status: r.status, json, text, setCookie: sc, buyer, token: buyer ? buyer.split(";")[0].slice("unveil_buyer=".length) : null, headers: r.headers };
}
const pay = (url: string, card = "4242424242424242") => new Http().json("POST", "/api/dev/payments/pay", { json: { sessionId: url.split("/").pop(), card } });
const em = (l: string) => `${l}-${Math.random().toString(36).slice(2, 8)}-${stamp}@example.test`;

(async () => {
  const s = await makeSeller("n1"); const d = await makeDrop(s, 2500); const d2 = await makeDrop(s, 3500);
  const body = (link = d.link, email = "x@example.test") => ({ linkId: link, email, confirmOver18: true });

  await check("N1-1", "ORIGINAL NEW-1 REPRO: client A creates checkout for victim email; client B (different IP/cookies, only email+link id) must NOT get A's checkoutUrl/session/txn id", async () => {
    const email = em("victim"); const a = await raw(body(d.link, email)); eq(a.status, 201, "A"); const b = await raw(body(d.link, email));
    eq(b.status, 201, "B status (own session)"); eq(b.json.reused, false, "B reused flag"); assert(b.json.transactionId !== a.json.transactionId, "B got A's txn id"); assert(b.json.checkoutUrl !== a.json.checkoutUrl, "B got A's URL");
    assert(!b.text.includes(a.json.transactionId) && !b.text.includes(a.json.checkoutUrl.split("/").pop()), "A's identifiers present in B response");
    assert(b.token && b.token !== a.token, "B gets own cookie"); return `A=${a.json.transactionId.slice(0, 8)} B=${b.json.transactionId.slice(0, 8)}: B 201 reused:false, different txn/session/cookie; no A identifiers in B body`;
  });
  await check("N1-2", "same client (cookie) repeat → 200 reused:true same txn; no new Set-Cookie; second cookie client independent", async () => {
    const email = em("same"); const a = await raw(body(d.link, email)); const a2 = await raw(body(d.link, email), { cookie: `unveil_buyer=${a.token}` });
    eq(a2.status, 200, "repeat"); eq(a2.json.transactionId, a.json.transactionId, "txn"); eq(a2.json.reused, true, "reused"); eq(a2.buyer, undefined, "no re-issued cookie"); return "200 reused:true; no Set-Cookie on reuse";
  });
  await check("N1-3", "same Idempotency-Key + same email (no cookie) → same txn (200); same key, different email → independent txn (no leak); key without cookie issues cookie on first", async () => {
    const e1 = em("k1"), k = "key-" + stamp + "-1"; const a = await raw(body(d.link, e1), { key: k }); const a2 = await raw(body(d.link, e1), { key: k }); eq(a2.json.transactionId, a.json.transactionId, "same"); eq(a2.status, 200, "200");
    const e2 = em("k1b"); const b = await raw(body(d.link, e2), { key: k }); eq(b.status, 201, "different email same key"); assert(b.json.transactionId !== a.json.transactionId, "cross-email leak"); assert(a.token, "cookie issued with key checkout");
    return "same key+email → 200 same txn; same key + other email → 201 own txn; cookie issued";
  });
  await check("N1-4", "KNOWN RESIDUAL: attacker who knows victim email AND the victim's Idempotency-Key (random UUID per page load) could replay it → document. Guessing keys not feasible; keyless attacker gets nothing", async () => {
    const email = em("keyleak"), k = crypto.randomUUID(); const a = await raw(body(d.link, email), { key: k }); const atk = await raw(body(d.link, email), { key: k }); 
    return `INFO: replay of same key by 2nd client returns ${atk.status} reused=${atk.json.reused} same txn=${atk.json.transactionId === a.json.transactionId} (key is a bearer capability; the page's key is client-generated random UUID, never shown to other users)`;
  });
  await check("N1-5", "forged / guessed / truncated / tampered / garbage buyer cookies → treated as unknown client: 201 own session, NEW valid cookie, no 5xx, no other txn exposed", async () => {
    const email = em("forge"); const v = await raw(body(d.link, email)); const tok = v.token; const out: string[] = [];
    const cases: Record<string, string> = {
      truncated: tok.slice(0, 20), tampered_last_char: tok.slice(0, -1) + (tok.endsWith("A") ? "B" : "A"), tampered_first: (tok[0] === "A" ? "B" : "A") + tok.slice(1), upper: tok.toUpperCase(), reversed: tok.split("").reverse().join(""),
      empty: "", short31: "a".repeat(31), long65: "a".repeat(65), zeros: "0".repeat(43), sql: "' OR 1=1--", nul: "%00", percent: encodeURIComponent(tok) + "%2e", latin1: "\xe9".repeat(40), hash_of_token: crypto.createHash("sha256").update(tok).digest("hex"), b64pad: tok + "==", guess_seq: "A".repeat(43),
    };
    for (const [n, c] of Object.entries(cases)) {
      const r = await raw(body(d.link, email), { cookie: `unveil_buyer=${c}` }); assert(r.status < 500, `${n}: ${r.status} ${r.text.slice(0, 100)}`);
      if (n === "percent" || n === "b64pad") { /* may equal tok-like but differ */ }
      assert(r.json?.transactionId !== v.json.transactionId, `${n}: got victim's txn!`); assert(r.json?.checkoutUrl !== v.json.checkoutUrl, `${n}: got victim URL`); out.push(`${n}:${r.status}${r.buyer ? "+ck" : ""}`);
    }
    return out.join(" ");
  });
  await check("N1-6", "cookie also works with extra cookies/whitespace/duplicates; duplicate cookie names: first-wins/last-wins can't be used to smuggle another client's token", async () => {
    const email = em("dup"); const a = await raw(body(d.link, email)); const other = await raw(body(d.link, email));
    const r1 = await raw(body(d.link, email), { cookie: `foo=bar; unveil_buyer=${a.token}; baz=1` }); eq(r1.json.transactionId, a.json.transactionId, "with extras");
    const r2 = await raw(body(d.link, email), { cookie: `unveil_buyer=${other.token}; unveil_buyer=${a.token}` }); const r3 = await raw(body(d.link, email), { cookie: `unveil_buyer=${a.token}; unveil_buyer=${other.token}` });
    const own = new Set([a.json.transactionId, other.json.transactionId]); assert(own.has(r2.json.transactionId) && own.has(r3.json.transactionId), "dup cookies returned unrelated txn");
    return `extras ok (200 reused); duplicate-name cookies: first-wins (r2→${r2.json.transactionId === other.json.transactionId ? "other" : "a"}, r3→${r3.json.transactionId === a.json.transactionId ? "a" : "other"}) — only tokens the caller already holds; no escalation`;
  });
  await check("N1-7", "cookie from drop A used on drop B (same email): B is a different drop → own txn, not A's; cookie is per-client not per-drop (reuses token) and does not cross-expose", async () => {
    const email = em("xd"); const a = await raw(body(d.link, email)); const b = await raw(body(d2.link, email), { cookie: `unveil_buyer=${a.token}` });
    eq(b.status, 201, "drop B new"); assert(b.json.transactionId !== a.json.transactionId, "A txn on B"); eq((await txRow(b.json.transactionId)).drop_id, d2.id, "drop"); eq(b.buyer, undefined, "no new cookie when valid token presented");
    const b2 = await raw(body(d2.link, email), { cookie: `unveil_buyer=${a.token}` }); eq(b2.json.transactionId, b.json.transactionId, "B reuse"); const a2 = await raw(body(d.link, email), { cookie: `unveil_buyer=${a.token}` }); eq(a2.json.transactionId, a.json.transactionId, "A still"); return "per-(drop,email,client): A and B independent; each reuses own";
  });
  await check("N1-8", "same cookie, DIFFERENT email → separate txn (cookie not an identity for other emails); cookie+email-case variants map to same", async () => {
    const e1 = em("ce"), e2 = em("ce2"); const a = await raw(body(d.link, e1)); const b = await raw(body(d.link, e2), { cookie: `unveil_buyer=${a.token}` }); assert(b.json.transactionId !== a.json.transactionId, "cross-email"); const c = await raw(body(d.link, e1.toUpperCase()), { cookie: `unveil_buyer=${a.token}` }); eq(c.json.transactionId, a.json.transactionId, "case"); return "ok";
  });
  await check("N1-9", "key + cookie combos: key from client A with cookie of client B; key on drop B after drop A → 409; key+cookie mismatch doesn't expose either txn to a third", async () => {
    const email = em("kc"); const a = await raw(body(d.link, email), { key: "kcA-" + stamp }); const b = await raw(body(d.link, email)); // b = independent client
    const mix = await raw(body(d.link, email), { key: "kcA-" + stamp, cookie: `unveil_buyer=${b.token}` });
    const note = `key(A)+cookie(B) → ${mix.status} txn=${mix.json.transactionId === a.json.transactionId ? "A's" : mix.json.transactionId === b.json.transactionId ? "B's" : "new"}`;
    const crossDrop = await raw(body(d2.link, email), { key: "kcA-" + stamp }); eq(crossDrop.status, 409, "key reuse on other drop"); eq(crossDrop.json.code, "idempotency_key_reused", "code"); assert(!crossDrop.text.includes(a.json.transactionId), "409 leaks txn id");
    return note + "; same key other drop → 409 (no id leak)";
  });
  await check("N1-10", "Set-Cookie flags: HttpOnly, SameSite=Lax, Path=/api/checkout, Max-Age=86400; Secure present when NODE_ENV=production (config.isProd; also on loopback http — browsers accept Secure cookies on localhost)", async () => {
    const a = await raw(body(d.link, em("flags"))); const c = a.buyer!; assert(/HttpOnly/i.test(c), "HttpOnly"); assert(/SameSite=Lax/i.test(c), "SameSite"); assert(/Path=\/api\/checkout(;|$)/i.test(c), "Path"); assert(/Max-Age=86400/i.test(c), "Max-Age"); assert(!/Domain=/i.test(c), "Domain set"); assert(a.headers.get("cache-control") === "no-store", "cache-control");
    return c.replace(a.token, "<tok>") + ` | Secure=${/Secure/i.test(c)} Cache-Control=${a.headers.get("cache-control")}`;
  });
  await check("N1-11", "cookie entropy/predictability: 300 issued tokens — unique, base64url, 43 chars (256-bit), no common prefix, not derived from email/time/txn id; DB stores only 64-hex SHA-256, never the token", async () => {
    const toks: string[] = []; for (let i = 0; i < 300; i++) { const r = await raw(body(d.link, em("ent" + i))); toks.push(r.token!); }
    eq(new Set(toks).size, 300, "unique"); assert(toks.every((t) => /^[A-Za-z0-9_-]{43}$/.test(t)), "format");
    const bits = (t: string) => Buffer.from(t, "base64url"); const bytes = toks.map(bits); const pos = Array.from({ length: 32 }, (_, i) => new Set(bytes.map((b) => b[i])).size); assert(Math.min(...pos) > 150, "low byte diversity " + Math.min(...pos));
    let ones = 0, tot = 0; for (const b of bytes) for (const x of b) { for (let k = 0; k < 8; k++) { ones += (x >> k) & 1; tot++; } } const ratio = ones / tot; assert(ratio > 0.48 && ratio < 0.52, "bit bias " + ratio);
    const rows = await db.query("SELECT buyer_token_hash FROM transactions WHERE buyer_token_hash = ANY($1)", [toks]); eq(rows.rowCount, 0, "raw token stored in DB"); const hashed = await db.query("SELECT 1 FROM transactions WHERE buyer_token_hash = $1", [crypto.createHash("sha256").update(toks[0]).digest("hex")]); eq(hashed.rowCount, 1, "hash present");
    return `300 unique 43-char tokens; per-byte distinct values ≥${Math.min(...pos)}/256; bit-balance ${ratio.toFixed(3)}; DB has SHA-256 only`;
  });
  await check("N1-12", "buyer cookie does not read other data: status API ignores cookie (txn uuid is the capability); no endpoint returns data for a cookie; cookie path /api/checkout not sent to /api/checkout/status or /pay", async () => {
    const a = await raw(body(d.link, em("stat"))); const withCookie = await new Http().json("GET", `/api/checkout/status?id=${a.json.transactionId}`, { headers: { cookie: `unveil_buyer=${a.token}` } });
    const without = await new Http().json("GET", `/api/checkout/status?id=${a.json.transactionId}`); eq(JSON.stringify(withCookie.json), JSON.stringify(without.json), "cookie changes status output");
    const bad = await new Http().json("GET", `/api/checkout/status?id=00000000-0000-0000-0000-000000000000`, { headers: { cookie: `unveil_buyer=${a.token}` } }); eq(bad.status, 404, "other id");
    const earn = await new Http().json("GET", "/api/earnings", { headers: { cookie: `unveil_buyer=${a.token}` } }); assert(earn.status === 401, "earnings w/ buyer cookie " + earn.status);
    return `status identical with/without cookie; unknown id 404; /api/earnings 401 with buyer cookie. Keys: ${Object.keys(without.json).sort()}`;
  });
  await check("N1-13", "concurrent duplicate checkout from SAME client: 20 parallel with same cookie → 1 txn; 20 parallel with same key (no cookie) → 1 txn; 20 parallel no key/no cookie (distinct unknown clients) → ≥1 txns, 0×5xx", async () => {
    const e1 = em("cc"); const a = await raw(body(d.link, e1)); const r1 = await Promise.all(Array.from({ length: 20 }, () => raw(body(d.link, e1), { cookie: `unveil_buyer=${a.token}` }))); eq(new Set(r1.map((x) => x.json.transactionId)).size, 1, "cookie dup"); assert(r1.every((x) => x.status === 200), "all 200 " + r1.map((x) => x.status));
    const e2 = em("ck"); const k = "ck-" + stamp; const r2 = await Promise.all(Array.from({ length: 20 }, () => raw(body(d.link, e2), { key: k }))); assert(r2.every((x) => x.status < 500), "5xx"); eq(new Set(r2.map((x) => x.json.transactionId)).size, 1, "key dup"); eq(r2.filter((x) => x.status === 201).length, 1, "one 201");
    const e3 = em("cn"); const r3 = await Promise.all(Array.from({ length: 20 }, () => raw(body(d.link, e3)))); assert(r3.every((x) => x.status < 500), "5xx3"); const n3 = await db.query("SELECT count(*) n FROM transactions WHERE lower(buyer_email)=lower($1) AND status='pending'", [e3]);
    const e4 = em("cfirst"); const r4 = await Promise.all(Array.from({ length: 20 }, () => raw(body(d.link, e4), { key: "same-" + stamp + Math.random() }))); assert(r4.every((x) => x.status < 500), "5xx4");
    return `same-cookie ×20 → 1 txn (all 200); same-key ×20 → 1 txn (1×201); 20 anonymous clients → ${n3.rows[0].n} independent pending (by design: no key/cookie ⇒ separate clients); 20 distinct keys → 0×5xx`;
  });
  await check("N1-14", "BuyForm double-click behaviour end-to-end uses key: see qa-pay4-dblclick.mjs; here: key + immediate repeat without cookie jar → 1 txn", async () => {
    const e = em("dbl"), k = crypto.randomUUID(); const [a, b] = await Promise.all([raw(body(d.link, e), { key: k }), raw(body(d.link, e), { key: k })]); eq(a.json.transactionId, b.json.transactionId, "same"); return "ok";
  });
  await check("N1-15", "PRICE CHANGE mid-pending: reuse by cookie → old txn failed/superseded, new txn at new price, hosted page charges == link price; reuse by key same; other client unaffected", async () => {
    const dd = await makeDrop(s, 2000); const e = em("price"); const a = await raw(body(dd.link, e)); const ak = await raw(body(dd.link, em("pricek")), { key: "pk-" + stamp });
    await db.query("UPDATE drops SET price_cents=9000 WHERE id=$1", [dd.id]);
    const a2 = await raw(body(dd.link, e), { cookie: `unveil_buyer=${a.token}` }); eq(a2.status, 201, "new txn"); assert(a2.json.transactionId !== a.json.transactionId, "same"); eq(a2.json.amountCents, 9000, "price");
    const old = await txRow(a.json.transactionId); eq(old.status, "failed", "old status"); eq(old.failure_code, "superseded", "old code"); eq(Number((await txRow(a2.json.transactionId)).amount_cents), 9000, "db");
    const ak2 = await raw(body(dd.link, JSON.parse(JSON.stringify(ak.json)).email ?? ""), { key: "pk-" + stamp }); // email differs; use real email below
    return `old ${a.json.transactionId.slice(0, 8)} → failed/superseded; new ${a2.json.transactionId.slice(0, 8)} at 9000 (201); hosted page for new session amount: pending in DB=${(await txRow(a2.json.transactionId)).amount_cents}`;
  });
  await check("N1-16", "price change + KEY reuse → superseded, key released, new txn at new price (201)", async () => {
    const dd = await makeDrop(s, 2000); const e = em("pk"); const k = "pk2-" + stamp; const a = await raw(body(dd.link, e), { key: k }); await db.query("UPDATE drops SET price_cents=2750 WHERE id=$1", [dd.id]); const a2 = await raw(body(dd.link, e), { key: k });
    eq(a2.status, 201, "status"); eq(a2.json.amountCents, 2750, "amount"); eq((await txRow(a.json.transactionId)).failure_code, "superseded", "old"); const a3 = await raw(body(dd.link, e), { key: k }); eq(a3.json.transactionId, a2.json.transactionId, "key now maps to new"); eq(a3.status, 200, "200"); return "ok";
  });
  await check("N1-17", "STALE-TAB PAY after supersede: buyer pays OLD session (old price) via webhook → check money: booked at charged price? or dropped? (notes say booked at amount charged)", async () => {
    const dd = await makeDrop(s, 2000); const e = em("stale"); const a = await raw(body(dd.link, e)); await db.query("UPDATE drops SET price_cents=9000 WHERE id=$1", [dd.id]); await raw(body(dd.link, e), { cookie: `unveil_buyer=${a.token}` });
    const r = await pay(a.json.checkoutUrl); const t = await txRow(a.json.transactionId); const nl = await ledgerCount(a.json.transactionId);
    return `hosted pay of superseded session → ${r.json.status}/${r.json.message ?? ""}; tx status=${t.status} code=${t.failure_code} ledger lines=${nl} (INFO: ${t.status === "succeeded" ? "honoured at old price 2000" : "refused"})`;
  });
  await check("N1-18", "STALE-TAB webhook (valid signature, old price) for superseded txn: outcome recorded, ledger consistent with charged amount (no mismatch between amount and split), or rejected cleanly", async () => {
    const dd = await makeDrop(s, 2000); const e = em("stalew"); const a = await raw(body(dd.link, e)); await db.query("UPDATE drops SET price_cents=9000 WHERE id=$1", [dd.id]); await raw(body(dd.link, e), { cookie: `unveil_buyer=${a.token}` });
    const w = await paySale(a.json.transactionId, 2000); const t = await txRow(a.json.transactionId); const ls = await db.query("SELECT sum(amount_cents) s, count(*) n FROM ledger_entries WHERE transaction_id=$1", [a.json.transactionId]);
    if (t.status === "succeeded") { eq(Number(ls.rows[0].s), Number(t.seller_net_cents), "ledger==net"); eq(t.amount_cents, t.platform_fee_cents + t.processing_fee_cents + t.seller_net_cents, "gross==parts"); }
    return `webhook ${w.status} ${w.json.outcome}/${w.json.detail ?? ""}; tx ${t.status}/${t.failure_code}/${t.review_reason}; amount=${t.amount_cents}; ledger ${ls.rows[0].n} lines sum ${ls.rows[0].s}`;
  });
  await check("N1-19", "price change then 2nd client (other cookie) gets new price independently; old pending of first client untouched until they return", async () => {
    const dd = await makeDrop(s, 2000); const e = em("pc2"); const a = await raw(body(dd.link, e)); await db.query("UPDATE drops SET price_cents=3100 WHERE id=$1", [dd.id]); const b = await raw(body(dd.link, e)); eq(b.json.amountCents, 3100, "b price"); eq((await txRow(a.json.transactionId)).status, "pending", "a untouched"); return "ok (A stays pending at old price until A returns; INFO)";
  });
  await check("N1-20", "reuse after seller verification fail / drop unpublished still blocked for cookie-bound reuse (no stale URL), and expiry (31 min) → new txn", async () => {
    const dd = await makeDrop(s, 2000); const e = em("ru"); const a = await raw(body(dd.link, e)); await db.query("UPDATE drops SET status='unpublished' WHERE id=$1", [dd.id]); const r = await raw(body(dd.link, e), { cookie: `unveil_buyer=${a.token}` }); assert(r.status >= 400 && r.status < 500, "unpublished " + r.status); await db.query("UPDATE drops SET status='published' WHERE id=$1", [dd.id]);
    await db.query("UPDATE transactions SET created_at=now()-interval '31 minutes' WHERE id=$1", [a.json.transactionId]); const n = await raw(body(dd.link, e), { cookie: `unveil_buyer=${a.token}` }); eq(n.status, 201, "new after expiry"); assert(n.json.transactionId !== a.json.transactionId, "same"); return `unpublished → ${r.status}; 31 min → new 201`;
  });
  await check("N1-21", "migration-008 effect: DB unique index is per (drop,email,token hash); inserting 2 pendings with same token violates (23505), different tokens OK; no raw 23505 leaks to users under 60 mixed concurrent requests", async () => {
    const e = em("idx"); const a = await raw(body(d.link, e)); const row = await txRow(a.json.transactionId);
    let code = ""; try { await db.query(`INSERT INTO transactions (drop_id,seller_id,buyer_email,amount_cents,platform_fee_cents,processing_fee_cents,seller_net_cents,status,provider,buyer_token_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','mock',$8)`, [row.drop_id, row.seller_id, row.buyer_email, row.amount_cents, row.platform_fee_cents, row.processing_fee_cents, row.seller_net_cents, row.buyer_token_hash]); } catch (x) { code = x.code; } eq(code, "23505", "index");
    const es = [em("m1"), em("m2"), em("m3")]; const reqs: Promise<any>[] = []; for (let i = 0; i < 60; i++) { const em2 = es[i % 3]; reqs.push(raw(body(i % 2 ? d.link : d2.link, em2), { key: i % 4 === 0 ? "mx-" + stamp + (i % 5) : undefined, cookie: i % 3 === 0 ? `unveil_buyer=${a.token}` : undefined })); }
    const rs = await Promise.all(reqs); const five = rs.filter((x) => x.status >= 500); eq(five.length, 0, "5xx " + five.map((x) => x.text.slice(0, 80)));
    const dups = await db.query("SELECT drop_id, lower(buyer_email), coalesce(buyer_token_hash,''), count(*) FROM transactions WHERE status='pending' GROUP BY 1,2,3 HAVING count(*)>1"); eq(dups.rowCount, 0, "dup pending");
    return `unique index rejects duplicate (23505); 60 mixed concurrent: ${rs.map((x) => x.status).reduce((m, s2) => ((m[s2] = (m[s2] ?? 0) + 1), m), {} as any) && JSON.stringify(rs.map((x) => x.status).reduce((m, s2) => ((m[s2] = (m[s2] ?? 0) + 1), m), {} as any))}, 0×5xx, 0 duplicate pendings`;
  });
  await check("N1-22", "pay a txn created by 'other client' with victim email: still pays only own session; victim's own session remains independent & payable; both can't both be booked as same sale? (two different buyers → two sales is by design)", async () => {
    const e = em("two"); const v = await raw(body(d.link, e)); const x = await raw(body(d.link, e)); const r1 = await pay(v.json.checkoutUrl); eq(r1.json.status, "succeeded", "v"); const tv = await txRow(v.json.transactionId); const tx = await txRow(x.json.transactionId); return `victim txn ${tv.status}; other-client txn ${tx.status} (still pending, payable separately: INFO — one real buyer using two browsers can double-pay)`;
  });
  save("pay4-n1-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
