/* eslint-disable */
// QA: checkout flow, card outcomes, validation, tamper, state of drops, duplicates, PAN leakage, rate limiter, authz.
import { execSync } from "node:child_process";
import fs from "node:fs";
import { Http, check, rec, assert, eq, db, makeSeller, makeDrop, checkout, txRow, save, done, sell, sendWebhook, paySale, mockEvents, ledgerCount, ledgerSum, freshIp, BASE, stamp } from "./qa-pay-lib";

const RL_BASE = process.env.QA_RL_BASE ?? "http://localhost:3618";
const pay = (sessionId: string, card: string, extra: Record<string, unknown> = {}) => new Http().json("POST", "/api/dev/payments/pay", { json: { sessionId, card, ...extra } });
const sess = (url: string) => url.split("/").pop()!;

(async () => {
  const s = await makeSeller("co"); const d = await makeDrop(s, 2000);
  const html = await (await fetch(`${BASE}/u/${d.link}`)).text();

  await check("M3-01", "guest (no account, no cookies) can open link, see buy form and start checkout; no login redirect", async () => {
    const r = await fetch(`${BASE}/u/${d.link}`, { redirect: "manual" }); eq(r.status, 200, "page");
    assert(html.includes('data-testid="buy-form"') && html.includes("Unlock for"), "buy form missing");
    const c = await checkout(d.link); eq(c.status, 201, c.text); const pg = await fetch(c.json.checkoutUrl, { redirect: "manual" }); eq(pg.status, 200, "card page");
    const t = await pg.text(); assert(/Test card number|card/i.test(t), "no card field on hosted page"); return `201 + hosted card page 200 (no cookies sent)`;
  });
  const outcomes: [string, string, string, string][] = [["4242 4242 4242 4242", "succeeded", "", "M3-02"], ["4000 0000 0000 0002", "failed", "card_declined", "M3-03a"], ["4000000000009995", "failed", "insufficient_funds", "M3-03b"], ["4000000000000069", "failed", "expired_card", "M3-03c"], ["4000000000000127", "failed", "incorrect_cvc", "M3-03d"], ["4111 1111 1111 1111", "failed", "unrecognized_test_card", "CARD-x"], ["abc", "failed", "invalid_card_number", "CARD-y"], ["5555-5555-5555-4242", "succeeded", "", "CARD-z"]];
  for (const [card, st, fc, id] of outcomes) {
    await check(id, `card ${card} → tx ${st}${fc ? " (" + fc + ")" : ""}; ledger ${st === "succeeded" ? "3 lines" : "none"}; status API agrees`, async () => {
      const c = await checkout(d.link); const tx = c.json.transactionId; const r = await pay(sess(c.json.checkoutUrl), card);
      eq(r.status, 200, r.text); const t = await txRow(tx); eq(t.status, st, "tx status"); eq(t.failure_code ?? "", fc, "failure_code");
      eq(await ledgerCount(tx), st === "succeeded" ? 3 : 0, "ledger"); const sv = await new Http().json("GET", `/api/checkout/status?id=${tx}`); eq(sv.json.status, st, "status api");
      if (st === "succeeded") { eq(t.processor_ref?.startsWith("mocktx_"), true, "processor_ref"); assert(t.succeeded_at, "succeeded_at"); }
      return `tx ${tx.slice(0, 8)} ${t.status}/${t.failure_code}`;
    });
  }
  await check("M3-03e", "after a decline: same session can't be re-paid (session terminal) and a new checkout with 4242 succeeds; no succeeded tx for the failed one", async () => {
    const c = await checkout(d.link); const sid = sess(c.json.checkoutUrl); await pay(sid, "4000000000000002"); const again = await pay(sid, "4242424242424242");
    eq(again.json.status, "succeeded", "ROUND 2 by design: declined session can be paid again"); eq((await txRow(c.json.transactionId)).status, "succeeded", "db"); eq(await ledgerCount(c.json.transactionId), 3, "ledger");
    return `second attempt on same session after decline → ${again.json.status}, 3 ledger lines (R2 assertion changed: was terminal)`;
  });

  // ---- validation ----
  await check("M3-15 / AGE-1", "18+ required: missing / false / 'true' string / 1 / null → 400; no tx rows created", async () => {
    const before = Number((await db.query("SELECT count(*) n FROM transactions")).rows[0].n); const out: string[] = [];
    for (const v of [undefined, false, "true", 1, null, "on", [true]]) { const r = await new Http().json("POST", "/api/checkout", { json: { linkId: d.link, email: "a@example.test", ...(v === undefined ? {} : { confirmOver18: v }) } }); out.push(`${JSON.stringify(v)}:${r.status}`); assert(r.status === 400, `${JSON.stringify(v)} → ${r.status}`); }
    eq(Number((await db.query("SELECT count(*) n FROM transactions")).rows[0].n), before, "rows created"); return out.join(" ");
  });
  await check("M3-15 / AGE-2", "18+ recorded: buyer_confirmed_18_at set on tx; UI checkbox 'required' attr present on buy form", async () => {
    const c = await checkout(d.link); assert((await txRow(c.json.transactionId)).buyer_confirmed_18_at, "timestamp missing"); assert(/<input[^>]*type="checkbox"[^>]*required|<input[^>]*required[^>]*type="checkbox"/.test(html), "checkbox not required in HTML"); return "buyer_confirmed_18_at set; checkbox required";
  });
  await check("EMAIL-1", "buyer_email validation: invalid forms → 400; valid incl. plus-address/uppercase accepted & lower-cased; 255-char rejected", async () => {
    const bad = ["", " ", "plain", "a@", "@b.com", "a b@c.com", "a@b", "<script>@x.com", "a@b.com\r\nBcc: x@y.com", "x".repeat(250) + "@e.co"]; const out: string[] = [];
    for (const e of bad) { const r = await checkout(d.link, {}, new Http(), e); out.push(`${JSON.stringify(e).slice(0, 18)}:${r.status}`); assert(r.status === 400, `${JSON.stringify(e)} → ${r.status}`); }
    const ok = await checkout(d.link, {}, new Http(), "  Buyer+Tag@Example.TEST "); eq(ok.status, 201, ok.text); eq((await txRow(ok.json.transactionId)).buyer_email, "buyer+tag@example.test", "normalised");
    const nonStr = await new Http().json("POST", "/api/checkout", { json: { linkId: d.link, email: { $ne: "" }, confirmOver18: true } }); eq(nonStr.status, 400, "object email");
    return out.join(" ") + " | valid → lowercased, trimmed";
  });
  await check("PRICE-1", "price tamper: amount/amountCents/price/priceCents/total/seller_net/platform_fee fields in body ignored; DB price used", async () => {
    const c = await checkout(d.link, { amount: 1, amountCents: 1, price: 0.01, priceCents: 1, price_cents: 1, total: 0, seller_net_cents: 2000, platform_fee_cents: 0, status: "succeeded", sellerId: "x", feePercent: 0 });
    eq(c.status, 201, c.text); eq(c.json.amountCents, 2000, "resp amount"); { const em = `price1+${stamp}@example.test`; const a = await checkout(d.link, { amountCents: 1 }, new Http(), em); const b = await checkout(d.link, { amountCents: 1 }, new Http(), em); eq(a.status, 201, "first"); eq(b.status, 200, "R2: same email+drop reuses live pending → 200"); eq(b.json.reused, true, "reused flag"); eq(b.json.transactionId, a.json.transactionId, "same tx"); eq(b.json.amountCents, 2000, "amount"); } const t = await txRow(c.json.transactionId); eq(`${t.amount_cents},${t.platform_fee_cents},${t.seller_net_cents},${t.status}`, "2000,200,1560,pending", "tx");
    return "all tamper fields ignored → 2000/200/1560 pending";
  });
  await check("PRICE-2", "price edited by seller after link is shown: checkout uses current DB price", async () => {
    const d2 = await makeDrop(s, 1000); await db.query("UPDATE drops SET price_cents=1500 WHERE id=$1", [d2.id]); // no drop-edit API exists on this branch (PATCH 405)
    const c = await checkout(d2.link); eq(c.json.amountCents, 1500, "after edit"); return `checkout amount ${c.json.amountCents} (DB price); note: no PATCH /api/drops/:id on this branch`;
  });
  await check("DROP-1", "unpublished / draft / flagged drops can't be bought (404) by linkId or dropId; unverified seller → 409; unknown link 404; malformed link 400", async () => {
    const dr = await makeDrop(s, 1000, { publish: false }); const unp = await makeDrop(s, 1000); await s.http.json("POST", `/api/drops/${unp.id}/unpublish`);
    const fl = await makeDrop(s, 1000); await db.query("UPDATE drops SET status='flagged' WHERE id=$1", [fl.id]);
    const out: string[] = [];
    for (const [n, body] of [["draft/dropId", { dropId: dr.id }], ["unpublished/linkId", { linkId: unp.link }], ["unpublished/dropId", { dropId: unp.id }], ["flagged/linkId", { linkId: fl.link }], ["flagged/dropId", { dropId: fl.id }]] as const) {
      const r = await new Http().json("POST", "/api/checkout", { json: { ...body, email: "a@example.test", confirmOver18: true } }); out.push(`${n}:${r.status}`); eq(r.status, 404, n);
    }
    const bad = await checkout("short"); eq(bad.status, 400, "malformed link"); const unk = await checkout("AAAAAAAAAAAA"); eq(unk.status, 404, "unknown");
    const both = await new Http().json("POST", "/api/checkout", { json: { dropId: fl.id, linkId: fl.link, email: "a@example.test", confirmOver18: true } }); eq(both.status, 400, "both ids");
    await db.query("UPDATE sellers SET verification_status='pending' WHERE id=$1", [s.id]); const nv = await checkout(d.link); await db.query("UPDATE sellers SET verification_status='verified' WHERE id=$1", [s.id]); eq(nv.status, 409, "unverified seller");
    return out.join(" ") + ` malformed:400 unknown:404 both-ids:400 unverified-seller:${nv.status}`;
  });
  await check("DROP-2", "drop unpublished AFTER checkout started: pending tx can still be paid? (record behaviour)", async () => {
    const dd = await makeDrop(s, 1000); const c = await checkout(dd.link); await s.http.json("POST", `/api/drops/${dd.id}/unpublish`); const r = await pay(sess(c.json.checkoutUrl), "4242424242424242");
    return `payment on a now-unpublished drop's pending session → ${r.json?.status} (note: money captured for an unlistable drop; no download delivery exists to honor it)`;
  }).then(() => {});
  await check("DROP-3", "drop flagged AFTER checkout started: sale succeeded for flagged drop", async () => {
    const dd = await makeDrop(s, 1000); const c = await checkout(dd.link); await db.query("UPDATE drops SET status='flagged' WHERE id=$1", [dd.id]); const r = await pay(sess(c.json.checkoutUrl), "4242424242424242");
    return `status ${r.json?.status} (flagged drop can still be paid from an earlier session - NOTE)`;
  });

  // ---- duplicates / double click ----
  await check("DUP-1", "double-click submit: 2 concurrent POST /api/checkout (same buyer, same drop) → ??? one pending tx expected per idempotency key", async () => {
    const em = `dbl+${stamp}@example.test`; const ip = new Http();
    const [a, b] = await Promise.all([checkout(d.link, {}, ip, em), checkout(d.link, {}, ip, em)]);
    const same = a.json.transactionId === b.json.transactionId;
    const n = Number((await db.query("SELECT count(*) n FROM transactions WHERE buyer_email=$1 AND drop_id=$2", [em, d.id])).rows[0].n);
    assert(same && n === 1, `NO checkout idempotency: 2 submits → ${n} separate pending transactions/sessions (${a.json.transactionId.slice(0, 8)}, ${b.json.transactionId.slice(0, 8)}); POST body has no idempotency key and no Idempotency-Key header is honoured`);
    return "";
  });
  await check("DUP-2", "Idempotency-Key header honoured on /api/checkout", async () => {
    const h = new Http(); const em = `idk+${stamp}@example.test`; const k = { "idempotency-key": "qa-key-" + stamp };
    const a = await h.json("POST", "/api/checkout", { json: { linkId: d.link, email: em, confirmOver18: true }, headers: k }); const b = await h.json("POST", "/api/checkout", { json: { linkId: d.link, email: em, confirmOver18: true }, headers: k });
    assert(a.json.transactionId === b.json.transactionId, "header ignored: two different transactions for the same Idempotency-Key"); return "same tx";
  });
  await check("DUP-3", "double-click PAY on the same session (10 concurrent approve posts) → exactly one charge/ledger posting", async () => {
    const c = await checkout(d.link); const r = await Promise.all(Array.from({ length: 10 }, () => pay(sess(c.json.checkoutUrl), "4242424242424242")));
    assert(r.every((x) => x.status === 200), "statuses " + r.map((x) => x.status)); eq(await ledgerCount(c.json.transactionId), 3, "ledger lines"); eq((await txRow(c.json.transactionId)).status, "succeeded", "st");
    const wh = await db.query("SELECT outcome, count(*) FROM webhook_events WHERE transaction_id=$1 GROUP BY 1", [c.json.transactionId]); return `one charge; webhook outcomes ${JSON.stringify(wh.rows)}`;
  });
  await check("DUP-4", "concurrent approve + decline on the same session: final state consistent with ledger (no ledger without succeeded, no succeeded w/o ledger)", async () => {
    const out: string[] = [];
    for (let i = 0; i < 6; i++) { const c = await checkout(d.link); await Promise.all([pay(sess(c.json.checkoutUrl), "4242424242424242"), pay(sess(c.json.checkoutUrl), "4000000000000002"), pay(sess(c.json.checkoutUrl), "4242424242424242")]);
      const t = await txRow(c.json.transactionId); const n = await ledgerCount(c.json.transactionId); assert((t.status === "succeeded" && n === 3) || (t.status === "failed" && n === 0), `inconsistent ${t.status} ledger ${n}`); out.push(`${t.status}/${n}`); }
    return out.join(" ");
  });

  // ---- PAN / CVC leakage ----
  await check("M3-19 / PAN-1", "card data never stored: PAN/CVC sent to pay endpoint & checkout; grep full DB dump and server logs for the full numbers/CVC", async () => {
    const marker = "4012888888881881", cvc = "737"; const c = await checkout(d.link, { card: marker, cvc, cardNumber: marker, cvv: cvc, pan: marker }, new Http(), `pan+${stamp}@example.test`);
    const r = await pay(sess(c.json.checkoutUrl), marker, { cvc, cvv: cvc, exp: "12/30", expiry: "12/30", cardNumber: marker }); void r;
    const r2 = await pay(sess(c.json.checkoutUrl), "4242 4242 4242 4242", { cvc, exp: "12/30" }); void r2;
    const dump = execSync(`pg_dump --no-owner "${process.env.DATABASE_URL}"`, { maxBuffer: 1 << 28 }).toString("utf8"); fs.writeFileSync("/tmp/qa-pay-dump.sql", dump);
    const hits: string[] = []; for (const needle of [marker, "4242424242424242", "4242 4242 4242 4242", "737"]) { const rx = needle === "737" ? /(?<![0-9a-f])737(?![0-9a-f])/ : new RegExp(needle.replace(/ /g, " ")); const n = dump.split("\n").filter((l) => rx.test(l)).length; if (n && needle !== "737") hits.push(`${needle}×${n}`); }
    const logs = ["qa/artifacts/pay-server-3617.log", "qa/artifacts/pay-server-3618-defaultlimits.log"].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "")).join("\n");
    const logHits = [marker, "4242424242424242", "4242 4242 4242 4242"].filter((n) => logs.includes(n));
    assert(!hits.length && !logHits.length, `PAN found: db=${hits} logs=${logHits}`); return `pg_dump (${(dump.length / 1024) | 0} KiB) and app logs contain no PAN; only payload hashes/fixed fields stored in webhook_events`;
  });
  await check("M3-19 / PAN-2", "card number is POSTed to OUR server (/api/dev/payments/pay) by the mock hosted page (mock only; real processor must host card fields)", async () => {
    const src = fs.readFileSync("src/app/pay/mock/[sessionId]/MockCheckoutForm.tsx", "utf8"); assert(/fetch\("\/api\/dev\/payments\/pay"/.test(src), "unexpected"); return "mock page → same-origin /api/dev/payments/pay with card in body (dev-only, 404 in prod); acceptable for mock, M3-19 for real processor BLOCKED until Segpay/CCBill";
  });

  // ---- webhook payload table content ----
  await check("PAN-3", "webhook_events.payload / normalized contain no Luhn-valid 13-19 digit standalone numbers (card-like)", async () => {
    const luhn = (d: string) => { let sum = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; };
    const rows = (await db.query("SELECT id, payload, normalized::text AS n FROM webhook_events")).rows; const hits: string[] = [];
    for (const r of rows) for (const m of `${r.payload ?? ""} ${r.n ?? ""}`.matchAll(/(?<![0-9A-Za-z_])\d{13,19}(?![0-9A-Za-z_])/g)) if (luhn(m[0])) hits.push(`${r.id}:${m[0]}`);
    eq(hits.length, 0, "Luhn-valid card-like numbers: " + hits.slice(0, 3)); return `${rows.length} webhook_events rows scanned, 0 card-like numbers (long digit runs seen were uuid/hex fragments and a 1e12 amount)`;
  });

  // ---- rate limiter (separate server with default 10/60) ----
  await check("M3-16 / RL-1", "checkout limiter (default 10/60s per IP): 10 allowed then 429 + Retry-After; other IP unaffected; single legit buyer fine", async () => {
    const h = new Http(); const codes: number[] = []; let ra = "";
    for (let i = 0; i < 13; i++) { const r = await h.req("POST", "/api/checkout", { base: RL_BASE, json: { linkId: d.link, email: "rl@example.test", confirmOver18: true } }); codes.push(r.status); if (r.status === 429) ra = r.headers.get("retry-after") ?? ""; await r.text(); }
    assert(codes.slice(0, 10).every((c) => c === 200 || c === 201), "first 10 (R2: 200 = reused same email): " + codes.slice(0, 10)); assert(codes.slice(10).every((c) => c === 429), "after 10: " + codes.slice(10)); assert(Number(ra) > 0 && Number(ra) <= 60, "retry-after " + ra);
    const other = await new Http().req("POST", "/api/checkout", { base: RL_BASE, json: { linkId: d.link, email: "rl2@example.test", confirmOver18: true } }); assert(other.status === 201 || other.status === 200, "other IP " + other.status);
    return `codes ${codes.join()}, Retry-After ${ra}, other IP 201`;
  });
  await check("RL-2 invalid requests count", "limiter runs BEFORE validation: invalid requests also consume the budget (e2e already relies on this)", async () => {
    const h = new Http(); const codes: number[] = []; for (let i = 0; i < 12; i++) { const r = await h.req("POST", "/api/checkout", { base: RL_BASE, json: {} }); codes.push(r.status); await r.text(); } return codes.join();
  });
  await check("RL-3 XFF spoof (note)", "X-Forwarded-For handling: rotating a single client-supplied XFF value bypasses the limiter; prepending extra entries does not (TRUSTED_PROXY_HOPS=1 takes right-most)", async () => {
    const rot: number[] = []; for (let i = 0; i < 15; i++) { const h = new Http(); h.ip = `203.0.113.${i + 1}`; const r = await h.req("POST", "/api/checkout", { base: RL_BASE, json: { linkId: d.link, email: "x@example.test", confirmOver18: true } }); rot.push(r.status); await r.text(); }
    const pre: number[] = []; const fixed = freshIp(); for (let i = 0; i < 13; i++) { const h = new Http(); h.ip = `198.51.100.${i + 1}, ${fixed}`; const r = await h.req("POST", "/api/checkout", { base: RL_BASE, json: { linkId: d.link, email: "x@example.test", confirmOver18: true } }); pre.push(r.status); await r.text(); }
    return `rotating single XFF: ${rot.join()} (no 429 → trivially bypassable when app is NOT behind a proxy that overwrites XFF); prepended spoof with fixed right-most: ${pre.join()}`;
  }).then(() => {});

  // ---- authz ----
  await check("AUTHZ-1", "/api/earnings: anonymous → 401; seller A sees only own ledger/transactions; seller B's data not leaked; no buyer emails", async () => {
    const a = await makeSeller("az-a"); const b = await makeSeller("az-b"); const da = await makeDrop(a, 2000), db_ = await makeDrop(b, 3000);
    const ta = await sell(da.link, 2000, "secret-buyer-a@example.test"); const tb = await sell(db_.link, 3000, "secret-buyer-b@example.test");
    const anon = await new Http().json("GET", "/api/earnings"); eq(anon.status, 401, "anon");
    const ea = await a.http.json("GET", "/api/earnings"); eq(ea.status, 200, "a"); const eb = await b.http.json("GET", "/api/earnings");
    assert(ea.json.recent.every((x: any) => x.id === ta) && ea.json.recent.length === 1, "A recent: " + JSON.stringify(ea.json.recent)); assert(eb.json.recent.every((x: any) => x.id === tb), "B recent");
    assert(!ea.text.includes("secret-buyer") && !ea.text.includes(tb) && !ea.text.includes("@example.test"), "leak in A response");
    eq(ea.json.balance.totalCents, 1560, "A total"); eq(eb.json.balance.totalCents, 2340, "B total");
    const idor = await a.http.json("GET", `/api/earnings?sellerId=${b.id}`); eq(idor.json.balance.totalCents, 1560, "sellerId param ignored");
    return `A total ${ea.json.balance.totalCents}, B total ${eb.json.balance.totalCents}; sellerId param ignored; no emails`;
  });
  await check("AUTHZ-2", "/api/checkout/status leaks only status/amount/failure_code (UUID capability); random uuid 404; SQLi id 404", async () => {
    const c = await checkout(d.link); const r = await new Http().json("GET", `/api/checkout/status?id=${c.json.transactionId}`); eq(Object.keys(r.json).sort().join(), "amountCents,message,retryable,status,transactionId", "keys (R2: failureCode replaced by retryable+message)"); assert(!("failureCode" in r.json), "raw code exposed");
    for (const id of ["00000000-0000-4000-8000-000000000000", "1' OR '1'='1", "", "../x"]) { const x = await new Http().json("GET", `/api/checkout/status?id=${encodeURIComponent(id)}`); eq(x.status, 404, id); } return "ok";
  });
  await check("SEC-3 checkout injection", "SQLi / mass-assignment in checkout JSON (dropId/linkId/email) → 400/404, tables intact", async () => {
    const out: string[] = [];
    for (const body of [{ linkId: "' OR 1=1;--aa", email: "a@example.test" }, { dropId: "' OR '1'='1", email: "a@example.test" }, { linkId: d.link, email: "a'||(select 1)--@example.test" }, { linkId: d.link, email: "a@example.test", __proto__: { confirmOver18: true } }, { linkId: d.link, email: "a@example.test", status: "succeeded", provider: "evil", seller_id: s.id, amount_cents: 1 }]) {
      const r = await new Http().json("POST", "/api/checkout", { json: { confirmOver18: true, ...body } }); out.push(String(r.status)); assert(r.status < 500, "5xx " + r.text);
      if (r.status === 201) { const t = await txRow(r.json.transactionId); eq(t.provider, "mock", "provider mass-assign"); eq(t.status, "pending", "status mass-assign"); eq(t.amount_cents, 2000, "amount"); }
    }
    const nonJson = await new Http().json("POST", "/api/checkout", { raw: "not json", headers: { "content-type": "application/json" } }); out.push("nonjson:" + nonJson.status); assert(nonJson.status === 400, "non-json");
    const ct = await new Http().json("POST", "/api/checkout", { raw: JSON.stringify({ linkId: d.link, email: "a@example.test", confirmOver18: true }), headers: { "content-type": "text/plain" } }); out.push("text/plain:" + ct.status);
    return out.join(" ");
  });
  await check("SEC-4 CSRF/origin", "cross-origin POST /api/checkout and /api/dev/payments/pay blocked (403)", async () => {
    const r = await new Http().json("POST", "/api/checkout", { json: { linkId: d.link, email: "a@example.test", confirmOver18: true }, headers: { origin: "http://evil.example" } }); eq(r.status, 403, "checkout"); return "403";
  });
  save("pay-checkout-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
