// Rate-limit + password-reset smoke against backend/fixes-1 (app started WITH default rate limits). Usage: BASE=... DB=... node qa/scripts/qa-fixes-1-ratelimit.mjs
import pg from "pg"; import crypto from "node:crypto"; import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3201";
const post = (p, body, h = {}) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
const tally = (a) => a.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const email = `qa-rl-${crypto.randomBytes(3).toString("hex")}@example.com`; const PW = "Correct-Horse-Battery-9";
const ip = () => Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 250)).join(".");
const s = await post("/api/auth/signup", { email, password: PW, displayName: "RL" }, { "x-forwarded-for": ip() });
console.log("[M2-17] signup", s.status);
const c = []; let ra; for (let i = 0; i < 15; i++) { const r = await post("/api/auth/login", { email, password: "bad" + i }, { "x-forwarded-for": "9.9.9.9" }); c.push(r.status); ra = r.headers.get("retry-after") ?? ra; }
console.log(`[M2-17] 15 wrong logins, same IP+email -> ${JSON.stringify(tally(c))} Retry-After=${ra}`);
const good = await post("/api/auth/login", { email, password: PW }, { "x-forwarded-for": "9.9.9.9" });
console.log(`[M2-17] correct password from the throttled IP/email -> ${good.status} (legit user locked out while window open)`);
const c2 = []; for (let i = 0; i < 15; i++) c2.push((await post("/api/auth/login", { email: `victim-${i}@example.com`, password: "x" }, { "x-forwarded-for": "7.7.7.7" })).status);
console.log(`[M2-17] 15 logins, 15 different emails, same IP -> ${JSON.stringify(tally(c2))}`);
const c3 = []; for (let i = 0; i < 25; i++) c3.push((await post("/api/auth/login", { email: `victim2-${i}@example.com`, password: "x" }, { "x-forwarded-for": ip() })).status);
console.log(`[M2-17] 25 logins with ROTATING spoofed X-Forwarded-For, 25 emails -> ${JSON.stringify(tally(c3))} (per-IP limit bypassable when app is directly exposed; per-email limit still holds)`);
const c4 = []; for (let i = 0; i < 25; i++) c4.push((await post("/api/auth/login", { email, password: "bad" }, { "x-forwarded-for": ip() })).status);
console.log(`[M2-17] 25 wrong logins for ONE email with rotating XFF -> ${JSON.stringify(tally(c4))}`);
// preview/download
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const f = (await db.query("select id from drop_files limit 1")).rows[0].id; const st = [];
for (let i = 0; i < 80; i++) st.push((await fetch(`${BASE}/api/files/${f}/original?exp=1&sig=x`, { headers: { "x-forwarded-for": "5.5.5.5" } })).status);
console.log(`[M2-17] 80 sequential /original (bad sig) same IP -> ${JSON.stringify(tally(st))}`);
const o = await fetch(`${BASE}/api/files/${f}/original?exp=1&sig=x`, { headers: { "x-forwarded-for": "6.6.6.6" } }); console.log(`[M2-17] other IP unaffected: ${o.status}`);
const cs = []; for (let i = 0; i < 14; i++) cs.push((await post("/api/checkout", {}, { "x-forwarded-for": "4.4.4.4" })).status); console.log(`[M2-17] /api/checkout x14 -> ${JSON.stringify(tally(cs))}`);
// password reset (fresh account: the one above is now throttled by the per-email login limit)
const email2 = `qa-rs-${crypto.randomBytes(3).toString("hex")}@example.com`; await post("/api/auth/signup", { email: email2, password: PW, displayName: "RS" }, { "x-forwarded-for": ip() });
const before = fs.existsSync(process.env.MAIL_DEV_DIR) ? fs.readdirSync(process.env.MAIL_DEV_DIR).length : 0;
const fp = await post("/api/auth/forgot-password", { email: email2 }, { "x-forwarded-for": ip() });
// mail is written asynchronously after the response: poll for a mail addressed to this account
let mail = "", files = [];
for (let i = 0; i < 40 && !mail; i++) { await new Promise((r) => setTimeout(r, 250)); files = fs.readdirSync(process.env.MAIL_DEV_DIR).filter((f) => f.endsWith(".json")); for (const f of files) { const j = JSON.parse(fs.readFileSync(process.env.MAIL_DEV_DIR + "/" + f, "utf8")); if (j.to === email2) mail = j.text; } }
const tok = mail.match(/token=([A-Za-z0-9_-]+)/)?.[1];
console.log(`[M1-04] forgot-password=${fp.status}; mails before=${before}; mail to ${email2} found=${!!mail}; link present=${!!tok}; mail text has no marketing/adult wording: ${!/adult|nsfw|explicit|promo|offer/i.test(mail)}`);
const loginOld = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ email: email2, password: PW }) }); const oldCookie = loginOld.headers.getSetCookie()[0].split(";")[0];
const NEW = "Another-Strong-Pass-77";
const rs = await post("/api/auth/reset-password", { token: tok, password: NEW }, { "x-forwarded-for": ip() });
const rs2 = await post("/api/auth/reset-password", { token: tok, password: NEW + "x" }, { "x-forwarded-for": ip() });
const me = await fetch(BASE + "/api/auth/me", { headers: { cookie: oldCookie } });
const l1 = await post("/api/auth/login", { email: email2, password: PW }, { "x-forwarded-for": ip() }); const l2 = await post("/api/auth/login", { email: email2, password: NEW }, { "x-forwarded-for": ip() });
console.log(`[M1-04] reset=${rs.status}; token reuse=${rs2.status}; pre-reset session now ${me.status}; old password login=${l1.status}; new password login=${l2.status}`);
const bad = await post("/api/auth/reset-password", { token: "x".repeat(40), password: NEW }, { "x-forwarded-for": ip() }); console.log(`[M1-04] bogus token=${bad.status} ${await bad.text()}`);
await db.end();
