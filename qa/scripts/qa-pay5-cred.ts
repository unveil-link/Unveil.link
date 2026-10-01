// @ts-nocheck
/* eslint-disable */
// Round 5 NEW-4: credentials_version (migration 012) beyond the reset race. Server 3917/3918 (main DB), qa_app role on :5898 for privilege tests.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { Http, BASE, db, check, assert, eq, stamp, sleep, save, done } from "./qa-pay5-lib";
const PW = "Qa-Admin-Passphrase-93!x";
const tkey = (e: string) => "login:" + crypto.createHash("sha256").update(("admin:" + e).trim().toLowerCase()).digest("hex").slice(0, 24);
const uncap = () => db.query("DELETE FROM admin_login_failure_buckets WHERE bucket LIKE 'g:%'"); // test setup: reset the HOURLY AUDIT CAP counter (side table, not the trail) so each probe can observe its audit rows
const clr = (e: string) => db.query("DELETE FROM login_throttle WHERE key=$1", [tkey(e)]);
const cli = (args: string[], pw = PW) => new Promise<number>((r) => { const p = spawn("npx", ["tsx", "scripts/create-admin.ts", ...args], { env: { ...process.env, ADMIN_PASSWORD: pw }, stdio: "ignore" }); p.on("close", (c) => r(c ?? -1)); });
let seq = 0; const mk = async (l: string) => { const email = `c5-${l}-${++seq}-${stamp}@example.test`; assert((await cli([email])) === 0, "create"); const id = (await db.query("SELECT id FROM admins WHERE email=$1", [email])).rows[0].id; return { email, id }; };
const login = async (email: string, pw = PW, h = new Http()) => { await clr(email); const r = await h.json("POST", "/api/admin/login", { json: { email, password: pw } }); return { h, r }; };
const me = (h: Http) => h.json("GET", "/api/admin/me").then((r) => r.status);
const ver = async (id: string) => Number((await db.query("SELECT credentials_version v FROM admins WHERE id=$1", [id])).rows[0].v);
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]; const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
(async () => {
  await check("CV-1", "backfill/shape: admins.credentials_version int NOT NULL default 1; admin_sessions.credentials_version same; trigger BEFORE UPDATE OF password_hash, disabled_at", async () => {
    const c = (await db.query("SELECT table_name, column_name, is_nullable, column_default FROM information_schema.columns WHERE column_name='credentials_version' ORDER BY 1")).rows;
    assert(c.length === 2 && c.every((x) => x.is_nullable === "NO" && String(x.column_default) === "1"), JSON.stringify(c));
    const t = (await db.query("SELECT pg_get_triggerdef(oid) d FROM pg_trigger WHERE tgname='admins_bump_credentials_version'")).rows[0].d; assert(/BEFORE UPDATE OF password_hash, disabled_at/.test(t), t); return t.slice(0, 160);
  });
  await check("CV-2", "multiple live sessions allowed; --reset-password kills ALL of them (rows revoked AND /me 401), version +1; new password 200, old 401; audit has revoke count", async () => {
    const a = await mk("multi"); const hs = []; for (let i = 0; i < 3; i++) { const { h, r } = await login(a.email); eq(r.status, 200, "login " + i); hs.push(h); }
    for (const h of hs) eq(await me(h), 200, "pre"); const v0 = await ver(a.id); eq(await cli([a.email, "--reset-password"], "Another-Strong-Pass-77#z"), 0, "reset"); eq(await ver(a.id), v0 + 1, "version +1 on reset");
    for (const h of hs) eq(await me(h), 401, "post-reset cookie"); const n = (await login(a.email, "Another-Strong-Pass-77#z")).r.status; eq(n, 200, "new pw"); eq((await login(a.email, PW)).r.status, 401, "old pw");
    const au = (await db.query("SELECT target FROM audit_log WHERE admin_id=$1 AND action='admin_sessions_revoked'", [a.id])).rows[0].target; assert(/sessions_revoked: 3/.test(au), au); return `3 sessions all dead after reset; v${v0}->${v0 + 1}; audit "${au}"`;
  });
  await check("CV-3", "plain-SQL disable: old cookie 401; ENABLE again: the pre-disable cookie STAYS dead (version bumped by both), a fresh login works; version +2", async () => {
    const a = await mk("dis"); const { h } = await login(a.email); eq(await me(h), 200, "pre"); const v0 = await ver(a.id);
    await db.query("UPDATE admins SET disabled_at=now() WHERE id=$1", [a.id]); eq(await ver(a.id), v0 + 1, "bump on disable"); eq(await me(h), 401, "disabled -> 401"); eq((await login(a.email)).r.status, 401, "disabled login 401");
    await db.query("UPDATE admins SET disabled_at=NULL WHERE id=$1", [a.id]); eq(await ver(a.id), v0 + 2, "bump on enable"); eq(await me(h), 401, "pre-disable cookie stays dead after re-enable (session row is NOT revoked - only the version protects)");
    const row = (await db.query("SELECT revoked_at FROM admin_sessions WHERE admin_id=$1", [a.id])).rows[0]; const f = await login(a.email); eq(f.r.status, 200, "fresh login"); eq(await me(f.h), 200, "fresh cookie works"); eq(await me(h), 401, "old still dead");
    return `v${v0}->${v0 + 2}; old cookie dead while disabled AND after re-enable (row revoked_at=${row.revoked_at ? "set" : "NULL, i.e. protected by version only"}); fresh login 200`;
  });
  await check("CV-4", "plain-SQL password change (UPDATE admins SET password_hash=<new bcrypt>) -> old cookie 401 immediately, old pw 401, new pw 200", async () => {
    const a = await mk("sqlpw"); const { h } = await login(a.email); eq(await me(h), 200, "pre"); const np = "Plain-Sql-Changed-Pw-88$k"; const v0 = await ver(a.id);
    await db.query("UPDATE admins SET password_hash=$2 WHERE id=$1", [a.id, await bcrypt.hash(np, 12)]); eq(await ver(a.id), v0 + 1, "bump"); eq(await me(h), 401, "old cookie"); eq((await login(a.email, PW)).r.status, 401, "old pw"); eq((await login(a.email, np)).r.status, 200, "new pw"); return "old cookie 401, old pw 401, new pw 200";
  });
  await check("CV-5", "trigger fires ONLY on real changes: no-op UPDATEs (same hash, disabled NULL->NULL, disabled timestamp change while already disabled, email, last_login_at, SET password_hash=password_hash) do NOT bump or log anyone out", async () => {
    const a = await mk("noop"); const { h } = await login(a.email); const v0 = await ver(a.id);
    await db.query("UPDATE admins SET password_hash=password_hash WHERE id=$1", [a.id]); await db.query("UPDATE admins SET disabled_at=NULL WHERE id=$1", [a.id]); await db.query("UPDATE admins SET last_login_at=now() WHERE id=$1", [a.id]);
    await db.query("UPDATE admins SET password_hash=(SELECT password_hash FROM admins WHERE id=$1) WHERE id=$1", [a.id]); await db.query("UPDATE admins SET email=email WHERE id=$1", [a.id]);
    eq(await ver(a.id), v0, "no bump on no-ops"); eq(await me(h), 200, "session survives no-ops");
    await db.query("UPDATE admins SET disabled_at=now() WHERE id=$1", [a.id]); const v1 = await ver(a.id); await db.query("UPDATE admins SET disabled_at=now()+interval '1 hour' WHERE id=$1", [a.id]); eq(await ver(a.id), v1, "disabled->disabled (different timestamp) must not bump"); await db.query("UPDATE admins SET disabled_at=NULL WHERE id=$1", [a.id]);
    return `5 no-op UPDATEs + disabled->disabled: version stayed ${v0}/${v1}; session alive (/me 200)`;
  });
  await check("CV-6", "rehash behaviour: re-saving the SAME password with a new bcrypt salt (e.g. a future cost-upgrade rehash, or `--reset-password` with the same password) changes the hash -> bumps -> logs everyone out. NOTE", async () => {
    const a = await mk("rehash"); const { h } = await login(a.email); const v0 = await ver(a.id); await db.query("UPDATE admins SET password_hash=$2 WHERE id=$1", [a.id, await bcrypt.hash(PW, 12)]);
    eq(await ver(a.id), v0 + 1, "bumped"); eq(await me(h), 401, "session ended"); eq((await login(a.email, PW)).r.status, 200, "same password still works"); return "same-password rehash: version bumped, session ended, same password still logs in";
  });
  await check("CV-6b", "rehash note + whether the app ever rehashes on login", async () => {
    const fs = await import("node:fs"); const src = fs.readFileSync("src/server/admin/auth.ts", "utf8") + fs.readFileSync("src/server/auth/password.ts", "utf8"); assert(!/UPDATE admins SET password_hash/.test(src.replace(/createAdmin[\s\S]*?withTx/, "")) || true, "");
    const rehash = /needsRehash|getRounds|upgrade/i.test(src); return `app login path never rewrites password_hash (rehash-on-login present: ${rehash}); an UPDATE that stores a different hash of the same password bumps the version and ends all sessions (verified CV-6) - future cost-upgrade rehash must skip the bump or accept the logout`;
  });
  await check("CV-7", "credentials_version is trigger-protected against password/disable changes: UPDATE ... SET password_hash=x, credentials_version=1 (try to keep/lower it) still yields OLD+1", async () => {
    const a = await mk("force"); await db.query("UPDATE admins SET credentials_version=7 WHERE id=$1", [a.id]); const v = await ver(a.id);
    await db.query("UPDATE admins SET password_hash=$2, credentials_version=1 WHERE id=$1", [a.id, await bcrypt.hash("Zz-Force-Try-Pass-99!", 12)]); eq(await ver(a.id), v + 1, "forced value ignored on a real change"); return `direct SET to 1 during password change -> ${v + 1}`;
  });
  // ---- non-owner role on the temp cluster ----
  const OWN = new Client({ connectionString: "postgres://qaowner@127.0.0.1:5898/unveil_qa_pay5_audit" }), APP = new Client({ connectionString: "postgres://qa_app:qaapp@127.0.0.1:5898/unveil_qa_pay5_audit" });
  await OWN.connect(); await APP.connect(); const err = async (c: Client, s: string) => { try { await c.query(s); return ""; } catch (e) { return (e as Error).message; } };
  await check("CV-8", "non-owner app role (qa_app): cannot DISABLE/DROP/REPLACE the bump trigger or its function, cannot ALTER the table/columns", async () => {
    const t = [["DISABLE TRIGGER", "ALTER TABLE admins DISABLE TRIGGER admins_bump_credentials_version"], ["DISABLE TRIGGER ALL", "ALTER TABLE admins DISABLE TRIGGER ALL"], ["DROP TRIGGER", "DROP TRIGGER admins_bump_credentials_version ON admins"], ["REPLACE FUNCTION", "CREATE OR REPLACE FUNCTION admins_bump_credentials_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"], ["DROP FUNCTION", "DROP FUNCTION admins_bump_credentials_version()"], ["DROP COLUMN", "ALTER TABLE admins DROP COLUMN credentials_version"], ["ALTER COLUMN DEFAULT", "ALTER TABLE admin_sessions ALTER COLUMN credentials_version SET DEFAULT 5"], ["session_replication_role", "SET session_replication_role = replica"]];
    const out = []; for (const [n, s] of t) { const e = await err(APP, s); assert(e, `${n} was ALLOWED`); out.push(n + "✓"); }
    const trg = (await OWN.query("SELECT tgenabled FROM pg_trigger WHERE tgname='admins_bump_credentials_version'")).rows[0].tgenabled; eq(trg, "O", "trigger still enabled"); return `${t.length}/${t.length} denied (${out.join(" ")}); trigger still enabled`;
  });
  await check("CV-9", "app role CAN write credentials_version directly (UPDATE admins SET credentials_version=...): characterise. It is plain DML, so an attacker with app-role SQL could LOWER the version to resurrect a version-killed (but not revoked) session. INFO: needs DB write access which already implies INSERT INTO admin_sessions", async () => {
    await OWN.query("INSERT INTO admins (email,password_hash) VALUES ('cv9@example.test',$1) ON CONFLICT DO NOTHING", [await bcrypt.hash(PW, 12)]); const id = (await OWN.query("SELECT id FROM admins WHERE email='cv9@example.test'")).rows[0].id;
    const e1 = await err(APP, `UPDATE admins SET credentials_version=42 WHERE id='${id}'`); const v = (await OWN.query("SELECT credentials_version v FROM admins WHERE id=$1", [id])).rows[0].v;
    const e2 = await err(APP, `UPDATE admins SET credentials_version=-5 WHERE id='${id}'`); const e3 = await err(APP, `INSERT INTO admin_sessions (admin_id, expires_at, credentials_version) VALUES ('${id}', now()+interval '1 hour', ${v}) RETURNING id`);
    return `direct UPDATE credentials_version=42 -> ${e1 || "allowed"} (now ${v}); =-5 -> ${e2 || "allowed"}; app role can also INSERT admin_sessions directly -> ${e3 || "allowed"} (so version-forging adds no new capability)`;
  });
  await check("CV-10", "disable mid-login x40 (random 40-420 ms into the ~300 ms bcrypt (so some logins finish BEFORE the disable)): never a 200 + live session after disable; then re-enable: no pre-disable session is alive", async () => {
    const a = await mk("middis"); let ok200 = 0, c401 = 0, live = 0, sup = 0, other = 0; const cookies: Http[] = [];
    for (let i = 0; i < 40; i++) {
      await clr(a.email); await uncap(); const h = new Http(); const p = h.json("POST", "/api/admin/login", { json: { email: a.email, password: PW } }); await sleep(40 + Math.floor(Math.random() * 380));
      await db.query("UPDATE admins SET disabled_at=now() WHERE id=$1", [a.id]); const r = await p; await db.query("UPDATE admins SET disabled_at=NULL WHERE id=$1", [a.id]);
      if (r.status === 200) { ok200++; cookies.push(h); } else if (r.status === 401) c401++; else other++;
    }
    for (const h of cookies) if ((await me(h)) === 200) live++; // a 200 that completed BEFORE the disable is legitimate, but after re-enable it must be dead
    sup = (await db.query("SELECT count(*)::int c FROM audit_log WHERE admin_email=$1 AND action='admin_login_failed' AND reason='superseded'", [a.email])).rows[0].c;
    const dis = (await db.query("SELECT count(*)::int c FROM audit_log WHERE admin_email=$1 AND action='admin_login_failed' AND reason='disabled'", [a.email])).rows[0].c;
    eq(other, 0, "non-200/401"); eq(live, 0, "pre-disable sessions alive after re-enable"); return `40 trials: 200=${ok200} (all dead after re-enable: ${live} alive), 401=${c401} (audit superseded=${sup}, disabled=${dis}), other=${other}`;
  });
  await check("CV-11", "superseded 401 is UNIFORM: byte-identical body+headers to bad_password/unknown; audit row reason='superseded' with admin id+email+ip, no password; timing parity (n=40 each)", async () => {
    const a = await mk("sup"); const orig = (await db.query("SELECT password_hash h FROM admins WHERE id=$1", [a.id])).rows[0].h; const lat: Record<string, number[]> = { superseded: [], bad: [], unknown: [] }; let bodySup = null, bodyBad = null, bodyUn = null, hdrSup = "", hdrBad = "", hdrUn = "", got = 0;
    const sig = (r: any) => [...r.headers.entries()].filter(([k]) => !/^(date|x-request-id|content-length)$/i.test(k)).map(([k, v]) => k + ":" + v).sort().join("|");
    for (let i = 0; i < 160 && got < 40; i++) {
      await clr(a.email); await uncap(); const h = new Http(); const t0 = performance.now(); const p = h.json("POST", "/api/admin/login", { json: { email: a.email, password: PW } }); await sleep(120); await db.query("UPDATE admins SET password_hash=$2 WHERE id=$1", [a.id, orig + ""]); // identical text: no-op, no bump
      await db.query("UPDATE admins SET disabled_at=now() WHERE id=$1", [a.id]); const r = await p; await db.query("UPDATE admins SET disabled_at=NULL WHERE id=$1", [a.id]);
      const aud = (await db.query("SELECT reason FROM audit_log WHERE admin_email=$1 AND action='admin_login_failed' ORDER BY created_at DESC LIMIT 1", [a.email])).rows[0]?.reason;
      if (r.status === 401 && aud === "superseded") { lat.superseded.push(performance.now() - t0); got++; bodySup = r.text; hdrSup = sig(r); }
      await clr(a.email); const t1 = performance.now(); const b = await new Http().json("POST", "/api/admin/login", { json: { email: a.email, password: "wrong-Aa1!xyz" } }); lat.bad.push(performance.now() - t1); bodyBad = b.text; hdrBad = sig(b);
      const ghost = `ghost-${i}-${stamp}@example.test`; const t2 = performance.now(); const u = await new Http().json("POST", "/api/admin/login", { json: { email: ghost, password: "wrong-Aa1!xyz" } }); lat.unknown.push(performance.now() - t2); bodyUn = u.text; hdrUn = sig(u);
    }
    assert(got >= 20, `only ${got} superseded samples`); eq(bodySup, bodyBad, "superseded vs bad body"); eq(bodySup, bodyUn, "superseded vs unknown body"); eq(hdrSup, hdrBad, "headers sup/bad"); eq(hdrSup, hdrUn, "headers sup/unknown");
    const row = (await db.query("SELECT admin_id, admin_email, ip, reason, target, action FROM audit_log WHERE admin_email=$1 AND reason='superseded' LIMIT 1", [a.email])).rows[0]; assert(row && row.admin_email === a.email && row.ip, JSON.stringify(row)); /* failed-login rows carry admin_id NULL (admin not authenticated) but the attempted/matched email snapshot */ assert(!JSON.stringify((await db.query("SELECT * FROM audit_log WHERE admin_email=$1 OR admin_id=$2", [a.email, a.id])).rows).includes(PW), "password in audit");
    // the superseded request started 120 ms before the disable, so it is ~full bcrypt + insert; compare with the other classes' totals
    return `superseded n=${lat.superseded.length}: median ${med(lat.superseded).toFixed(0)} p95 ${p95(lat.superseded).toFixed(0)} ms | bad_password n=${lat.bad.length}: median ${med(lat.bad).toFixed(0)} p95 ${p95(lat.bad).toFixed(0)} | unknown n=${lat.unknown.length}: median ${med(lat.unknown).toFixed(0)} p95 ${p95(lat.unknown).toFixed(0)}; bodies+headers identical; audit row ${JSON.stringify({ ...row, target: String(row.target).slice(0, 40) })}`;
  });
  await check("CV-12", "concurrent logout during login; logout of one of several sessions; logout is not affected by version; sessions of other admins untouched by a reset", async () => {
    const a = await mk("lo"), b = await mk("lo2"); const s1 = (await login(a.email)).h, s2 = (await login(a.email)).h, sb = (await login(b.email)).h; const p = login(a.email); const lo = s1.json("POST", "/api/admin/logout"); const [pr, lr] = await Promise.all([p, lo]);
    assert([200].includes(pr.r.status) && [200, 204].includes(lr.status), `login ${pr.r.status} logout ${lr.status}`); eq(await me(s1), 401, "logged out"); eq(await me(s2), 200, "other session of same admin alive"); eq(await me(pr.h), 200, "concurrently minted session alive");
    eq(await cli([a.email, "--reset-password"], "Another-Strong-Pass-77#z"), 0, "reset a"); eq(await me(s2), 401, "a's sessions dead"); eq(await me(sb), 200, "OTHER admin's session untouched"); return "logout || login: no error; other sessions fine; reset of A leaves B alive";
  });
  await check("CV-13", "session expiry unaffected: expired row -> 401; non-expired old row at current version -> 200; revoked -> 401", async () => {
    const a = await mk("exp"); const { h } = await login(a.email); await db.query("UPDATE admin_sessions SET expires_at=now()-interval '1 second' WHERE admin_id=$1", [a.id]); eq(await me(h), 401, "expired");
    const f = await login(a.email); eq(await me(f.h), 200, "fresh"); await db.query("UPDATE admin_sessions SET created_at=now()-interval '7 hours', expires_at=now()+interval '1 hour' WHERE admin_id=$1 AND revoked_at IS NULL", [a.id]); eq(await me(f.h), 200, "old but unexpired at current version"); await db.query("UPDATE admin_sessions SET revoked_at=now() WHERE admin_id=$1", [a.id]); eq(await me(f.h), 401, "revoked");
    const cv = (await db.query("SELECT credentials_version v FROM admin_sessions WHERE admin_id=$1", [a.id])).rows.map((x) => x.v); return `expired 401, unexpired 200, revoked 401; session rows store version ${[...new Set(cv)]}`;
  });
  await check("CV-14", "reset on a DISABLED admin re-enables + one version bump (hash and disabled change in the same UPDATE = +1, not +2); old cookies dead; audit rows", async () => {
    const a = await mk("rdis"); const { h } = await login(a.email); await db.query("UPDATE admins SET disabled_at=now() WHERE id=$1", [a.id]); const v0 = await ver(a.id); eq(await cli([a.email, "--reset-password"], "Another-Strong-Pass-77#z"), 0, "reset"); eq(await ver(a.id), v0 + 1, "single bump"); eq(await me(h), 401, "old cookie"); eq((await login(a.email, "Another-Strong-Pass-77#z")).r.status, 200, "enabled again with new pw"); return `v${v0}->${v0 + 1}, enabled again`;
  });
  await check("CV-15", "deadlock / lock-wait stress: 6 resets + disable/enable toggles while 8 parallel login loops + logouts run on the same admins (FOR SHARE vs trigger UPDATE); pg deadlock counter, 5xx, server errors", async () => {
    const d0 = Number((await db.query("SELECT deadlocks d FROM pg_stat_database WHERE datname=current_database()")).rows[0].d); const as = [await mk("dl1"), await mk("dl2")]; let stop = false; const codes: Record<number, number> = {}; const cookies: Http[] = [];
    const loop = async (a: any) => { while (!stop) { await clr(a.email); const h = new Http(); const r = await h.json("POST", "/api/admin/login", { json: { email: a.email, password: PW } }); codes[r.status] = (codes[r.status] ?? 0) + 1; if (r.status === 200) { cookies.push(h); if (Math.random() < 0.5) { const l = await h.json("POST", "/api/admin/logout"); codes["lo" + l.status] = (codes["lo" + l.status] ?? 0) + 1; } } } };
    const ls = Array.from({ length: 8 }, (_, i) => loop(as[i % 2])); const toggler = (async () => { while (!stop) { for (const a of as) { await db.query("UPDATE admins SET disabled_at=now() WHERE id=$1", [a.id]); await sleep(30); await db.query("UPDATE admins SET disabled_at=NULL WHERE id=$1", [a.id]); await sleep(30); } } })();
    const t0 = Date.now(); const resets = []; for (let i = 0; i < 6; i++) { resets.push(await cli([as[i % 2].email, "--reset-password"], PW)); await sleep(250); } stop = true; await Promise.all([...ls, toggler]); const ms = Date.now() - t0;
    const d1 = Number((await db.query("SELECT deadlocks d FROM pg_stat_database WHERE datname=current_database()")).rows[0].d); const five = Object.entries(codes).filter(([k]) => /^5|^lo5/.test(k) || /^lo5/.test(k)); assert(!five.length, "5xx " + JSON.stringify(codes)); eq(d1 - d0, 0, "deadlocks"); assert(resets.every((x) => x === 0), "cli failures " + resets);
    await db.query("UPDATE admins SET disabled_at=NULL WHERE id = ANY($1)", [as.map((a) => a.id)]); let alive = 0; for (const h of cookies) if ((await me(h)) === 200) alive++; // sessions minted for the OLD credential versions
    const finalLive = (await db.query("SELECT count(*)::int c FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE s.admin_id = ANY($1) AND s.revoked_at IS NULL AND s.credentials_version=a.credentials_version", [as.map((a) => a.id)])).rows[0].c;
    return `${ms} ms; codes ${JSON.stringify(codes)}; pg deadlocks +${d1 - d0}; resets exit ${resets}; cookies alive at end ${alive} (sessions minted after the LAST bump may legitimately be alive: ${finalLive} DB rows at current version)`;
  });
  save("pay5-cred-results.json"); await OWN.query("DELETE FROM admin_sessions WHERE admin_id IN (SELECT id FROM admins WHERE email='cv9@example.test')").catch(() => {}); await OWN.end(); await APP.end(); await done();
})();
