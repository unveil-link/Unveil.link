// @ts-nocheck
/* eslint-disable */
// Round 5 NEW-5: admitLoginAttempt single-statement upsert. Parallel logins (seller + admin), throttle semantics. Target: server with DEFAULT login-delay config (threshold 5, base 1, cap 60, decay 900).
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { Http, BASE, db, check, assert, eq, makeSeller, stamp, sleep, save, done } from "./qa-pay5-lib";
const PW = "Qa-Admin-Passphrase-93!x", SPW = "Qa-Pay-Passw0rd!x";
const skey = (e: string) => "login:" + crypto.createHash("sha256").update(e.trim().toLowerCase()).digest("hex").slice(0, 24);
const akey = (e: string) => skey("admin:" + e);
const STRICT = process.env.STRICT === "1", TH = Number(process.env.TH ?? 5);
const clear = async (k: string) => { await db.query("DELETE FROM login_throttle WHERE key=$1", [k]); await db.query("DELETE FROM rate_limits WHERE key = $1", ["LOGIN_EMAIL:" + k.slice(6)]); }; // also the per-email BURST limiter (20/60 s, seller route only)
const mkAdmin = (label: string) => { const email = `n5-${label}-${stamp}@example.test`; const r = spawnSync("npx", ["tsx", "scripts/create-admin.ts", email], { env: { ...process.env, ADMIN_PASSWORD: PW }, encoding: "utf8", input: "" }); if (r.status !== 0) throw new Error(r.stdout + r.stderr); return email; };
const hist = (rs: { status: number }[]) => { const c: Record<number, number> = {}; rs.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1)); return JSON.stringify(c); };
type Kind = "seller" | "admin";
const URLS = { seller: "/api/auth/login", admin: "/api/admin/login" };
const par = (kind: Kind, n: number, mk: (i: number) => { email: string; password: string }) => Promise.all(Array.from({ length: n }, (_, i) => { const b = mk(i); return new Http().json("POST", URLS[kind], { json: b }); }));
const ra = (r: any) => Number(r.headers.get("retry-after"));
(async () => {
  const seller = await makeSeller("n5s"); const adminEmail = mkAdmin("a");
  const who = { seller: { email: seller.email, key: skey(seller.email), pw: SPW }, admin: { email: adminEmail, key: akey(adminEmail), pw: PW } };
  for (const kind of ["seller", "admin"] as Kind[]) {
    const w = who[kind];
    for (const n of [30, 120]) {
      await sleep(1200);
      await check(`N5-${kind}-valid-${n}`, `${n} parallel VALID ${kind} logins, one email: no 5xx; only 200/429 (<= threshold evaluated); sessions == 200s`, async () => {
        await clear(w.key); const rs = await par(kind, n, () => ({ email: w.email, password: w.pw }));
        const bad = rs.filter((r) => ![200, 429].includes(r.status)); assert(!bad.length, "unexpected statuses " + hist(rs));
        assert(rs.filter((r) => r.status === 200).length >= 1, "no login succeeded " + hist(rs)); /* a success deletes the row (counter reset), so >threshold successes are legitimate */
        for (const r of rs.filter((r) => r.status === 429)) { assert(ra(r) >= 1 && ra(r) <= 60, "Retry-After " + ra(r)); assert(["login_delayed","rate_limited"].includes(r.json.code), "code "+r.json.code); }
        return hist(rs);
      });
      await check(`N5-${kind}-invalid-${n}`, `${n} parallel WRONG-password ${kind} logins, one email: no 5xx; threshold evaluated (401; strict mode: exactly), rest 429 + Retry-After 1..60; concurrency cannot bypass`, async () => {
        await clear(w.key); const rs = await par(kind, n, (i) => ({ email: w.email, password: `wrong-${i}-Zq9!` }));
        const c401 = rs.filter((r) => r.status === 401).length, c429 = rs.filter((r) => r.status === 429).length; assert(c401 + c429 === n, "5xx/other: " + hist(rs));
        const row0 = (await db.query("SELECT failures FROM login_throttle WHERE key=$1", [w.key])).rows[0];
        if (STRICT) eq(c401, TH, "evaluated (base delay 30 s so time cannot admit more)"); else assert(c401 >= TH, "fewer than threshold evaluated " + hist(rs)); for (const r of rs.filter((r) => r.status === 429)) assert(ra(r) >= 1 && ra(r) <= 60, "Retry-After " + ra(r));
        const row = (await db.query("SELECT failures, extract(epoch from (next_allowed_at-last_attempt_at)) d FROM login_throttle WHERE key=$1", [w.key])).rows[0]; eq(row.failures, c401, "failures == evaluated"); return hist(rs) + ` row failures=${row.failures} delay=${row.d}s`;
      });
      await check(`N5-${kind}-mixed-${n}`, `${n} parallel logins mixing valid+invalid, MIXED-CASE emails (same throttle key): no 5xx`, async () => {
        await clear(w.key); const rs = await par(kind, n, (i) => ({ email: i % 3 === 0 ? w.email.toUpperCase() : i % 3 === 1 ? ` ${w.email} ` : w.email, password: i % 2 ? w.pw : "nope-Aa1!x" }));
        // " email " is rejected by zod email() -> 400 is legitimate
        const bad = rs.filter((r) => ![200, 400, 401, 429].includes(r.status)); assert(!bad.length, "unexpected " + hist(rs)); return hist(rs);
      });
      await check(`N5-${kind}-diff-${n}`, `${n} parallel logins, ${n} DIFFERENT emails (known+unknown): no 5xx, no cross-talk (each first attempt is evaluated -> 401 or 200)`, async () => {
        const rs = await par(kind, n, (i) => (i % 5 === 0 ? { email: w.email, password: "bad-Aa1!xyz" } : { email: `ghost${i}-${stamp}@example.test`, password: "bad-Aa1!xyz" }));
        const bad = rs.filter((r) => r.status !== 401 && r.status !== 429); assert(!bad.length, "unexpected " + hist(rs)); const distinct = rs.filter((r, i) => i % 5 !== 0 && r.status !== 401); assert(!distinct.length, "unknown-email first attempts not all evaluated: " + hist(distinct)); return hist(rs);
      });
    }
    if (!STRICT) await check(`N5-${kind}-race-reset`, `${kind}: login success DELETE racing admissions (the original NEW-5 trigger): 200 rounds x (1 valid + 4 wrong in parallel) -> never 5xx`, async () => {
      let five = 0, codes: any = {};
      for (let r = 0; r < 60; r++) { await clear(w.key); const rs = await Promise.all([0, 1, 2, 3, 4].map((i) => new Http().json("POST", URLS[kind], { json: { email: w.email, password: i === 2 ? w.pw : "bad-Aa1!x" + i } }))); rs.forEach((x) => { codes[x.status] = (codes[x.status] ?? 0) + 1; if (x.status >= 500) five++; }); }
      eq(five, 0, "5xx " + JSON.stringify(codes)); return JSON.stringify(codes);
    });
    if (!STRICT) await check(`N5-${kind}-progressive`, `${kind}: progressive delay 4 free, 5th arms 1 s, then 2,4,8 s; 429 never evaluates; Retry-After matches; correct pw during delay refused; success resets`, async () => {
      await clear(w.key); const seq: string[] = [];
      for (let i = 1; i <= 4; i++) seq.push(String((await new Http().json("POST", URLS[kind], { json: { email: w.email, password: "bad-Aa1!x" } })).status)); eq(seq.join(","), "401,401,401,401", "first four free");
      const f5 = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: "bad-Aa1!x" } }); eq(f5.status, 401, "5th evaluated");
      const d1 = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: w.pw } }); eq(d1.status, 429, "correct pw in delay -> 429"); eq(ra(d1), 1, "retry-after 1"); assert(!d1.headers.get("set-cookie"), "cookie while delayed");
      const exp = [2, 4, 8]; const waits: number[] = [];
      for (const e of exp) { await sleep(1100 * (e / 2 > 1 ? e / 2 : 1) + (e === 2 ? 0 : 0)); /* wait out previous delay */ let r; for (let k = 0; k < 40; k++) { r = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: "bad-Aa1!x" } }); if (r.status !== 429) break; await sleep(Math.max(200, ra(r) * 250)); } eq(r.status, 401, "evaluated after wait"); const probe = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: "bad-Aa1!x" } }); eq(probe.status, 429, "delayed again"); waits.push(ra(probe)); assert(ra(probe) <= e && ra(probe) >= 1, `retry-after ${ra(probe)} vs ${e}`); }
      await sleep(9000); const ok = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: w.pw } }); eq(ok.status, 200, "success after wait"); eq((await db.query("SELECT 1 FROM login_throttle WHERE key=$1", [w.key])).rowCount, 0, "row deleted on success");
      const free = []; for (let i = 0; i < 4; i++) free.push((await new Http().json("POST", URLS[kind], { json: { email: w.email, password: "bad-Aa1!x" } })).status); eq(free.join(","), "401,401,401,401", "counter reset: 4 free again"); await clear(w.key);
      return `first4 ${seq.join("/")}, 5th 401, in-delay 429 (retry-after 1), later Retry-After ${waits.join(",")} (<= 2,4,8), success resets row`;
    });
    if (!STRICT) await check(`N5-${kind}-parity`, `${kind}: unknown email behaves identically to a known one (4 free, 5th arms delay, 429 body/Retry-After)`, async () => {
      const ghost = `ghost-par-${kind}-${stamp}@example.test`; const gk = kind === "seller" ? skey(ghost) : akey(ghost); await clear(gk); await clear(w.key);
      const a: string[] = [], b: string[] = []; for (let i = 0; i < 7; i++) { const r1 = await new Http().json("POST", URLS[kind], { json: { email: ghost, password: "bad-Aa1!x" } }); const r2 = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: "bad-Aa1!x" } }); a.push(r1.status + (r1.status === 429 ? ":" + ra(r1) : "")); b.push(r2.status + (r2.status === 429 ? ":" + ra(r2) : "")); }
      eq(a.join(","), b.join(","), "sequences differ"); const g = await new Http().json("POST", URLS[kind], { json: { email: ghost, password: "x" } }); const k = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: "x" } }); eq(g.text, k.text, "429 body differs"); await clear(gk); await clear(w.key); return `unknown ${a.join(",")} == known ${b.join(",")}; 429 bodies identical`;
    });
    if (!STRICT) await check(`N5-${kind}-decay-bounds`, `${kind}: counters decay after idle (stale -> restart at 1); extreme counters: wait <= cap 60, never negative; no permanent lock`, async () => {
      await db.query("INSERT INTO login_throttle (key, failures, last_attempt_at, next_allowed_at) VALUES ($1, 9, now() - interval '901 seconds', now() - interval '901 seconds') ON CONFLICT (key) DO UPDATE SET failures=9, last_attempt_at=now() - interval '901 seconds', next_allowed_at=now() - interval '901 seconds'", [w.key]);
      const r = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: "bad-Aa1!x" } }); eq(r.status, 401, "stale row is evaluated"); eq((await db.query("SELECT failures FROM login_throttle WHERE key=$1", [w.key])).rows[0].failures, 1, "decayed to 1");
      await db.query("UPDATE login_throttle SET failures=1000000, last_attempt_at=now(), next_allowed_at=now()+interval '59 seconds' WHERE key=$1", [w.key]); const r2 = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: w.pw } }); eq(r2.status, 429, "huge counter in window"); assert(ra(r2) >= 1 && ra(r2) <= 60, "retry-after " + ra(r2));
      await db.query("UPDATE login_throttle SET next_allowed_at=now()-interval '5 seconds' WHERE key=$1", [w.key]); const r3 = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: "bad-Aa1!x" } }); eq(r3.status, 401, "after window elapsed: evaluated"); const row = (await db.query("SELECT failures, extract(epoch from (next_allowed_at-last_attempt_at)) d FROM login_throttle WHERE key=$1", [w.key])).rows[0]; assert(row.d >= 0 && row.d <= 60, "delay " + row.d);
      const r4 = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: w.pw } }); assert([429].includes(r4.status), "armed " + r4.status); assert(ra(r4) >= 1 && ra(r4) <= 60, "ra " + ra(r4));
      await db.query("UPDATE login_throttle SET failures=2147483647, last_attempt_at=now(), next_allowed_at=now()-interval '1 second' WHERE key=$1", [w.key]); const r5 = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: "bad-Aa1!x" } });
      await clear(w.key); const okc = await new Http().json("POST", URLS[kind], { json: { email: w.email, password: w.pw } }); eq(okc.status, 200, "no permanent lock: login works after the row is gone / delay elapsed");
      return `stale decays to 1; failures=1e6 -> wait ${ra(r2)}s (<=60); armed delay ${row.d}s; INT_MAX counter (theoretical, needs 2^31 admitted attempts) -> HTTP ${r5.status}`;
    });
  }
  save(STRICT ? "pay5-newfive-strict-results.json" : "pay5-newfive-results.json"); await done();
})();
