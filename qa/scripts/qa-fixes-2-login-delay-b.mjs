// Follow-up probes for the login delay: timestamped parallel burst + case-variant bucket sharing. Usage same as qa-fixes-2-login-delay.mjs
import pg from "pg"; import crypto from "node:crypto";
const BASE = process.env.BASE ?? "http://localhost:3203"; const PW = "Correct-Horse-Battery-9";
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const ip = () => Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 250)).join(".");
const t0 = Date.now();
async function login(email, password) { const s = Date.now() - t0; const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ email, password }) }); const j = await r.json().catch(() => ({})); return { s: r.status, ra: r.headers.get("retry-after"), code: j.code, start: s, end: Date.now() - t0 }; }
const mk = async (tag) => { const email = `qa-ldb-${tag}-${crypto.randomBytes(3).toString("hex")}@example.com`; await fetch(BASE + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ email, password: PW, displayName: "B" }) }); return email; };
await db.query("truncate rate_limits");
// 1) timestamped 40-way burst
const S = await mk("burst"); const res = await Promise.all(Array.from({ length: 40 }, (_, i) => login(S, "g" + i)));
const ev = res.filter((r) => r.s === 401).sort((a, b) => a.end - b.end);
console.log(`[LD-9b] 40 parallel: 401=${ev.length} 429=${res.filter((r) => r.s === 429).length}; evaluated attempts finished at t(ms)=${ev.map((e) => e.end).join(",")}; 429 request start times span ${Math.min(...res.filter((r) => r.s === 429).map((r) => r.start))}..${Math.max(...res.filter((r) => r.s === 429).map((r) => r.start))} ms`);
const row = (await db.query("select failures from login_throttle where key=$1", ["login:" + crypto.createHash("sha256").update(S).digest("hex").slice(0, 24)])).rows[0];
console.log(`[LD-9b] throttle failures=${row.failures} (== evaluated count ${ev.length}; each admitted attempt counted once)`);
// 2) strict check: no more than 1 evaluation per delay window after threshold; repeat burst 3x
for (let k = 0; k < 3; k++) { const T = await mk("b" + k); const t1 = Date.now(); const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => login(T, "g" + i))); const n = rs.filter((r) => r.s === 401).length; console.log(`[LD-9b] repeat ${k + 1}: evaluated=${n} within ${Date.now() - t1} ms (5 free + ${n - 5} more admitted after 1 s/2 s delays elapsed)`); }
// 3) case/whitespace variants share the bucket while delayed
const C = await mk("case"); for (let i = 0; i < 5; i++) await login(C, "bad" + i);
const direct = await login(C, "bad"); const upper = await login(C.toUpperCase(), "bad"); const padded = await login(`  ${C}  `, "bad");
console.log(`[LD-8b] right after 5 failures: same-case=${direct.s}:${direct.code}(ra=${direct.ra}); UPPER-CASE=${upper.s}:${upper.code}(ra=${upper.ra}); padded-with-spaces=${padded.s}:${padded.code ?? ""} (padded fails zod email validation → 400 before throttle: expected)`);
await db.end();
