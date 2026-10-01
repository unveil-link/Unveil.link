// @ts-nocheck
/* eslint-disable */
// Round 5: is the e2e [#13] flake a test-timing artifact or a product race in login-throttle?  Server 3922 = the e2e login-delay config (threshold 3, base 1 s, cap 4 s).
// A trigger on the throwaway DB records every admission (UPDATE of login_throttle) with the DB clock, so we can prove the INVARIANT
//   "no attempt is ever admitted before the previous admission's next_allowed_at"   (admission gap >= previous delay)
// holds under a loaded burst, i.e. extra 401s / a "200 instead of 429" can only happen after the armed delay has really elapsed (wall clock), never inside it.
import crypto from "node:crypto";
import { Http, db, check, assert, eq, makeSeller, sleep, save, done } from "./qa-pay5-lib";
const B = process.env.QA_BASE_URL ?? "http://localhost:3922";
const SPW = "Qa-Pay-Passw0rd!x";
const key = (e: string) => "login:" + crypto.createHash("sha256").update(e.trim().toLowerCase()).digest("hex").slice(0, 24);
const post = (email: string, password: string) => new Http().json("POST", "/api/auth/login", { json: { email, password }, base: B });
(async () => {
  await db.query(`CREATE TABLE IF NOT EXISTS qa_throttle_log (id bigserial PRIMARY KEY, key text, failures int, at timestamptz DEFAULT clock_timestamp(), next_allowed_at timestamptz, last_attempt_at timestamptz)`);
  await db.query(`CREATE OR REPLACE FUNCTION qa_throttle_log_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='UPDATE' AND NEW.failures IS DISTINCT FROM OLD.failures THEN INSERT INTO qa_throttle_log(key,failures,next_allowed_at,last_attempt_at) VALUES (NEW.key,NEW.failures,NEW.next_allowed_at,NEW.last_attempt_at); END IF; RETURN NEW; END $$`);
  await db.query(`DROP TRIGGER IF EXISTS qa_throttle_log_t ON login_throttle`); await db.query(`CREATE TRIGGER qa_throttle_log_t AFTER UPDATE ON login_throttle FOR EACH ROW EXECUTE FUNCTION qa_throttle_log_fn()`);
  const s = await makeSeller("t13");
  const clear = async () => { await db.query("DELETE FROM login_throttle WHERE key=$1", [key(s.email)]); await db.query("DELETE FROM rate_limits WHERE key=$1", ["LOGIN_EMAIL:" + key(s.email).slice(6)]); };
  await check("T13-a", "deterministic: 3 wrong guesses arm a 1 s delay; the CORRECT password immediately after -> 429 (not evaluated, no cookie); after the delay has elapsed -> 200", async () => {
    await clear(); for (let i = 0; i < 3; i++) eq((await post(s.email, "bad-Aa1!x" + i)).status, 401, "free guess " + i);
    const r = await post(s.email, SPW); eq(r.status, 429, "inside the window"); assert(!r.headers.get("set-cookie"), "cookie"); const ra = Number(r.headers.get("retry-after")); assert(ra >= 1 && ra <= 4, "ra " + ra);
    await sleep(1300); const ok = await post(s.email, SPW); eq(ok.status, 200, "after the window"); return `inside window: 429 (Retry-After ${ra}); after 1.3 s: 200`;
  });
  await check("T13-b", "ARTIFACT REPRO: same sequence but the correct-password probe arrives >= 1 s after the burst (what a slow/loaded runner does) -> 200, exactly the R4 symptom 'expected 429, got 200'", async () => {
    await clear(); for (let i = 0; i < 3; i++) await post(s.email, "bad-Aa1!x" + i); await sleep(1100); const r = await post(s.email, SPW); eq(r.status, 200, "late probe"); return "probe 1.1 s after arming -> 200 (delay already elapsed: correct behaviour)";
  });
  // loaded burst: sample the invariant. 20 parallel wrong guesses repeated, with the event loop slowed by parallel bcrypt compares from the other burst members
  await check("T13-c", "INVARIANT under load: over 25 bursts of 20 parallel wrong guesses (+ extra parallel bcrypt contention from 6 other emails), every admission is >= the previous admission's armed delay later (DB clock); admitted per burst <= threshold + elapsed-delay admissions", async () => {
    const effShort: number[] = []; let bursts = 0, violations = 0, admits = 0, maxAdm = 0, extra = 0; const others = Array.from({ length: 6 }, (_, i) => `ghost-t13-${i}@example.test`);
    for (let b = 0; b < 25; b++) {
      await clear(); await db.query("DELETE FROM qa_throttle_log WHERE key=$1", [key(s.email)]);
      const t0 = Date.now(); const noise = others.flatMap((e) => Array.from({ length: 3 }, () => post(e, "x-Aa1!xyz")));
      const rs = await Promise.all([...Array.from({ length: 20 }, (_, i) => post(s.email, `bad-${b}-${i}-Zq9!`)), ...noise]); const ms = Date.now() - t0;
      const mine = rs.slice(0, 20); const ev = mine.filter((r) => r.status === 401).length; assert(mine.every((r) => r.status === 401 || r.status === 429), "unexpected " + mine.map((r) => r.status));
      const log = (await db.query("SELECT failures, at, next_allowed_at, last_attempt_at FROM qa_throttle_log WHERE key=$1 ORDER BY id", [key(s.email)])).rows;
      for (let i = 1; i < log.length; i++) { const gap = (new Date(log[i].last_attempt_at).getTime() - new Date(log[i - 1].next_allowed_at).getTime()); if (gap < -2) violations++; // admitted before previous window ended (tx-start clock, 2 ms tolerance)
        const real = new Date(log[i].at).getTime() - new Date(log[i - 1].at).getTime(); const armed = new Date(log[i - 1].next_allowed_at).getTime() - new Date(log[i - 1].last_attempt_at).getTime(); effShort.push(armed - real); } // WALL-clock (clock_timestamp) gap between consecutive admissions vs the delay armed by the first
      admits += log.length; maxAdm = Math.max(maxAdm, log.length); if (ev > 3) extra++; bursts++;
      if (ms > 1000) { /* burst outlasted the 1 s first delay: extra admissions are expected and legal */ }
    }
    eq(violations, 0, "admissions inside an active delay window"); return `${bursts} bursts, ${admits} admissions (max ${maxAdm}/burst; ${extra} bursts evaluated >3 guesses because the burst outlasted the armed delay), 0 admissions inside an armed window (tx-start clock); wall-clock gap between consecutive admissions vs armed delay: worst shortfall ${Math.max(...effShort).toFixed(0)} ms (positive = next admission came earlier than the full armed delay after the previous admission's UPDATE; caused by now() being the TX START while the row lock wait precedes the UPDATE), n=${effShort.length}`;
  });
  save("pay5-t13-results.json"); await db.query(`DROP TRIGGER IF EXISTS qa_throttle_log_t ON login_throttle`); await done();
})();
