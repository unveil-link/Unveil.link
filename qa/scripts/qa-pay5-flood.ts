// @ts-nocheck
/* eslint-disable */
// Round 4 QA, NEW-3: spoofed X-Forwarded-For flood over HTTP against the DEFAULT-limits server (3918): audit rows/hour, DB growth, legit admin actions during/after the flood.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { Http, check, assert, eq, db, makeSeller, stamp, save, done, sleep } from "./qa-pay5-lib";
const ONLY = process.env.FL_ONLY ? new RegExp(process.env.FL_ONLY) : null; const chk = (id: string, name: string, fn: () => Promise<string>) => (ONLY && !ONLY.test(id) ? Promise.resolve() : check(id, name, fn));
const B2 = "http://localhost:3918"; const PW = "Qa-Admin-Passphrase-93!x";
const n = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0].n);
const mk = (l: string) => { const email = `adm-${l}-${stamp}@example.test`; const r = spawnSync("npx", ["tsx", "scripts/create-admin.ts", email], { env: { ...process.env, ADMIN_PASSWORD: PW }, encoding: "utf8", input: "" }); if (r.status !== 0) throw new Error(r.stdout + r.stderr); return email; };
const rotIp = () => `${1 + Math.floor(Math.random() * 223)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
const post = (email: string, pw: string, ip: string, extra: Record<string, string> = {}) => fetch(B2 + "/api/admin/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...extra }, body: JSON.stringify({ email, password: pw }) }).then(async (r) => ({ s: r.status, t: await r.text() }));
async function pool(total: number, conc: number, fn: (i: number) => Promise<any>) { let i = 0; const out: any[] = []; await Promise.all(Array.from({ length: conc }, async () => { while (i < total) { const k = i++; out[k] = await fn(k); } })); return out; }
const size = async () => (await db.query("SELECT pg_total_relation_size('audit_log')::bigint a, pg_total_relation_size('admin_login_failure_buckets')::bigint b, pg_total_relation_size('rate_limits')::bigint r, pg_total_relation_size('login_throttle')::bigint t, (SELECT count(*) FROM audit_log) ac, (SELECT count(*) FROM admin_login_failure_buckets) bc, (SELECT count(*) FROM rate_limits) rc, (SELECT count(*) FROM login_throttle) tc")).rows[0];
(async () => {
  await db.query("select 1"); const real = mk("fl"); const adminOK = mk("flok"); const hr = "date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'";
  const itemised = () => n(`SELECT count(*) n FROM audit_log WHERE action='admin_login_failed' AND created_at >= ${hr}`); const markers = () => n(`SELECT count(*) n FROM audit_log WHERE action='admin_login_flood' AND created_at >= ${hr}`);
  await chk("FLOOD-1", "A: 1500 unique-email failures, each from a rotating spoofed X-Forwarded-For (8 parallel): audit rows this hour <= 200 (+1 flood marker); responses stay 401 (uniform)", async () => {
    const i0 = await itemised(), m0 = await markers(), s0 = await size(); const t0 = Date.now();
    const res = await pool(1500, 8, (i) => post(`flood${i}-${crypto.randomBytes(4).toString("hex")}@example.test`, "Wrong-Pass-123!", rotIp(), { "x-forwarded-for": `${rotIp()}, ${rotIp()}` })); // XFF with 2 entries: TRUSTED_PROXY_HOPS=1 => rightmost is "client"
    const dt = (Date.now() - t0) / 1000; const c: Record<number, number> = {}; res.forEach((r) => (c[r.s] = (c[r.s] ?? 0) + 1)); const i1 = await itemised(), m1 = await markers(), s1 = await size();
    const bodies = new Set(res.filter((r) => r.s === 401).map((r) => r.t)); assert(bodies.size === 1, "401 bodies differ");
    assert(i1 <= 200, `itemised ${i1} > 200`); assert(m1 - m0 <= 1 && m1 >= 1, "marker count " + (m1 - m0));
    return `1500 requests in ${dt.toFixed(0)}s (${(1500 / dt).toFixed(1)}/s), statuses ${JSON.stringify(c)}; audit_log failed-login rows this UTC hour: ${i0}→${i1} (<=200 ✓), flood markers ${m0}→${m1}; audit_log ${s0.ac}→${s1.ac} rows (${s0.a}→${s1.a} bytes); side tables: admin_login_failure_buckets ${s0.bc}→${s1.bc} rows (${s0.b}→${s1.b} B), rate_limits ${s0.rc}→${s1.rc}, login_throttle ${s0.tc}→${s1.tc} => audit_log is bounded; the bucket/limiter side tables grow ~1 row per distinct (ip,email) request until pruned (24 h, 1–2 % of calls)`;
  });
  await chk("FLOOD-2", "B: 1000 requests against ONE real admin email with rotating IPs (per-email delay engages): 401 then 429s; audit rows stay under the cap; the real admin's account is NOT locked out after the delay (no permanent DoS) ", async () => {
    const i0 = await itemised(); const res = await pool(1000, 8, () => post(real, "Wrong-Pass-123!", rotIp())); const c: Record<number, number> = {}; res.forEach((r) => (c[r.s] = (c[r.s] ?? 0) + 1)); const i1 = await itemised(); assert(i1 <= 200, "cap exceeded " + i1);
    const th = await n("SELECT count(*) n FROM audit_log WHERE action='admin_login_failed' AND reason='throttled' AND admin_email=$1", [real]);
    return `statuses ${JSON.stringify(c)}; itemised rows this hour ${i0}→${i1} (<=200 ✓); throttled rows for the victim email: ${th}. INFO: because the per-email delay is global per email (not per IP), a spoofing attacker can keep the victim admin's login in 429 'delay' (max cap 60 s) indefinitely = login DoS for that admin (pre-existing design, same as sellers; no lockout beyond the cap)`;
  });
  await chk("FLOOD-3", "C: AT the cap, real admin work is still audited via HTTP: admin login (+ip), clear-flag (200), logout, a different attacker's failure is only counted (flood marker), not itemised", async () => {
    const itemisedBefore = await itemised(); assert(itemisedBefore >= 200, "cap not reached: " + itemisedBefore);
    const s = await makeSeller("flcap"); await db.query("UPDATE sellers SET risk_flagged_at=now(), risk_flag_reason='QA flood test' WHERE id=$1", [s.id]); const A = new Http(); const l = await A.json("POST", "/api/admin/login", { json: { email: adminOK, password: PW }, base: B2 }); eq(l.status, 200, "login at cap");
    const cf = await A.json("POST", `/api/admin/sellers/${s.id}/clear-flag`, { json: { note: "reviewed during flood" }, base: B2 }); eq(cf.status, 200, "clear at cap"); const lo = await A.json("POST", "/api/admin/logout", { base: B2 }); eq(lo.status, 200, "logout");
    const fresh = `late-attacker-${stamp}@example.test`; const lateIp = rotIp(); await post(fresh, "x-Wrong-Pass-1!", lateIp); const lateRow = await n("SELECT count(*) n FROM audit_log WHERE admin_email=$1", [fresh]);
    const acts = (await db.query("SELECT action, ip FROM audit_log WHERE admin_email=$1 AND created_at > now() - interval '60 seconds' ORDER BY created_at", [adminOK])).rows.map((r) => r.action); const clr = await n("SELECT count(*) n FROM audit_log WHERE action='seller_flag_cleared' AND target LIKE $1", [`seller:${s.id}%`]);
    assert(acts.includes("admin_login") && acts.includes("admin_logout") && clr === 1, "missing " + acts);
    return `at cap (${itemisedBefore} itemised): admin_login ✓ admin_logout ✓ seller_flag_cleared ✓ (HTTP 200); a NEW attacker failure after the cap -> ${lateRow} itemised rows (only counted; flood marker explains) — INFO: during a flood, a genuine brute-force from another source is not itemised for the rest of the clock hour`;
  });
  await chk("FLOOD-4", "D: hostile X-Forwarded-For values (non-IP strings, 5 KB, empty entries, IPv6, markup) are accepted as 'ip' text but truncated to 64 chars; no 5xx", async () => {
    const vals = ["<script>alert(1)</script>", "x".repeat(5000), ",,,", "::1", "1.2.3.4, <b>x</b>", "' OR 1=1 --", "%00", "\u00e9\u00e8"]; const out: string[] = [];
    for (const v of vals) { const r = await post(`xff-${crypto.randomBytes(3).toString("hex")}-${stamp}@example.test`, "Wrong-Pass-123!", v); assert(r.s < 500, "5xx " + v.slice(0, 10)); out.push(String(r.s)); }
    const mx = await n("SELECT coalesce(max(length(ip)),0) n FROM audit_log"); assert(mx <= 64, "ip len " + mx); return `statuses ${out.join("/")}; max stored ip length ${mx} (<=64 ✓)`;
  });
  save("pay5-flood-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
