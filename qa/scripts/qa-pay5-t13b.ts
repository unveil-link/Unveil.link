// @ts-nocheck
/* eslint-disable */
// [#13] under CPU load: the sequential variant (3 wrong guesses, then the CORRECT password). For each trial record, on the DB clock, when the 3rd guess was ADMITTED
// (arming the 1 s delay) and when the probe arrived/was admitted. The probe may only get 200 if probe_arrival >= 3rd_admission + 1 s (delay elapsed); 429 otherwise.
import crypto from "node:crypto";
import { Http, db, makeSeller, done } from "./qa-pay5-lib";
const B = process.env.QA_BASE_URL ?? "http://localhost:3922"; const SPW = "Qa-Pay-Passw0rd!x";
const key = (e: string) => "login:" + crypto.createHash("sha256").update(e.trim().toLowerCase()).digest("hex").slice(0, 24);
const post = (email: string, password: string) => new Http().json("POST", "/api/auth/login", { json: { email, password }, base: B });
(async () => {
  const s = await makeSeller("t13b"); let ok = 0, early200 = 0, c429 = 0, c200 = 0; const rows: string[] = [];
  for (let t = 0; t < Number(process.env.TRIALS ?? 8); t++) {
    await db.query("DELETE FROM login_throttle WHERE key=$1", [key(s.email)]); await db.query("DELETE FROM rate_limits WHERE key=$1", ["LOGIN_EMAIL:" + key(s.email).slice(6)]);
    const g: number[] = []; for (let i = 0; i < 3; i++) { await post(s.email, "bad-Aa1!x" + i); }
    const row = (await db.query("SELECT extract(epoch from next_allowed_at)*1000 na, extract(epoch from last_attempt_at)*1000 la FROM login_throttle WHERE key=$1", [key(s.email)])).rows[0];
    const tProbe = (await db.query("SELECT extract(epoch from clock_timestamp())*1000 n")).rows[0].n; const r = await post(s.email, SPW);
    const armedUntil = Number(row.na), probeAt = Number(tProbe); const inWindow = probeAt < armedUntil - 5; // 5 ms tolerance
    const verdict = r.status === 429 ? (inWindow ? "OK (429 inside window)" : "429 after window?!") : r.status === 200 ? (inWindow ? "BYPASS (200 inside window)" : "OK (200: window already elapsed)") : "other " + r.status;
    if (r.status === 200 && inWindow) early200++; if (r.status === 429) c429++; if (r.status === 200) c200++;
    rows.push(`trial${t}: 3rd guess armed until +${(armedUntil - Number(row.la)).toFixed(0)} ms after its admission; probe arrived ${(probeAt - Number(row.la)).toFixed(0)} ms after the 3rd admission -> ${r.status} ${verdict}`);
  }
  console.log(rows.join("\n")); console.log(`TOTAL 200 inside an armed window: ${early200} (must be 0); 429s ${c429}; 200s ${c200} (all after the window elapsed)`); await done();
})();
