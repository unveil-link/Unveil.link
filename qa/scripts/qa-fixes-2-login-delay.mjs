// Verifies the progressive login delay (backend/fixes-2, replaces BUG-17 lockout).
// App must run with DEFAULT limits (no RATE_LIMIT_ENABLED=0, no LOGIN_DELAY_* env). Takes ~5 min (waits out real delays).
// Usage: BASE=http://localhost:3203 DB=postgres://... MAIL_DEV_DIR=... node qa/scripts/qa-fixes-2-login-delay.mjs
import pg from "pg"; import crypto from "node:crypto"; import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3203";
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PW = "Correct-Horse-Battery-9";
const ip = () => Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 250)).join(".");
const key = (e) => "login:" + crypto.createHash("sha256").update(e.trim().toLowerCase()).digest("hex").slice(0, 24);
const log = (id, m) => console.log(`[${id}] ${m}`);
async function login(email, password, xff = ip()) {
  const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": xff }, body: JSON.stringify({ email, password }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, ra: r.headers.get("retry-after"), body: t, code: j?.code, cookie: r.headers.getSetCookie?.().some((c) => c.startsWith("unveil_session=") && !/Max-Age=0/i.test(c)) };
}
async function mk(tag) {
  const email = `qa-ld-${tag}-${crypto.randomBytes(3).toString("hex")}@example.com`;
  const r = await fetch(BASE + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ email, password: PW, displayName: "LD" }) });
  if (r.status !== 201) throw new Error("signup " + r.status + await r.text());
  return email;
}
const row = async (e) => (await db.query("select failures, extract(epoch from (next_allowed_at-now()))::float wait_left, extract(epoch from (next_allowed_at-last_attempt_at))::float armed from login_throttle where key=$1", [key(e)])).rows[0];
const wrongs = async (e, n) => { const o = []; for (let i = 0; i < n; i++) o.push(await login(e, "wrong-pass-" + i)); return o; };
const seq = (a) => a.map((x) => x.s + (x.ra ? `(ra=${x.ra})` : "")).join(" ");

await db.query("truncate login_throttle; truncate rate_limits");
const cfg = (await db.query("select login_delay_threshold t, login_delay_base_seconds b, login_delay_cap_seconds c, login_delay_decay_seconds d from platform_settings")).rows[0];
log("LD-0", `platform_settings login_delay_* overrides = ${JSON.stringify(cfg)} (all null → env/defaults 5/1s/60s/900s)`);

// ---- LD-1 threshold + 429 shape; LD-2 correct password during delay
const V = await mk("victim");
let a = await wrongs(V, 6);
log("LD-1", `6 rapid wrong logins (distinct IPs): ${seq(a)} → threshold 5 then delayed. body of delayed: ${a[5].body}`);
const dur = await login(V, PW);
log("LD-2", `CORRECT password during delay → ${dur.s} code=${dur.code} Retry-After=${dur.ra} session cookie set=${dur.cookie} (documented: refused, password not evaluated)`);
const r0 = await row(V); log("LD-2", `throttle row: failures=${r0.failures} armed=${r0.armed.toFixed(0)}s (refused attempts not counted: failures stays 5)`);
await sleep(1200);
const after1 = await login(V, PW);
log("LD-3", `owner after waiting Retry-After (1 s) with correct password → ${after1.s} cookie=${after1.cookie}; throttle row removed=${!(await row(V))}`);

// ---- LD-4 escalation 1,2,4,8,16,32,60,60 + exact-wait evaluated
const E = await mk("escal"); await wrongs(E, 5); // f=5 → delay 1s armed
const ras = []; const evalAfterWait = [];
let cur = await login(E, "x-probe"); ras.push(+cur.ra); // 429, ra for f=5 delay (1)
for (let i = 0; i < 7; i++) {
  await sleep(ras[ras.length - 1] * 1000 + 60);
  const n = await login(E, "wrong-after-wait"); evalAfterWait.push(n.s); // must be evaluated (401)
  const nx = await login(E, "x-probe"); ras.push(+nx.ra);
}
log("LD-4", `Retry-After sequence observed: ${ras.join(",")} (expected 1,2,4,8,16,32,60,60); attempt right after waiting exactly Retry-After was evaluated (401): ${evalAfterWait.join(",")}`);
const re = await row(E); log("LD-4", `at cap: failures=${re.failures} armed=${re.armed.toFixed(0)}s (<=60 cap)`);
// ---- LD-5 victim logs in after the cap delay (no permanent lockout); flood during delay doesn't extend
const flood = await Promise.all(Array.from({ length: 60 }, () => login(E, "flood")));
const floodSet = {}; flood.forEach((f) => (floodSet[f.s + "/" + f.ra] = (floodSet[f.s + "/" + f.ra] ?? 0) + 1));
const leftBefore = (await row(E)).wait_left;
log("LD-5", `60 concurrent attacker attempts during 60 s delay → ${JSON.stringify(floodSet)}; remaining wait before flood≈${ras.at(-1)}s, after flood=${leftBefore.toFixed(1)}s (not extended)`);
await sleep(Math.ceil(leftBefore) * 1000 + 100);
const owner = await login(E, PW);
log("LD-5", `owner (correct password) after the cap delay following a flood → ${owner.s} cookie=${owner.cookie}; row removed=${!(await row(E))} → NOT permanent`);

