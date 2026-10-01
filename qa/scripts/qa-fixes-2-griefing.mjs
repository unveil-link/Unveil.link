// BUG-17 residual check: persistent attacker polling a victim's email vs honest owner who obeys Retry-After.
// Usage: BASE=... DB=... node qa/scripts/qa-fixes-2-griefing.mjs [seconds=100] [attackerPollMs=100]
import pg from "pg"; import crypto from "node:crypto";
const BASE = process.env.BASE ?? "http://localhost:3203"; const PW = "Correct-Horse-Battery-9";
const DUR = Number(process.argv[2] ?? 100) * 1000, POLL = Number(process.argv[3] ?? 100);
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect(); await db.query("truncate rate_limits");
const ip = () => Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 250)).join(".");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (email, password) => { const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ email, password }) }); await r.text(); return { s: r.status, ra: +(r.headers.get("retry-after") ?? 0) }; };
const email = `qa-grief-${crypto.randomBytes(3).toString("hex")}@example.com`;
await fetch(BASE + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ email, password: PW, displayName: "G" }) });
const end = Date.now() + DUR; let atkReq = 0, atkEval = 0, ownerTries = 0, ownerOk = 0, owner429 = 0, firstOk = null; const t0 = Date.now();
const attacker = (async () => { while (Date.now() < end) { const r = await login(email, "guess" + atkReq++); if (r.s === 401) atkEval++; await sleep(POLL); } })();
const owner = (async () => { await sleep(2000); let wait = 0; while (Date.now() < end) { const r = await login(email, PW); ownerTries++; if (r.s === 200) { ownerOk++; firstOk ??= Date.now() - t0; break; } if (r.s === 429) { owner429++; wait = r.ra; } await sleep(wait * 1000 + Math.random() * 300); } })();
await Promise.all([attacker, owner]);
console.log(`[LD-13] attacker polling every ${POLL} ms for ${DUR / 1000}s (rotating XFF): ${atkReq} requests, ${atkEval} evaluated (each escalates the delay). Honest owner (obeys Retry-After): ${ownerTries} tries, ${owner429}×429, success=${ownerOk}${firstOk ? ` after ${(firstOk / 1000).toFixed(0)} s` : " (NEVER got a slot in the window)"}`);
// recovery: stop attacker, owner waits out cap
const left = (await db.query("select extract(epoch from (next_allowed_at-now()))::float w from login_throttle order by last_attempt_at desc limit 1")).rows[0]?.w ?? 0;
console.log(`[LD-13] attacker stopped; remaining delay ≈ ${Math.max(0, left).toFixed(0)} s`);
await sleep(Math.max(0, left) * 1000 + 200); const rec = await login(email, PW);
console.log(`[LD-13] owner login after attacker stops & delay elapses → ${rec.s}`);
await db.end();
