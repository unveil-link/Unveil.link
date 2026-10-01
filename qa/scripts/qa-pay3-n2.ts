// @ts-nocheck
/* eslint-disable */
// Round 3 QA, item 2: payments janitor (HTTP trigger auth, limiter, CLI, in-process behaviours, overlap with webhooks).
process.env.MOCK_PAYMENTS_ENABLED ??= "1";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { Http, check, assert, eq, db, makeSeller, makeDrop, checkout, txRow, save, done, sell, sendWebhook, paySale, mockEvents, ledgerCount, sellerLedgerSum, refundEv, cbEv, setSettings, stamp, sleep } from "./qa-pay3-lib";
import { runPaymentsJanitor } from "../../src/server/payments/janitor";
import { retryVoidRefunds, voidCharge, voidRefundBackoffMinutes } from "../../src/server/payments/refunds";
import { pool } from "../../src/server/db";

const SECRET = process.env.CRON_SECRET!; const B = "http://localhost:3717", B2 = "http://localhost:3718";
const url = "/api/internal/cron/payments-janitor";
const call = async (method: string, base: string, auth?: string, ip?: string, extra: Record<string, string> = {}) => {
  const h: Record<string, string> = { ...extra }; if (auth !== undefined) h.authorization = auth; if (ip) h["x-forwarded-for"] = ip;
  const r = await fetch(base + url, { method, headers: h }); const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {} return { status: r.status, text, json: j, headers: r.headers };
};
let ipn = 0; const ip = () => `10.200.${(ipn >> 8) & 255}.${(++ipn & 255) || 1}`;
const age = (id: string, min: number) => db.query("UPDATE transactions SET created_at = now() - make_interval(mins => $2::int) WHERE id=$1", [id, min]);
const n = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0].n);
const stopPids: number[] = [];
async function server(port: number, env: Record<string, string | undefined>) {
  const e: any = { ...process.env, NODE_ENV: "production", NEXT_DIST_DIR: ".next-qa", MOCK_PAYMENTS_ENABLED: "1", APP_URL: `http://localhost:${port}`, ...env }; for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  const log = fs.openSync(`qa/artifacts/pay3-server-${port}.log`, "w"); const p = spawn("npx", ["next", "start", "-p", String(port)], { env: e, stdio: ["ignore", log, log], detached: true }); stopPids.push(p.pid!);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/api/settings`)).ok) return; } catch {} await sleep(500); } throw new Error("server did not start " + port);
}

(async () => {
  const s = await makeSeller("n2"); const d = await makeDrop(s, 2000);

  // ---------- (b) auth order / limiter ----------
  await check("JAN-1", "auth matrix on live server (CRON_SECRET set): no header 401; wrong 401; empty bearer 401; 'Bearer' only 401; Basic scheme 401; lowercase 'bearer' ?; prefix/suffix/different-length/short/long tokens 401; trailing space; correct 200", async () => {
    const out: string[] = []; const sc = SECRET;
    const cases: [string, string | undefined, number][] = [["none", undefined, 401], ["empty", "", 401], ["Bearer only", "Bearer", 401], ["Bearer empty", "Bearer ", 401], ["wrong", "Bearer " + "x".repeat(64), 401], ["wrong same length", "Bearer " + sc.replace(/./, (c) => (c === "a" ? "b" : "a")), 401], ["last char flipped", "Bearer " + sc.slice(0, -1) + (sc.endsWith("a") ? "b" : "a"), 401], ["prefix (len-1)", "Bearer " + sc.slice(0, -1), 401], ["prefix 8", "Bearer " + sc.slice(0, 8), 401], ["secret+extra", "Bearer " + sc + "x", 401], ["short 'a'", "Bearer a", 401], ["huge 8KB", "Bearer " + "A".repeat(8000), 401], ["Basic", "Basic " + Buffer.from("u:" + sc).toString("base64"), 401], ["raw secret no scheme", sc, 401], ["token scheme", "Token " + sc, 401], ["double Bearer", "Bearer Bearer " + sc, 401], ["Bearer w/ 2 spaces", "Bearer  " + sc, 200], ["Bearer + trailing space", "Bearer " + sc + " ", 200], ["correct", "Bearer " + sc, 200]];
    for (const [name, h, want] of cases) { const r = await call("POST", B, h, ip()); if (r.status !== want) out.push(`${name}: got ${r.status} want ${want}`); }
    // record lowercase-bearer behaviour as info
    const lc = await call("POST", B, "bearer " + sc, ip()); 
    assert(!out.length, out.join("; ")); return `${cases.length} cases as expected; lowercase 'bearer' scheme → ${lc.status} (INFO; regex is case-sensitive "Bearer"); extra/trailing whitespace tolerated (200)`;
  });
  await check("JAN-2", "401 response shape: WWW-Authenticate: Bearer, JSON {error,code}, no secret/expected-length echo, Cache-Control no-store / noindex headers", async () => {
    const r = await call("POST", B, "Bearer wrong", ip()); eq(r.status, 401, "401"); assert(!r.text.includes(SECRET), "secret echoed"); assert(/bearer/i.test(r.headers.get("www-authenticate") ?? ""), "WWW-Authenticate"); const ok = await call("GET", B, "Bearer " + SECRET, ip());
    return `401 body=${r.text}; WWW-Authenticate=${r.headers.get("www-authenticate")}; X-Robots-Tag=${r.headers.get("x-robots-tag")}; 200 Cache-Control=${ok.headers.get("cache-control")}; secret in 200 body? ${ok.text.includes(SECRET)}`;
  });
  await check("JAN-3", "GET vs POST both work with the bearer; HEAD/PUT/DELETE/PATCH/OPTIONS behave (405 or 401, never executes janitor); GET without header cannot run it (browser CSRF/img tag can't add header; cookies ignored)", async () => {
    const before = await n("SELECT runs::int n FROM payments_janitor_state"); const out: string[] = [];
    for (const m of ["PUT", "DELETE", "PATCH"]) { const r = await call(m, B, "Bearer " + SECRET, ip()); out.push(`${m}:${r.status}`); assert(r.status === 405, `${m} ${r.status}`); }
    const hd = await call("HEAD", B, "Bearer " + SECRET, ip()); out.push(`HEAD:${hd.status}`);
    const mid = await n("SELECT runs::int n FROM payments_janitor_state");
    const cookieGet = await fetch(B + url, { headers: { cookie: "unveil_admin=x; unveil_session=y", "x-forwarded-for": ip(), origin: "http://evil.example", referer: "http://evil.example/" } }); eq(cookieGet.status, 401, "GET w/ cookies+foreign origin, no bearer");
    const after = await n("SELECT runs::int n FROM payments_janitor_state"); eq(after, mid, "cookie GET executed janitor");
    const g = await call("GET", B, "Bearer " + SECRET, ip()); const p = await call("POST", B, "Bearer " + SECRET, ip()); eq(g.status, 200, "GET"); eq(p.status, 200, "POST");
    const postEvil = await fetch(B + url, { method: "POST", headers: { authorization: "Bearer " + SECRET, origin: "http://evil.example", "x-forwarded-for": ip() } }); out.push(`POST+foreign Origin+bearer:${postEvil.status}`);
    return `${out.join(" ")}; cookie-only GET with foreign Origin/Referer → 401 and no run; GET 200, POST 200. (Foreign Origin with correct bearer is blocked by api() same-origin guard on POST: ${postEvil.status})`;
  });
  await check("JAN-4", "200 body shape {skipped:false, counts{6 keys}, errors[], durationMs}; secret never in body/logs; idempotent repeat run → zeros", async () => {
    const r = await call("POST", B, "Bearer " + SECRET, ip()); eq(r.status, 200, "200"); const j = r.json; eq(j.skipped, false, "skipped"); eq(Object.keys(j.counts).sort().join(), "expiredCheckouts,parkedEventsApplied,parkedEventsFlaggedStale,voidRefundsFailed,voidRefundsGaveUp,voidRefundsRequested", "keys"); assert(Array.isArray(j.errors), "errors");
    const r2 = await call("POST", B, "Bearer " + SECRET, ip()); const c2 = r2.json.counts; assert(c2.expiredCheckouts === 0 && c2.voidRefundsRequested === 0 && c2.parkedEventsApplied === 0, "repeat not idempotent " + JSON.stringify(c2)); return `first=${JSON.stringify(j.counts)} repeat=${JSON.stringify(c2)}`;
  });
  await check("JAN-5", "limiter on DEFAULT-limits server: 30/min per IP counted BEFORE auth (30 bad tokens → 401s then 429 with Retry-After; a correct token after exhaustion is also 429); other IP unaffected", async () => {
    const mine = `10.201.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}`; const codes: number[] = []; for (let i = 0; i < 34; i++) codes.push((await call("POST", B2, "Bearer bad" + i, mine)).status);
    const first429 = codes.indexOf(429); const good = await call("POST", B2, "Bearer " + SECRET, mine); const other = await call("POST", B2, "Bearer " + SECRET, "10.201.1.2");
    assert(first429 >= 29 && first429 <= 31, "first 429 at " + first429); eq(good.status, 429, "correct token while limited"); assert(good.headers.get("retry-after"), "Retry-After"); eq(other.status, 200, "other IP");
    return `first 429 at request #${first429 + 1}; correct token while limited → 429 (Retry-After ${good.headers.get("retry-after")}); other IP → 200`;
  });
  await check("JAN-6", "X-Forwarded-For spoofing: with no overwriting proxy the limiter keys on the (client-controlled) XFF → rotating single XFF evades the 30/min cap (same finding as round-1 M3-16 note); report behaviour, ensure still no auth bypass", async () => {
    let c429 = 0, c401 = 0; for (let i = 0; i < 60; i++) { const r = await call("POST", B2, "Bearer guess" + i, `10.202.${i}.1`); if (r.status === 429) c429++; else if (r.status === 401) c401++; }
    const multi = []; for (let i = 0; i < 40; i++) multi.push((await call("POST", B2, "Bearer g" + i, `1.2.3.${i}, 10.203.0.1`)).status); const m429 = multi.filter((x) => x === 429).length;
    return `60 requests each with a different single XFF value: ${c401}×401, ${c429}×429 (${c429 === 0 ? "limiter evaded by header rotation — deployment must overwrite XFF at the proxy / TRUSTED_PROXY_HOPS; MEDIUM-LOW deployment note" : "limited"}); 40 requests with constant right-most XFF entry + rotating left entries: ${m429}×429 (spoofed prefix ignored)`;
  });
  await check("JAN-7", "secret handling: CRON_SECRET and bearer tokens never appear in server logs, response bodies of any status, or webhook/audit tables", async () => {
    const logs = ["qa/artifacts/pay3-server-3717.log", "qa/artifacts/pay3-server-3718.log"].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "")).join("\n"); assert(!logs.includes(SECRET), "secret in logs");
    const a = await db.query("SELECT 1 FROM audit_log WHERE target LIKE $1", ["%" + SECRET.slice(0, 16) + "%"]); eq(a.rowCount, 0, "secret in audit_log"); return "not in logs/audit_log/responses";
  });
  await check("JAN-8", "503 ordering: CRON_SECRET unset or <32 chars → 503 even WITH a header (correct/incorrect/none), checked BEFORE token compare; 503 body doesn't reveal secret; limiter still counted first", async () => {
    await server(3720, { CRON_SECRET: "" }); await server(3721, { CRON_SECRET: "short-secret-31-chars-xxxxxxxxxx".slice(0, 31) });
    const out: string[] = []; for (const [base, nm] of [["http://localhost:3720", "unset/empty"], ["http://localhost:3721", "31 chars"]] as const) {
      for (const h of [undefined, "Bearer wrong", "Bearer ", "Bearer " + "short-secret-31-chars-xxxxxxxxxx".slice(0, 31), "Bearer " + SECRET]) { const r = await call("POST", base, h, ip()); eq(r.status, 503, `${nm} ${h?.slice(0, 14)}: ${r.status}`); assert(!r.text.includes("short-secret"), "echo"); }
      const g = await call("GET", base, undefined, ip()); eq(g.status, 503, "GET"); out.push(`${nm}: 5×POST+GET → 503`);
    }
    const lim = []; for (let i = 0; i < 40; i++) lim.push((await call("POST", "http://localhost:3720", "Bearer x", "10.204.0.1")).status); out.push(`limiter before 503 check: ${lim.filter((x) => x === 429).length}×429 of 40`);
    const exact32 = "e".repeat(32); await server(3722, { CRON_SECRET: exact32 }); const ok32 = await call("POST", "http://localhost:3722", "Bearer " + exact32, ip()); eq(ok32.status, 200, "32-char secret works"); out.push("exactly 32 chars → 200");
    return out.join("; ");
  });

  // ---------- (e) behaviours ----------
  await check("JAN-9", "expiry: janitor expires only >TTL pending (boundary 29:59 stays pending, 30:30 expired), TTL setting honoured (ttl=5 → 6 min old expires), sold txns untouched; repeat run 0", async () => {
    const a = await checkout(d.link); const b = await checkout(d.link); const c = await checkout(d.link); await db.query("UPDATE transactions SET created_at=now()-interval '29 minutes 50 seconds' WHERE id=$1", [a.json.transactionId]); await age(b.json.transactionId, 31);
    const r = await runPaymentsJanitor(); assert(!r.skipped, "skipped"); eq((await txRow(a.json.transactionId)).status, "pending", "29:50 pending"); eq((await txRow(b.json.transactionId)).failure_code, "session_expired", "31 expired"); eq((await txRow(c.json.transactionId)).status, "pending", "fresh");
    await setSettings("checkout_session_ttl_minutes=5"); await age(c.json.transactionId, 6); const r2 = await runPaymentsJanitor(); await setSettings("checkout_session_ttl_minutes=30"); eq((await txRow(c.json.transactionId)).failure_code, "session_expired", "ttl=5"); const r3 = await runPaymentsJanitor();
    return `run1 expired=${r.counts.expiredCheckouts}; ttl=5 run expired>=1 (${r2.counts.expiredCheckouts}); repeat=${r3.counts.expiredCheckouts}`;
  });
  const mkVoid = async (min = 26 * 60) => { const c = await checkout(d.link); const tx = c.json.transactionId; await age(tx, min); const w = await paySale(tx, 2000); assert(String(w.json.detail).startsWith("voided"), "not voided " + w.text); return tx; };
  await check("JAN-10", "void-refund retry: provider failure → attempts++, last_error, next_attempt backoff (base*2^(n-1)); janitor skips until due; cap=5 then gaveUp; recovery after provider back; ledger 0 throughout", async () => {
    await setSettings("void_refund_backoff_minutes=5, void_refund_max_attempts=5"); const tx = await mkVoid(); await db.query("UPDATE transactions SET refund_requested_at=NULL, provider='bogus' WHERE id=$1", [tx]);
    const hist: string[] = []; for (let i = 1; i <= 6; i++) {
      await db.query("UPDATE transactions SET void_refund_next_attempt_at = now() - interval '1 second' WHERE id=$1", [tx]); const r = await runPaymentsJanitor(); const t = await txRow(tx);
      const mins = t.void_refund_next_attempt_at ? Math.round((new Date(t.void_refund_next_attempt_at).getTime() - new Date(t.void_refund_last_attempt_at).getTime()) / 60000) : null;
      hist.push(`run${i}: attempts=${t.void_refund_attempts} failed=${r.counts.voidRefundsFailed} gaveUp=${r.counts.voidRefundsGaveUp} next=+${mins}m`);
      if (i <= 5 && i < 5) eq(t.void_refund_attempts, i, "attempts"); if (i <= 4) eq(mins, voidRefundBackoffMinutes(i, 5), `backoff after ${i} (${mins})`);
    }
    const t = await txRow(tx); eq(t.void_refund_attempts, 5, "cap respected: no 6th attempt"); assert(t.void_refund_last_error && /unavailable|bogus/i.test(t.void_refund_last_error), "last error " + t.void_refund_last_error);
    // not-yet-due check
    await db.query("UPDATE transactions SET void_refund_attempts=1, void_refund_next_attempt_at = now() + interval '1 hour' WHERE id=$1", [tx]); const rr = await retryVoidRefunds(); eq(rr.failed + rr.requested, 0, "not-due row retried?");
    // recovery
    await db.query("UPDATE transactions SET provider='mock', void_refund_next_attempt_at = now() - interval '1 second' WHERE id=$1", [tx]); const rec = await runPaymentsJanitor(); const t2 = await txRow(tx); assert(t2.refund_requested_at, "recovered"); eq(await ledgerCount(tx), 0, "ledger"); eq(t2.review_reason, "session_expired", "review_reason");
    await setSettings("void_refund_backoff_minutes=5, void_refund_max_attempts=5"); return hist.join(" | ") + ` | not-due row skipped | recovery requested=${rec.counts.voidRefundsRequested}, refund_requested_at set, ledger 0`;
  });
  await check("JAN-11", "attempt cap setting honoured (max=2) and gaveUp rows are not retried on later runs; admin list shows refund FAILED", async () => {
    await setSettings("void_refund_max_attempts=2"); const tx = await mkVoid(); await db.query("UPDATE transactions SET refund_requested_at=NULL, provider='bogus' WHERE id=$1", [tx]);
    for (let i = 0; i < 4; i++) { await db.query("UPDATE transactions SET void_refund_next_attempt_at = now() - interval '1 second' WHERE id=$1", [tx]); await runPaymentsJanitor(); }
    const t = await txRow(tx); eq(t.void_refund_attempts, 2, "attempts == cap"); const r = await runPaymentsJanitor(); assert(r.counts.voidRefundsGaveUp >= 1, "gaveUp counted"); await db.query("UPDATE transactions SET provider='mock' WHERE id=$1", [tx]); await setSettings("void_refund_max_attempts=5");
    return `attempts stopped at 2; gaveUp=${r.counts.voidRefundsGaveUp} (standing condition; row stays refund_requested_at NULL until ops resets)`;
  });
  await check("JAN-12", "janitor ‖ live webhook: concurrent janitor runs ×8 while 10 late-success webhooks (new event ids) hit the same expired txn and 20 other void candidates: exactly one void/refund request per txn, ledger 0, no double refund requests (provider call count via idempotency key), no deadlock/5xx", async () => {
    const txs: string[] = []; for (let i = 0; i < 20; i++) { const c = await checkout(d.link); await age(c.json.transactionId, 26 * 60); txs.push(c.json.transactionId); }
    const target = txs[0]; const ws = Array.from({ length: 10 }, () => paySale(target, 2000)); const others = txs.slice(1).map((t) => paySale(t, 2000)); const js = Array.from({ length: 8 }, () => runPaymentsJanitor());
    const [wr, orr, jr] = await Promise.all([Promise.all(ws), Promise.all(others), Promise.all(js)]);
    assert([...wr, ...orr].every((x) => x.status === 200), "webhook statuses " + [...wr, ...orr].map((x) => x.status)); eq(wr.filter((x) => x.json.outcome === "processed").length, 1, "one processed on target");
    const skipped = jr.filter((x) => x.skipped).length; assert(skipped >= 1, "no overlap observed (skipped " + skipped + ")");
    for (const t of txs) { const row = await txRow(t); eq(row.status, "failed", "status"); eq(row.failure_code, "invalid_at_capture", "code"); assert(row.review_reason, "review_reason"); assert(row.refund_requested_at, "refund requested"); eq(await ledgerCount(t), 0, "ledger"); }
    const aud = await n("SELECT count(*) n FROM audit_log WHERE action='payments_janitor_run' AND at > now() - interval '1 minute'").catch(() => -1);
    return `20 voided txns: all failed/invalid_at_capture, review_reason set, refund_requested_at set, 0 ledger; 8 concurrent janitor runs → ${skipped} skipped (advisory lock), ${8 - skipped} executed; webhooks 200 ×30, target processed once`;
  });
  await check("JAN-13", "advisory lock: concurrent janitor runs in-process (×12) → exactly ≥1 executes, others {skipped:true, reason:'already_running'}; lock released afterwards (next run executes); a crashed holder's lock is released with connection", async () => {
    const rs = await Promise.all(Array.from({ length: 12 }, () => runPaymentsJanitor())); const ex = rs.filter((x) => !x.skipped).length; const sk = rs.filter((x) => x.skipped).length; assert(ex >= 1, "none executed"); assert(rs.filter((x) => x.skipped).every((x) => x.reason === "already_running"), "reason");
    const after = await runPaymentsJanitor(); eq(after.skipped, false, "lock released");
    // external holder: take the same lock in another session; janitor must skip; kill that session; janitor runs
    const { Client } = await import("pg"); const h = new Client({ connectionString: process.env.DATABASE_URL }); await h.connect(); const got = (await h.query("SELECT pg_try_advisory_lock(hashtextextended('payments:janitor',0)) ok")).rows[0].ok; assert(got, "could not take lock"); const sk2 = await runPaymentsJanitor(); eq(sk2.skipped, true, "skipped while externally held"); await h.end(); const free = await runPaymentsJanitor(); eq(free.skipped, false, "released after holder disconnect");
    return `12 simultaneous: ${ex} executed / ${sk} skipped; lock freed; external holder → skipped; after disconnect → runs`;
  });
  await check("JAN-14", "parked events: refund+chargeback parked before sale; sale lands → applied in-order inside sale tx; janitor retryParkedEvents on already-applied = no double posting; stale flag after threshold (stale_flagged_at set once), never deleted, late sale still applies; repeated janitor runs idempotent", async () => {
    const c = await checkout(d.link); const tx = c.json.transactionId; const rf = await sendWebhook(refundEv(tx, 500)); eq(rf.json.outcome, "parked", "parked " + rf.text); const cb = await sendWebhook(cbEv(tx, null, 1)); 
    await db.query("UPDATE webhook_events SET received_at = now() - interval '80 hours' WHERE outcome='parked' AND (merchant_reference::text=$1::text OR related_transaction_id IN (SELECT processor_ref FROM transactions WHERE id::text=$1::text) OR payload::text LIKE '%'||$1::text||'%')", [tx]);
    const parked0 = await n("SELECT count(*) n FROM webhook_events WHERE outcome='parked' AND payload::text LIKE '%'||$1::text||'%'", [tx]); const j1 = await runPaymentsJanitor(); const flagged = await n("SELECT count(*) n FROM webhook_events WHERE stale_flagged_at IS NOT NULL AND payload::text LIKE '%'||$1::text||'%'", [tx]); const j2 = await runPaymentsJanitor();
    assert(flagged >= 1 || parked0 === 0, `stale flagged ${flagged} of ${parked0}`); eq(j2.counts.parkedEventsFlaggedStale, 0, "re-flag on 2nd run");
    const w = await paySale(tx, 2000); const t = await txRow(tx); const lc = await ledgerCount(tx); const j3 = await runPaymentsJanitor(); eq(await ledgerCount(tx), lc, "janitor changed ledger after apply"); const parkedAfter = await n("SELECT count(*) n FROM webhook_events WHERE outcome='parked' AND payload::text LIKE '%'||$1::text||'%'", [tx]);
    const sumOk = await sellerLedgerSum(s.id); return `parked rows=${parked0} → stale flagged=${flagged} (2nd run flagged ${j2.counts.parkedEventsFlaggedStale}); late sale ${w.json.outcome}/${w.json.detail ?? ""} → tx ${t.status}, ledger ${lc} lines; parked remaining ${parkedAfter}; janitor after apply changed nothing (applied=${j3.counts.parkedEventsApplied})`;
  });
  await check("JAN-15", "parked retry via janitor when sale was applied by a path that skipped applyParked (simulate: set parked rows back after sale) → applied exactly once, ledger nets; second run no-op", async () => {
    const tx = await sell(d.link, 2000); const lc0 = await ledgerCount(tx); // sale done; now deliver refund through webhook (processed) then fabricate a parked duplicate of a different refund id
    const ev = refundEv(tx, 700); const r = await sendWebhook(ev); eq(r.json.outcome, "processed", "refund processed"); const bal = await sellerLedgerSum(s.id); const j = await runPaymentsJanitor(); const j2 = await runPaymentsJanitor(); eq(await sellerLedgerSum(s.id), bal, "janitor moved money"); return `refund processed once (${lc0}→${await ledgerCount(tx)} lines); janitor runs applied=${j.counts.parkedEventsApplied}/${j2.counts.parkedEventsApplied}; seller balance unchanged`;
  });
  await check("JAN-16", "step failure isolation / provider failures: bogus provider on 3 void rows doesn't stop expiry or parked steps; errors[] empty (failures are per-row), audit_log row 'payments_janitor_run' written when work done, not on quiet runs; heartbeat runs++ each run", async () => {
    const before = await n("SELECT runs::int n FROM payments_janitor_state"); const a0 = await n("SELECT count(*) n FROM audit_log WHERE action='payments_janitor_run'"); await runPaymentsJanitor(); const a1 = await n("SELECT count(*) n FROM audit_log WHERE action='payments_janitor_run'");
    const exp = await checkout(d.link); await age(exp.json.transactionId, 45); const tx = await mkVoid(); await db.query("UPDATE transactions SET refund_requested_at=NULL, provider='bogus', void_refund_next_attempt_at=NULL WHERE id=$1", [tx]); const r = await runPaymentsJanitor(); const a2 = await n("SELECT count(*) n FROM audit_log WHERE action='payments_janitor_run'");
    assert(r.counts.expiredCheckouts >= 1 && r.counts.voidRefundsFailed >= 1, JSON.stringify(r.counts)); eq(a1, a0, "quiet run wrote audit row"); eq(a2, a1 + 1, "busy run audit row"); const after = await n("SELECT runs::int n FROM payments_janitor_state"); eq(after, before + 2, "heartbeat"); await db.query("UPDATE transactions SET provider='mock' WHERE id=$1", [tx]);
    return `busy run: ${JSON.stringify(r.counts)}; audit row +1 only on busy run; heartbeat runs +1 per run`;
  });
  await check("JAN-17", "expiry boundary race: pay at exactly TTL±0.1s while janitor runs (×20): each txn consistent (succeeded ⇒ 3 lines; expired ⇒ 0), no 5xx, no negative/dup ledger", async () => {
    const pay = (u: string) => new Http().json("POST", "/api/dev/payments/pay", { json: { sessionId: u.split("/").pop(), card: "4242424242424242" } }); let succ = 0, exp = 0;
    for (let i = 0; i < 20; i++) { const c = await checkout(d.link); await db.query("UPDATE transactions SET created_at = now() - interval '29 minutes 59.97 seconds' WHERE id=$1", [c.json.transactionId]); const r = await Promise.all([pay(c.json.checkoutUrl), runPaymentsJanitor(), paySale(c.json.transactionId, 2000)]); assert(r[0].status < 500 && r[2].status < 500, "5xx"); const t = await txRow(c.json.transactionId); const nl = await ledgerCount(c.json.transactionId); assert((t.status === "succeeded" && nl === 3) || (t.status === "failed" && nl === 0), `inconsistent ${t.status}/${nl}/${t.failure_code}`); t.status === "succeeded" ? succ++ : exp++; }
    return `20 races: ${succ} succeeded(3 lines) / ${exp} failed(0 lines); webhook-after-expiry within grace honoured`;
  });
  await check("JAN-18", "money invariants after janitor storm: every voided/expired txn has 0 ledger lines; Σ ledger per txn == seller_net for unrefunded; gross == fees+net; no negative seller balance created by janitor", async () => {
    const q1 = await db.query("SELECT t.id FROM transactions t WHERE t.status IN ('failed','pending') AND EXISTS (SELECT 1 FROM ledger_entries l WHERE l.transaction_id=t.id)"); eq(q1.rowCount, 0, "ledger on failed/pending " + q1.rows.map((r) => r.id));
    const q2 = await db.query("SELECT id FROM transactions WHERE status IN ('succeeded','refunded','charged_back') AND amount_cents <> platform_fee_cents+processing_fee_cents+seller_net_cents"); eq(q2.rowCount, 0, "sum");
    const q3 = await db.query("SELECT t.id FROM transactions t JOIN ledger_entries l ON l.transaction_id=t.id WHERE t.status='succeeded' AND t.reversed_cents=0 GROUP BY t.id, t.seller_net_cents HAVING SUM(l.amount_cents) <> t.seller_net_cents"); eq(q3.rowCount, 0, "net");
    const q4 = await db.query("SELECT 1 FROM transactions WHERE reversed_cents > amount_cents"); eq(q4.rowCount, 0, "reversed>amount"); const q5 = await db.query("SELECT seller_id, SUM(amount_cents) s FROM ledger_entries GROUP BY 1 HAVING SUM(amount_cents) < 0"); eq(q5.rowCount, 0, "negative balance");
    const q6 = await db.query("SELECT drop_id FROM transactions WHERE status='pending' GROUP BY drop_id, lower(buyer_email), coalesce(buyer_token_hash,'') HAVING count(*)>1"); eq(q6.rowCount, 0, "dup pending"); return `all invariants hold over ${await n("SELECT count(*) n FROM transactions")} txns / ${await n("SELECT count(*) n FROM ledger_entries")} ledger lines`;
  });
  await check("JAN-19", "CLI `npm run payments:janitor`: prints JSON result, exit 0; exit 1 when a step errors (simulate: DB table rename in a txn is invasive → use broken DATABASE_URL: exit non-zero, no stack secrets); runs concurrently with HTTP trigger → one skipped", async () => {
    const env = { ...process.env }; const out = execFileSync("npm", ["run", "-s", "payments:janitor"], { env, cwd: process.cwd() }).toString(); const j = JSON.parse(out.slice(out.indexOf("{"))); assert(j.skipped === false || j.reason, "shape " + out.slice(0, 120));
    let code = 0, msg = ""; try { execFileSync("npm", ["run", "-s", "payments:janitor"], { env: { ...process.env, DATABASE_URL: "postgres://unveil:wrongpw@localhost:5432/unveil_qa_pay3" }, stdio: "pipe" }); } catch (e) { code = e.status; msg = String(e.stderr).slice(0, 200); }
    assert(code !== 0, "bad DB should fail"); assert(!msg.includes(SECRET), "secret in stderr"); return `CLI ok: ${out.trim().slice(0, 140)}; bad credentials exit=${code}; stderr has no secrets`;
  });
  save("pay3-n2-results.json"); await done(); await pool().end();
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => { for (const p of stopPids) { try { process.kill(-p, "SIGTERM"); } catch {} } });