// ---- LD-6 reset on good login
const R = await mk("reset"); await wrongs(R, 4); const good = await login(R, PW);
const post = await wrongs(R, 6);
log("LD-6", `4 wrong, then GOOD login (${good.s}), then 6 wrong: ${seq(post)} (counter reset → 5 free 401s again, 6th delayed)`);
// ---- LD-7 reset via password reset
const P = await mk("pwreset"); await wrongs(P, 7);
const inDelay = await login(P, PW);
const fp = await fetch(BASE + "/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ email: P }) });
let tok; for (let i = 0; i < 40 && !tok; i++) { await sleep(250); for (const f of fs.readdirSync(process.env.MAIL_DEV_DIR).filter((x) => x.endsWith(".json"))) { const j = JSON.parse(fs.readFileSync(process.env.MAIL_DEV_DIR + "/" + f, "utf8")); if (j.to === P) tok = j.text.match(/token=([A-Za-z0-9_-]+)/)?.[1]; } }
const rowBefore = await row(P);
const NEW = "Another-Strong-Pass-77";
const rs = await fetch(BASE + "/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ token: tok, password: NEW }) });
const rowAfter = await row(P);
const li = await login(P, NEW);
log("LD-7", `7 wrong (delay armed ${rowBefore.armed.toFixed(0)}s, failures=${rowBefore.failures}); login during delay=${inDelay.s}; forgot-password during delay=${fp.status}; reset-password=${rs.status}; row after reset=${rowAfter ? JSON.stringify(rowAfter) : "deleted"}; login with NEW password immediately=${li.s} cookie=${li.cookie}`);
// ---- LD-8 unknown emails identical
const K = await mk("known"); const U = `qa-ld-unknown-${crypto.randomBytes(3).toString("hex")}@example.com`;
const ka = await wrongs(K, 7), ua = await wrongs(U, 7);
log("LD-8", `known  : ${seq(ka)}`); log("LD-8", `unknown: ${seq(ua)}`);
const strip = (x) => x.body.replace(/\d+ second/, "N second");
log("LD-8", `status+code sequences identical=${ka.map((x) => x.s + x.code).join() === ua.map((x) => x.s + x.code).join()}; 401 bodies identical=${ka[0].body === ua[0].body} (${ka[0].body}); 429 bodies identical=${strip(ka[5]) === strip(ua[5])}; throttle row exists for unknown email=${!!(await row(U))}`);
// upper-case variant shares the bucket
const up = await login(K.toUpperCase(), "wrong"); log("LD-8", `upper-cased variant of the throttled email → ${up.s} code=${up.code} (same bucket; case can't bypass)`);
// ---- LD-9 spoofed XFF vs per-email limit; parallel
const S = await mk("spoof");
const sp = await Promise.all(Array.from({ length: 40 }, (_, i) => login(S, "guess" + i, ip())));
const c = {}; sp.forEach((x) => (c[x.s + (x.code ? ":" + x.code : "")] = (c[x.s + (x.code ? ":" + x.code : "")] ?? 0) + 1));
log("LD-9", `40 PARALLEL wrong guesses, rotating spoofed X-Forwarded-For → ${JSON.stringify(c)} (exactly 5 evaluated = threshold; rest delayed; password evaluated at most 5 times)`);
const sp2 = []; for (let i = 0; i < 30; i++) sp2.push(await login(S, "guess2-" + i, ip()));
const c2 = {}; sp2.forEach((x) => (c2[x.s + ":" + x.code] = (c2[x.s + ":" + x.code] ?? 0) + 1));
log("LD-9", `30 further sequential guesses with rotating XFF over ~time → ${JSON.stringify(c2)}`);
// other emails unaffected while S is delayed
const O = await mk("other"); log("LD-9", `different email during S's delay: correct login=${(await login(O, PW)).s}`);
// ---- LD-10 per-IP limiter still distinct
const fixed = "203.0.113." + (10 + Math.floor(Math.random() * 200)); const ipr = [];
for (let i = 0; i < 25; i++) ipr.push(await login(`qa-ld-ip-${i}-${crypto.randomBytes(2).toString("hex")}@example.com`, "x", fixed));
const ic = {}; ipr.forEach((x) => (ic[x.s + ":" + x.code] = (ic[x.s + ":" + x.code] ?? 0) + 1));
log("LD-10", `25 logins, 25 different emails, ONE IP → ${JSON.stringify(ic)}; Retry-After on first 429=${ipr.find((x) => x.s === 429)?.ra} (per-IP limit 20/15 min unchanged, code rate_limited)`);
// ---- LD-11 config from platform_settings (live) + decay
await db.query("truncate rate_limits; update platform_settings set login_delay_threshold=2, login_delay_base_seconds=1, login_delay_cap_seconds=2, login_delay_decay_seconds=3");
const C = await mk("cfg"); const cs = await wrongs(C, 3);
log("LD-11", `settings override (threshold 2, cap 2 s, decay 3 s) applied live without restart: 3 wrong → ${seq(cs)}`);
await sleep(4500); // > decay
const dc = await wrongs(C, 3);
log("LD-11", `after 4.5 s idle (> decay 3 s) failures forgotten: next 3 wrong → ${seq(dc)} (expected 401, 401, 429 → counter restarted from 0)`);
await db.query("update platform_settings set login_delay_threshold=null, login_delay_base_seconds=null, login_delay_cap_seconds=null, login_delay_decay_seconds=null");
const bad = (await db.query("select count(*)::int n, coalesce(max(extract(epoch from (next_allowed_at-last_attempt_at))),0)::float mx from login_throttle")).rows[0];
log("LD-12", `all throttle rows: n=${bad.n}, longest armed delay=${bad.mx.toFixed(0)} s (<= 60 cap; DB CHECK bound 1 h)`);
const chk = await db.query("insert into login_throttle(key,failures,last_attempt_at,next_allowed_at) values ('qa-check',1,now(),now()+interval '2 hours')").then(() => "ACCEPTED", (e) => "rejected: " + e.constraint);
await db.query("delete from login_throttle where key='qa-check'");
log("LD-12", `DB backstop: row with 2 h block → ${chk}`);
await db.end();
