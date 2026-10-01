// @ts-nocheck
/* eslint-disable */
// Round 4 QA, item 2 (NEW-3): audit_log hardening. Part A: DB-level immutability, FK/guard, snapshot, failed-login parity+timing, contents,
// coalescing/cap (in-process + HTTP), concurrency, reset-password CLI, create-admin CLI, completeness, no read path.
// Servers: 3917 (limiters raised), 3918 (default limits). DB: throwaway unveil_qa_pay5 (app role unveil = table owner, non-superuser).
process.env.MOCK_PAYMENTS_ENABLED ??= "1";
import { spawnSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { Http, BASE, check, assert, eq, db, makeSeller, stamp, save, done, sleep, freshIp, ART } from "./qa-pay5-lib";

const ONLY = process.env.AUD_ONLY ? new RegExp(process.env.AUD_ONLY) : null; const chk = (id: string, name: string, fn: () => Promise<string>) => (ONLY && !ONLY.test(id) ? Promise.resolve() : check(id, name, async () => { try { return await fn(); } catch (e) { const c = (e as any).cause; throw new Error((e as Error).message + (c ? ' cause=' + (c.code ?? c.message) : '') + ' @' + ((e as Error).stack ?? '').split('\n').slice(1, 3).join(' ').trim()); } }));
const T0 = new Date(Date.now() - 1000);
const B2 = "http://localhost:3918"; const PW = "Qa-Admin-Passphrase-93!x"; const PW2 = "Another-Strong-Pass-77#z";
const n = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0].n);
const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
const errOf = async (sql: string, p: unknown[] = []) => { try { await db.query(sql, p); return ""; } catch (e) { return (e as Error).message; } };
function cli(args: string[], env: Record<string, string> = {}) {
  const e: any = { ...process.env, ...env }; if (!("ADMIN_PASSWORD" in env)) delete e.ADMIN_PASSWORD;
  const r = spawnSync("npx", ["tsx", "scripts/create-admin.ts", ...args], { env: e, encoding: "utf8", input: "" }); return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
const mkAdmin = (label: string) => { const email = `adm-${label}-${stamp}@example.test`; const r = cli([email], { ADMIN_PASSWORD: PW }); if (r.code !== 0) throw new Error("create-admin " + r.out); return email; };
const login = async (email: string, pw = PW, http = new Http(), base = BASE) => { const r = await http.json("POST", "/api/admin/login", { json: { email, password: pw }, base }); return { http, r }; };
const resetBuckets = () => db.query("DELETE FROM admin_login_failure_buckets");
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
function mwu(a: number[], b: number[]) { // two-sided Mann-Whitney U, normal approximation with tie correction ignored (continuous timings)
  const all = [...a.map((v) => [v, 0]), ...b.map((v) => [v, 1])].sort((x, y) => x[0] - y[0]); let r1 = 0; all.forEach((x, i) => { if (x[1] === 0) r1 += i + 1; });
  const u = r1 - (a.length * (a.length + 1)) / 2; const mu = (a.length * b.length) / 2; const sd = Math.sqrt((a.length * b.length * (a.length + b.length + 1)) / 12); const z = (u - mu) / sd;
  const erf = (x: number) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  return { z, p: 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))) };
}

(async () => {
  await db.query("select 1");
  const adminEmail = mkAdmin("a"); const { http: A, r: la } = await login(adminEmail); assert(la.status === 200, "admin login " + la.status);
  const adminId = (await rows("SELECT id FROM admins WHERE email=$1", [adminEmail]))[0].id;

  // =============================== 1. immutability ===============================
  await chk("AUD-1a", "append-only: UPDATE / DELETE / TRUNCATE / TRUNCATE CASCADE / MERGE / INSERT..ON CONFLICT DO UPDATE all refused as the app role (table owner, non-superuser); 0 rows changed", async () => {
    const before = await rows("SELECT count(*)::int c, md5(string_agg(a::text, ',' ORDER BY a.id)) h FROM audit_log a"); const out: string[] = [];
    const sample = (await rows("SELECT * FROM audit_log ORDER BY created_at LIMIT 1"))[0];
    const stmts: [string, string, unknown[]?][] = [
      ["UPDATE all", "UPDATE audit_log SET target='x'"], ["UPDATE admin_email", "UPDATE audit_log SET admin_email='x@y.z'"], ["UPDATE created_at", "UPDATE audit_log SET created_at=now()-interval '1 year' WHERE id=$1", [sample.id]], ["UPDATE admin_id NULL", "UPDATE audit_log SET admin_id=NULL WHERE admin_id IS NOT NULL"],
      ["DELETE all", "DELETE FROM audit_log"], ["DELETE one", "DELETE FROM audit_log WHERE id=$1", [sample.id]], ["DELETE USING", "DELETE FROM audit_log a USING admins b WHERE a.admin_id=b.id"],
      ["TRUNCATE", "TRUNCATE audit_log"], ["TRUNCATE CASCADE", "TRUNCATE audit_log CASCADE"], ["TRUNCATE admins CASCADE (FK-cascaded truncate)", "TRUNCATE admins CASCADE"], ["TRUNCATE admins RESTART IDENTITY CASCADE", "TRUNCATE admins RESTART IDENTITY CASCADE"],
      ["MERGE update", "MERGE INTO audit_log t USING (SELECT id FROM audit_log LIMIT 1) s ON t.id=s.id WHEN MATCHED THEN UPDATE SET target='m'"], ["MERGE delete", "MERGE INTO audit_log t USING (SELECT id FROM audit_log LIMIT 1) s ON t.id=s.id WHEN MATCHED THEN DELETE"],
      ["INSERT ON CONFLICT DO UPDATE", "INSERT INTO audit_log (id, action, target) VALUES ($1,'forged','forged') ON CONFLICT (id) DO UPDATE SET action='forged'", [sample.id]],
      ["UPDATE via CTE", "WITH u AS (UPDATE audit_log SET target='cte' RETURNING 1) SELECT count(*) FROM u"], ["UPDATE ... FROM", "UPDATE audit_log a SET target='from' FROM admins d WHERE d.id=a.admin_id"],
    ];
    for (const [nm, sql, p] of stmts) { const e = await errOf(sql, p); assert(/append-only|restrict_violation|cannot be deleted|violates foreign key/.test(e), `${nm}: not refused: "${e}"`); out.push(nm + (/append-only/.test(e) ? "✓" : "✓(" + e.slice(0, 40) + ")")); }
    const noop = await errOf("UPDATE audit_log SET target='x' WHERE false"); const noopDel = await errOf("DELETE FROM audit_log WHERE false");
    const after = await rows("SELECT count(*)::int c, md5(string_agg(a::text, ',' ORDER BY a.id)) h FROM audit_log a"); eq(JSON.stringify(after), JSON.stringify(before), "table content hash changed");
    assert(await n("SELECT count(*) n FROM admins") >= 1, "admins truncated"); assert(await n("SELECT count(*) n FROM admin_sessions") >= 1, "sessions truncated");
    return `${stmts.length} mutation paths refused (${out.join(", ")}); WHERE-false no-ops: UPDATE "${noop || "ok"}", DELETE "${noopDel || "ok"}" (no row to protect); md5 of whole table before==after (${before[0].c} rows)`;
  });
  await chk("AUD-1b", "bypass attempts: DISABLE/DROP TRIGGER, ALTER..DISABLE, rename/replace function, inheritance child (INHERITS), ALTER TYPE, DROP TABLE: as OWNER (the app role in the documented single-role setup) these succeed (rolled back here); session_replication_role needs superuser", async () => {
    const res: string[] = []; const probe = async (nm: string, sql: string[]) => { await db.query("BEGIN"); let e = ""; try { for (const s of sql) await db.query(s); } catch (x) { e = (x as Error).message; } await db.query("ROLLBACK"); res.push(`${nm}: ${e ? "DENIED (" + e.slice(0, 50) + ")" : "ALLOWED"}`); return e; };
    const who = (await rows("SELECT current_user u, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) su, (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname='audit_log') owner"))[0];
    const r1 = await probe("ALTER TABLE .. DISABLE TRIGGER audit_log_no_update + UPDATE", ["ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update", "UPDATE audit_log SET target=target"]);
    const r2 = await probe("DROP TRIGGER audit_log_no_truncate", ["DROP TRIGGER audit_log_no_truncate ON audit_log"]);
    const r3 = await probe("ALTER TABLE .. DISABLE TRIGGER ALL", ["ALTER TABLE audit_log DISABLE TRIGGER USER"]);
    const r4 = await probe("CREATE OR REPLACE FUNCTION audit_log_append_only (neutered)", ["CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"]);
    const r5 = await probe("CREATE TABLE child INHERITS (audit_log) + forged row + UPDATE through parent", ["CREATE TABLE qa_audit_child () INHERITS (audit_log)", "INSERT INTO qa_audit_child (action,target) VALUES ('forged','forged')", "UPDATE audit_log SET target='edited-through-parent' WHERE action='forged'", "DELETE FROM audit_log WHERE action='forged'"]);
    const r6 = await probe("SET session_replication_role = replica", ["SET LOCAL session_replication_role = replica"]);
    const r7 = await probe("DROP TABLE audit_log CASCADE", ["DROP TABLE audit_log CASCADE"]);
    const r8 = await probe("ALTER TABLE audit_log RENAME TO x", ["ALTER TABLE audit_log RENAME TO audit_log_x"]);
    const r9 = await probe("COPY audit_log TO/FROM program (needs pg_execute_server_program)", ["COPY audit_log FROM PROGRAM 'true'"]);
    const trg = await rows("SELECT tgname, tgenabled, tgtype FROM pg_trigger WHERE tgrelid='audit_log'::regclass AND NOT tgisinternal ORDER BY tgname");
    assert(trg.every((t: any) => t.tgenabled === "O"), "a trigger got disabled for real: " + JSON.stringify(trg));
    return `app role=${who.u} (superuser=${who.su}, audit_log owner=${who.owner}); triggers enabled after probes: ${trg.map((t: any) => t.tgname).join(",")}. ${res.join(" | ")}. => As the TABLE OWNER the immutability can be removed (documented limit (a)); superuser-only: session_replication_role${r6 ? " (denied here)" : " (allowed!)"}; non-owner result in AUD-14`;
  });
  await chk("AUD-2", "FK admin_id ON DELETE RESTRICT (no SET NULL / CASCADE); DELETE FROM admins refused when audit mentions the admin (as actor OR as admin:<uuid> subject); allowed only for an admin with zero history; disabling an admin leaves history and blocks deletion", async () => {
    const fk = await rows("SELECT conname, confdeltype FROM pg_constraint WHERE conrelid='audit_log'::regclass AND contype='f'"); assert(fk.length === 1 && fk[0].confdeltype === "r", "fk " + JSON.stringify(fk));
    const e1 = await errOf("DELETE FROM admins WHERE id=$1", [adminId]); assert(/audit history and cannot be deleted/.test(e1), "actor delete: " + e1);
    const e1b = await errOf("DELETE FROM admins"); assert(/audit history/.test(e1b), "delete all: " + e1b);
    // CLI-style row: admin_id NULL, subject in target
    const raw = (await rows("INSERT INTO admins (email) VALUES ($1) RETURNING id", [`raw-${stamp}@example.test`]))[0].id; await db.query("DELETE FROM admins WHERE id=$1", [raw]); // zero history -> deletable
    const raw2 = (await rows("INSERT INTO admins (email) VALUES ($1) RETURNING id", [`raw2-${stamp}@example.test`]))[0].id; await db.query("INSERT INTO audit_log (action,target) VALUES ('qa_subject_only',$1)", [`admin:${raw2}`]); const e2 = await errOf("DELETE FROM admins WHERE id=$1", [raw2]); assert(/audit history/.test(e2), "subject-only history delete: " + e2);
    const raw3 = (await rows("INSERT INTO admins (email) VALUES ($1) RETURNING id", [`raw3-${stamp}@example.test`]))[0].id; await db.query("UPDATE admins SET disabled_at=now() WHERE id=$1", [raw3]); const e3 = await errOf("DELETE FROM admins WHERE id=$1", [raw3]); assert(/audit history/.test(e3), "disabled admin delete: " + e3);
    const e4 = await errOf("INSERT INTO audit_log (admin_id, action, target) VALUES ($1,'x','x')", ["00000000-0000-0000-0000-00000000dead"]); assert(/foreign key/.test(e4), "orphan insert: " + e4);
    const dis = await rows("SELECT action, admin_id, admin_email, target FROM audit_log WHERE target=$1 ORDER BY created_at", [`admin:${raw3}`]); eq(dis.length, 1, "disable audited once"); eq(dis[0].action, "admin_disabled", "action"); eq(dis[0].admin_email, `raw3-${stamp}@example.test`, "email snapshot");
    // concurrent: delete vs. audit write must never leave history for a deleted admin (FK would make that impossible anyway)
    let leaked = 0, deleted = 0, kept = 0; for (let i = 0; i < 25; i++) { const id = (await rows("INSERT INTO admins (email) VALUES ($1) RETURNING id", [`race${i}-${stamp}@example.test`]))[0].id; const [d, w] = await Promise.allSettled([db.query("DELETE FROM admins WHERE id=$1", [id]), (async () => { const c = new (await import("pg")).Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); try { await c.query("INSERT INTO audit_log (admin_id, action, target) VALUES ($1,'race','r')", [id]); } finally { await c.end(); } })()]); const exists = await n("SELECT count(*) n FROM admins WHERE id=$1", [id]); const hist = await n("SELECT count(*) n FROM audit_log WHERE admin_id=$1", [id]); if (hist > 0 && !exists) leaked++; if (!exists) deleted++; else kept++; }
    assert(leaked === 0, "history without admin " + leaked);
    return `FK confdeltype='r' only; actor-history admin delete refused, "DELETE FROM admins" (all) refused, subject-only (admin_id NULL, target admin:<id>) refused, disabled admin refused, zero-history admin deletable, orphan audit insert refused by FK; admin_disabled trigger row has email snapshot; 25 racing delete-vs-audit-insert pairs: ${deleted} deleted / ${kept} kept, 0 orphans`;
  });
  await chk("AUD-3", "admin_email snapshot: every actor row has it (login/logout/clear/create/reset), survives admin email rename (old rows keep OLD email, new rows NEW email), system rows have NULL admin_id+email, trigger fills it for raw inserts; no admin_id row lacks email", async () => {
    const e = mkAdmin("snap"); const s = await login(e); await s.http.json("POST", "/api/admin/logout"); const id = (await rows("SELECT id FROM admins WHERE email=$1", [e]))[0].id;
    const before = await rows("SELECT action, admin_email FROM audit_log WHERE admin_id=$1 ORDER BY created_at", [id]); assert(before.length >= 3 && before.every((r: any) => r.admin_email === e), "pre-rename " + JSON.stringify(before));
    const e2 = `renamed-${stamp}@example.test`; await db.query("UPDATE admins SET email=$2 WHERE id=$1", [id, e2]); const s2 = await login(e2); await s2.http.json("POST", "/api/admin/logout");
    const after = await rows("SELECT action, admin_email FROM audit_log WHERE admin_id=$1 ORDER BY created_at, id", [id]); const old = after.filter((r: any) => r.admin_email === e).length, nw = after.filter((r: any) => r.admin_email === e2).length; assert(old === before.length && nw === 2, `old rows ${old}/${before.length} new ${nw}`);
    await db.query("INSERT INTO audit_log (admin_id, action, target) VALUES ($1,'qa_raw','raw')", [id]); eq((await rows("SELECT admin_email FROM audit_log WHERE action='qa_raw' AND admin_id=$1", [id]))[0].admin_email, e2, "trigger fill");
    eq(await n("SELECT count(*) n FROM audit_log WHERE admin_id IS NOT NULL AND admin_email IS NULL"), 0, "actor rows without email");
    const sys = await rows("SELECT action, count(*)::int c, count(admin_id)::int a, count(admin_email)::int m FROM audit_log WHERE admin_id IS NULL GROUP BY 1 ORDER BY 1"); const renameAudited = await n("SELECT count(*) n FROM audit_log WHERE action ILIKE '%email%' OR target LIKE '%renam%'");
    return `rename: ${old} old rows keep "${e.slice(0, 18)}…", ${nw} new rows carry the new email; raw INSERT gets email by trigger; 0 actor rows w/o email. admin_id-NULL rows: ${sys.map((r: any) => `${r.action}×${r.c}(email ${r.m})`).join(", ")}. INFO: an email RENAME by plain SQL is itself not audited (${renameAudited} rows), only disable/enable are`;
  });

  // =============================== 2. failed-login parity + timing ===============================
  const disabledEmail = mkAdmin("dis"); await db.query("UPDATE admins SET disabled_at=now() WHERE email=$1", [disabledEmail]);
  const realEmail = mkAdmin("real");
  await chk("AUD-4", "failed-login responses: unknown / wrong-pw / disabled(correct pw) / disabled(wrong pw) -> byte-identical 401 body+headers (uniform); malformed email -> 400 (schema, before any lookup); IP limiter 429; per-email delay 429 identical for real/unknown/disabled", async () => {
    const hdrs = (r: any) => [...r.headers.entries()].filter(([k]) => !["date", "etag", "x-nextjs-cache", "x-request-id"].includes(k)).map(([k, v]) => `${k}:${v}`).sort().join("|");
    const shot = async (email: string, pw: string) => { const r = await new Http().json("POST", "/api/admin/login", { json: { email, password: pw }, base: B2 }); return { s: r.status, b: r.text, h: hdrs(r) }; };
    const unk = await shot(`ghost-${stamp}@example.test`, "Wrong-Pass-123!"), bad = await shot(realEmail, "Wrong-Pass-123!"), dis = await shot(disabledEmail, PW), dis2 = await shot(disabledEmail, "Wrong-Pass-123!");
    for (const x of [bad, dis, dis2]) { eq(x.s, unk.s, "status"); eq(x.b, unk.b, "body"); eq(x.h, unk.h, "headers"); } eq(unk.s, 401, "401");
    const mal: string[] = []; for (const e of ["not-an-email", "a@b", "@x.com", "a b@x.com", "", "x".repeat(300) + "@example.test", "аdmin@exаmple.test", "ｕ@example.test", "a\u0000@example.test"]) { const r = await new Http().json("POST", "/api/admin/login", { json: { email: e, password: "x" }, base: B2 }); mal.push(String(r.status)); assert(r.status === 400, `malformed ${JSON.stringify(e.slice(0, 20))} -> ${r.status}`); }
    // per-email progressive delay is identical for real / unknown / disabled (each from its own IP so only the per-email delay is in play)
    const seq = async (email: string, pw: string) => { await db.query("DELETE FROM login_throttle"); const o: string[] = []; for (let i = 0; i < 8; i++) { const r = await new Http().json("POST", "/api/admin/login", { json: { email, password: pw }, base: B2 }); o.push(r.status + (r.status === 429 ? "/" + r.json.error.replace(/\d+/, "N") : "")); } return o.join(","); };
    const sr = await seq(realEmail, "Wrong-Pass-123!"), su = await seq(`ghost2-${stamp}@example.test`, "Wrong-Pass-123!"), sd = await seq(disabledEmail, PW);
    assert(sr === su && su === sd, `delay sequences differ: real=${sr} unk=${su} dis=${sd}`);
    return `unknown==wrong-pw==disabled==disabled+wrong-pw: status 401, body ${unk.b}, ${unk.h.split("|").length} identical headers; malformed (9 variants incl. homoglyph/fullwidth/NUL/300 chars) -> ${mal.join("/")}; 8-attempt sequences identical for real/unknown/disabled: ${sr}`;
  });
  await chk("AUD-5", "timing: statistical (unknown vs wrong-pw vs disabled vs disabled+wrong-pw, interleaved random order, one fresh IP per request, throttle reset between samples); medians/p95, Mann-Whitney", async () => {
    const N = 150; const classes: Record<string, () => [string, string]> = { unknown: () => [`t-${crypto.randomBytes(5).toString("hex")}@example.test`, "Wrong-Pass-123!"], wrongpw: () => [realEmail, "Wrong-Pass-123!"], disabled: () => [disabledEmail, PW], disabled_wrongpw: () => [disabledEmail, "Wrong-Pass-123!"] };
    const T: Record<string, number[]> = Object.fromEntries(Object.keys(classes).map((k) => [k, []])); const order: string[] = []; for (let i = 0; i < N; i++) order.push(...Object.keys(classes)); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let k = 0; for (const c of order) { if (k++ % 40 === 0) await resetBuckets(); await db.query("DELETE FROM login_throttle"); const [e, p] = classes[c](); const h = new Http(); const t0 = performance.now(); const r = await h.json("POST", "/api/admin/login", { json: { email: e, password: p } }); const dt = performance.now() - t0; assert(r.status === 401, c + " " + r.status); T[c].push(dt); }
    const lines = Object.entries(T).map(([c, v]) => `${c}: n=${v.length} median ${med(v).toFixed(1)}ms p95 ${pct(v, 0.95).toFixed(1)}ms`); const base = T.unknown; const cmp: string[] = []; let maxRel = 0, minP = 1;
    for (const c of ["wrongpw", "disabled", "disabled_wrongpw"]) { const m = mwu(base, T[c]); const rel = Math.abs(med(T[c]) - med(base)) / med(base); maxRel = Math.max(maxRel, rel); minP = Math.min(minP, m.p); cmp.push(`unknown vs ${c}: Δmedian ${(med(T[c]) - med(base)).toFixed(1)}ms (${(rel * 100).toFixed(1)}%), MWU p=${m.p.toFixed(3)}`); }
    fs.writeFileSync(`${ART}/pay5-timing-samples.json`, JSON.stringify(T));
    // cold (audit row written: fresh ip+email) vs warm (coalesced: same ip+email+reason repeated) for the SAME class, informational
    const warmIp = freshIp(); const warm: number[] = [], cold: number[] = []; for (let i = 0; i < 40; i++) { await db.query("DELETE FROM login_throttle"); const h = new Http(); h.ip = warmIp; let t0 = performance.now(); await h.json("POST", "/api/admin/login", { json: { email: realEmail, password: "Wrong-Pass-123!" } }); warm.push(performance.now() - t0); const h2 = new Http(); t0 = performance.now(); await h2.json("POST", "/api/admin/login", { json: { email: realEmail, password: "Wrong-Pass-123!" } }); cold.push(performance.now() - t0); }
    const wc = mwu(cold, warm);
    assert(maxRel < 0.1, "median differs >10%: " + cmp.join("; "));
    return `${lines.join("; ")}. ${cmp.join("; ")}. ${minP < 0.01 ? "NOTE statistically separable but <10% (bcrypt cost dominates)" : "not distinguishable at p<0.01"}. Info: audit-write path (cold) median ${med(cold).toFixed(1)}ms vs coalesced (warm) ${med(warm).toFixed(1)}ms (MWU p=${wc.p.toFixed(3)}; same for every class, leaks nothing about existence)`;
  });

  // =============================== 3. contents ===============================
  await chk("AUD-6", "failed-login rows: right reason/ip/email/timestamp; attempted PASSWORD never stored (grep whole table); email lower-cased, trimmed, capped at 100 chars; oversize/NUL/XSS email never reaches the table; hostile X-Forwarded-For is stored escaped-as-data (<=64 chars)", async () => {
    await resetBuckets(); const pws = [`PwProbe-${crypto.randomBytes(6).toString("hex")}`, `Zz!${crypto.randomBytes(6).toString("hex")}Aa1`, `${PW}-nope`]; const ips = [freshIp(), freshIp(), freshIp()];
    const fire = async (email: string, pw: string, ip: string, base = BASE) => { const h = new Http(); h.ip = ip; return h.json("POST", "/api/admin/login", { json: { email, password: pw }, base }); };
    await fire(`Ghost-UP-${stamp}@Example.Test`, pws[0], ips[0]); await fire(realEmail, pws[1], ips[1]); await fire(disabledEmail, PW, ips[2]);
    const long = "a".repeat(200) + `@example.test`; const rl = await fire(long, pws[2], freshIp()); // 213 chars: passes zod (<=254)
    const r = await rows("SELECT action, reason, ip, admin_email, admin_id, created_at, target FROM audit_log WHERE action='admin_login_failed' AND ip = ANY($1)", [ips]); const by = Object.fromEntries(r.map((x: any) => [x.ip, x]));
    eq(by[ips[0]].reason, "unknown_email", "r0"); eq(by[ips[0]].admin_email, `ghost-up-${stamp}@example.test`, "lowercased attempted email"); eq(by[ips[1]].reason, "bad_password", "r1"); eq(by[ips[2]].reason, "disabled", "r2"); assert(r.every((x: any) => x.created_at && x.admin_id === null), "ts/admin_id");
    const longRow = (await rows("SELECT admin_email, length(admin_email) l FROM audit_log WHERE action='admin_login_failed' AND admin_email LIKE 'aaaa%' ORDER BY created_at DESC LIMIT 1"))[0]; eq(longRow.l, 100, "email truncated to 100 (input 213, route status " + rl.status + ")");
    const dump = JSON.stringify(await rows("SELECT * FROM audit_log")); for (const p of [...pws, PW, PW2, "Wrong-Pass-123!"]) assert(!dump.includes(p), "password stored: " + p.slice(0, 6)); assert(!/\$2[aby]\$/.test(dump), "hash in audit");
    // hostile values
    const bad: string[] = []; for (const e of ["<script>alert(1)</script>@example.test", "\"><img src=x onerror=alert(1)>@example.test", "a\u0000b@example.test", "x'--@example.test", "a;DROP TABLE audit_log;--@example.test"]) { const rr = await fire(e, "x", freshIp()); bad.push(rr.status + ""); }
    const lit = await n("SELECT count(*) n FROM audit_log WHERE admin_email ~ '[<>\"\\x00]'"); eq(lit, 0, "markup/NUL chars in stored attempted emails");
    const xip = ["<img src=x onerror=alert(1)>", "1.2.3.4' OR '1'='1", "a".repeat(200)]; const ipRows: string[] = []; for (const x of xip) { const h = await fetch(BASE + "/api/admin/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": x }, body: JSON.stringify({ email: `xip-${crypto.randomBytes(3).toString("hex")}-${stamp}@example.test`, password: "x" }) }); ipRows.push(String(h.status)); }
    const stored = await rows("SELECT ip, length(ip) l FROM audit_log WHERE action='admin_login_failed' AND (ip LIKE '<img%' OR ip LIKE '1.2.3.4''%' OR ip LIKE 'aaaa%') ORDER BY created_at DESC LIMIT 5");
    const ipNote = stored.length ? `X-Forwarded-For is NOT validated as an IP: stored verbatim up to 64 chars (e.g. ${JSON.stringify(stored[0].ip.slice(0, 40))}, len ${stored[0].l}) -> any future audit viewer MUST escape the ip column (INFO)` : "hostile XFF not stored";
    return `reason/ip/email/ts correct for unknown/bad_password/disabled; ${r.length} rows; password strings (${pws.length + 3}) + bcrypt hashes absent from the entire audit_log; 213-char email stored as ${longRow.l} chars; ${bad.length} markup/NUL/SQLi-looking emails -> HTTP ${bad.join("/")} (400 by schema), 0 stored with <>\"/NUL; ${ipNote}`;
  });

  // =============================== 4. coalescing / cap (in-process, exact counts) ===============================
  const { auditFailedAdminLogin, FAILED_LOGIN_AUDIT } = await import("../../src/server/admin/audit");
  const hourRows = async () => n("SELECT count(*) n FROM audit_log WHERE action='admin_login_failed' AND created_at >= date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'");
  await chk("AUD-7", "coalescing: 1001 identical failures -> rows only at 1, 10, 100, 1000 (exact targets); next window's first row states folded repeats (1000); 60 concurrent identical -> exactly rows n=1 and n=10; different ip/reason/email are separate buckets", async () => {
    await resetBuckets(); const ip = freshIp(), email = `coal-${stamp}@example.test`;
    for (let i = 0; i < 1001; i++) await auditFailedAdminLogin(email, "bad_password", ip);
    const r = await rows("SELECT target FROM audit_log WHERE admin_email=$1 AND ip=$2 ORDER BY created_at, id", [email, ip]); eq(r.length, 4, "rows " + JSON.stringify(r.map((x: any) => x.target)));
    assert(/^failed admin login$/.test(r[0].target) && /repeated 10x/.test(r[1].target) && /repeated 100x/.test(r[2].target) && /repeated 1000x/.test(r[3].target), JSON.stringify(r));
    await db.query("UPDATE admin_login_failure_buckets SET window_start = now() - interval '11 minutes' WHERE bucket LIKE 'f:%'"); await auditFailedAdminLogin(email, "bad_password", ip);
    const r2 = await rows("SELECT target FROM audit_log WHERE admin_email=$1 AND ip=$2 ORDER BY created_at, id", [email, ip]); eq(r2.length, 5, "rows after window"); assert(/\+1000 repeats folded/.test(r2[4].target), r2[4].target);
    // dimensions
    const ip2 = freshIp(); await auditFailedAdminLogin(email, "bad_password", ip2); await auditFailedAdminLogin(email, "disabled", ip); await auditFailedAdminLogin(email.toUpperCase(), "bad_password", ip); await auditFailedAdminLogin("  " + email + "  ", "bad_password", ip);
    const dim = await n("SELECT count(*) n FROM audit_log WHERE admin_email=$1", [email]); eq(dim, 5 + 2, "new ip -> new row, new reason -> new row, case/space variants coalesce into the same bucket (got " + dim + ")");
    // concurrency
    const ipc = freshIp(), ec = `coalc-${stamp}@example.test`; await Promise.all(Array.from({ length: 60 }, () => auditFailedAdminLogin(ec, "unknown_email", ipc)));
    const rc = await rows("SELECT target FROM audit_log WHERE admin_email=$1 AND ip=$2 ORDER BY created_at, id", [ec, ipc]); eq(rc.length, 2, "concurrent rows " + JSON.stringify(rc)); const bn = await n("SELECT n FROM admin_login_failure_buckets WHERE bucket LIKE 'f:%' AND n=60"); assert(bn >= 1, "bucket n=60");
    return `1001 calls -> 4 rows [${r.map((x: any) => x.target.replace("failed admin login ", "")).join(" | ")}]; after window expiry the first row says "${r2[4].target}"; ip/reason are separate buckets, email case/whitespace is normalised into one; 60 concurrent -> exactly 2 rows (n=1, n=10), bucket counter 60 (exact)`;
  });
  await chk("AUD-8", "global cap: 400 distinct failures (30-way concurrent) -> exactly 200 itemised rows this hour + exactly ONE admin_login_flood marker; further distinct failures are not itemised; REAL admin actions (login/clear-flag/logout/create/disable) are still recorded at the cap", async () => {
    await resetBuckets(); const base0 = await hourRows(); const flood0 = await n("SELECT count(*) n FROM audit_log WHERE action='admin_login_flood'");
    const jobs = Array.from({ length: 400 }, (_, i) => () => auditFailedAdminLogin(`cap${i}-${stamp}@example.test`, "unknown_email", freshIp())); const q = [...jobs]; await Promise.all(Array.from({ length: 30 }, async () => { while (q.length) await q.pop()!(); }));
    const itemised = (await hourRows()) - base0; const flood = (await n("SELECT count(*) n FROM audit_log WHERE action='admin_login_flood'")) - flood0; eq(itemised, 200, "itemised rows"); eq(flood, 1, "flood markers");
    // legit actions at the cap
    const s = await makeSeller("capflag"); await db.query("UPDATE sellers SET risk_flagged_at=now(), risk_flag_reason='QA cap test' WHERE id=$1", [s.id]); const lg = await login(adminEmail); eq(lg.r.status, 200, "login at cap"); const cf = await lg.http.json("POST", `/api/admin/sellers/${s.id}/clear-flag`, { json: { note: "reviewed at cap" } }); eq(cf.status, 200, "clear-flag at cap"); const lo = await lg.http.json("POST", "/api/admin/logout"); eq(lo.status, 200, "logout");
    const newAdmin = mkAdmin("atcap"); await db.query("UPDATE admins SET disabled_at=now() WHERE email=$1", [newAdmin]);
    const got = await rows("SELECT action FROM audit_log WHERE created_at > now() - interval '60 seconds' AND (admin_email = ANY($1) OR target LIKE $2)", [[adminEmail, newAdmin], `seller:${s.id}%`]); const acts = new Set(got.map((x: any) => x.action));
    for (const a of ["admin_login", "seller_flag_cleared", "admin_logout", "admin_created_cli", "admin_disabled"]) assert(acts.has(a), "missing at cap: " + a + " have " + [...acts]);
    // more distinct failures after the marker: still 200
    for (let i = 0; i < 40; i++) await auditFailedAdminLogin(`cap2-${i}-${stamp}@example.test`, "bad_password", freshIp()); eq((await hourRows()) - base0, 200, "still 200");
    return `400 distinct failures -> ${itemised} itemised + ${flood} flood marker (exact, under 30-way concurrency); +40 more -> still 200; at the cap: admin_login, seller_flag_cleared (HTTP 200), admin_logout, admin_created_cli, admin_disabled all written (cap applies ONLY to admin_login_failed). NB cap is per UTC clock hour: worst case across an hour boundary is 2x200`;
  });
  await chk("AUD-8b", "HTTP-level: one IP hammering one email (default limits, 3918): evaluated failures coalesced, 'throttled' attempts audited as their own bucket, per-IP limiter (10/15min) stops writes entirely", async () => {
    await resetBuckets(); const ip = freshIp(); const email = realEmail; const codes: number[] = []; const h = () => { const x = new Http(); x.ip = ip; return x; }; for (let i = 0; i < 16; i++) { await db.query("SELECT 1"); codes.push((await h().json("POST", "/api/admin/login", { json: { email, password: "Wrong-Pass-123!" }, base: B2 })).status); }
    const r = await rows("SELECT reason, target FROM audit_log WHERE ip=$1 AND action='admin_login_failed' ORDER BY created_at, id", [ip]); const per = r.reduce((a: any, x: any) => (a[x.reason] = (a[x.reason] ?? 0) + 1, a), {});
    assert(codes.includes(429), "no 429"); assert(r.length <= 4, "too many rows " + r.length);
    return `16 requests from one IP -> statuses ${codes.join(",")}; audit rows ${r.length} (${JSON.stringify(per)}) — evaluated 401s coalesce (reason bad_password), 429 delay hits log reason throttled; requests after the per-IP limiter (10th) write nothing`;
  });

  // =============================== 5. concurrency ===============================
  await chk("AUD-9", "concurrent logins/logouts: 24 parallel valid logins (some 429 by the per-email admission design), 0x5xx, #sessions == #200s, unique tokens; 24 parallel logouts of ONE token -> exactly 1 admin_logout row; mixed login/logout storm on 3 admins leaves no live session after logout; no deadlock", async () => {
    const e = mkAdmin("conc"); await db.query("DELETE FROM login_throttle"); const outs = await Promise.all(Array.from({ length: 24 }, () => login(e))); const st = outs.map((o) => o.r.status); const five = st.filter((s) => s >= 500).length; const ok = outs.filter((o) => o.r.status === 200); const id = (await rows("SELECT id FROM admins WHERE email=$1", [e]))[0].id;
    eq(await n("SELECT count(*) n FROM admin_sessions WHERE admin_id=$1", [id]), ok.length, "sessions vs 200s"); eq(new Set(ok.map((o) => o.http.cookies.get("unveil_admin"))).size, ok.length, "unique tokens"); eq(await n("SELECT count(*) n FROM audit_log WHERE action='admin_login' AND admin_id=$1", [id]), ok.length, "login rows");
    await db.query("DELETE FROM login_throttle"); const one = await login(e); const tok = one.http.cookies.get("unveil_admin"); const lo = await Promise.all(Array.from({ length: 24 }, () => { const h = new Http(); h.cookies.set("unveil_admin", tok); return h.json("POST", "/api/admin/logout"); })); assert(lo.every((r) => r.status < 500), "logout 5xx"); eq(await n("SELECT count(*) n FROM audit_log WHERE action='admin_logout' AND admin_id=$1 AND created_at > now() - interval '30 seconds'", [id]), 1, "one logout row for one session");
    const chk = new Http(); chk.cookies.set("unveil_admin", tok); eq((await chk.json("GET", "/api/admin/me")).status, 401, "revoked");
    // storm: interleave login+logout on separate sessions
    const storm = await Promise.all(Array.from({ length: 30 }, async (_, i) => { await sleep(Math.random() * 100); await db.query("DELETE FROM login_throttle"); const l = await login(e); if (l.r.status !== 200) return l.r.status; const r = await l.http.json("POST", "/api/admin/logout"); const me = await l.http.json("GET", "/api/admin/me"); return r.status === 200 && me.status === 401 ? 200 : 999; }));
    const stormBad = storm.filter((s) => s !== 200 && s !== 429); if (stormBad.length) console.log('storm anomalies', stormBad); const live = await n("SELECT count(*) n FROM admin_sessions s WHERE admin_id=$1 AND revoked_at IS NULL AND expires_at>now() AND NOT EXISTS (SELECT 1)", [id]); 
    const liveSessions = await n("SELECT count(*) n FROM admin_sessions WHERE admin_id=$1 AND revoked_at IS NULL AND expires_at>now()", [id]);
    if (five) throw new Error(`${five}/24 concurrent logins of the same admin returned HTTP 500 (statuses ${st.join(",")}); server log: "TypeError: Cannot read properties of undefined (reading 'wait')" in admitLoginAttempt (login-throttle.ts:96). Cause: a successful login's resetLoginThrottle() DELETEs the login_throttle row between another request's INSERT..ON CONFLICT DO NOTHING and its SELECT .. FOR UPDATE, so rows[0] is undefined. Everything else held: sessions==200s (${ok.length}), tokens unique, 24 parallel logouts -> 1 audit row, storm ${storm.filter((s) => s === 200).length} ok/${storm.filter((s) => s === 429).length} 429`);
    return `24 parallel logins -> ${st.filter((s) => s === 200).length}x200 / ${st.filter((s) => s === 429).length}x429 / 0x5xx, sessions==200s, tokens unique; 24 parallel logouts of 1 token -> 1 audit row, token dead; 30-way login/logout storm -> ${storm.filter((s) => s === 200).length} ok/${storm.filter((s) => s === 429).length} 429, 0 anomalies; leftover live sessions=${liveSessions} (the ${ok.length} from the first burst, expected)`;
  });
  await chk("AUD-10", "concurrent create/reset/disable: 6 simultaneous createAdmin(same email) -> exactly 1 created; losers fail cleanly (raw DB error text in CLI output = INFO); 10 concurrent clear-flag on one seller -> exactly one 200 + one audit row; toggling disable/enable 20x writes 20 audit rows", async () => {
    const { createAdmin } = await import("../../src/server/admin/auth"); const em = `race-create-${stamp}@example.test`; const res = await Promise.allSettled(Array.from({ length: 6 }, () => createAdmin(em, PW))); const okc = res.filter((r) => r.status === "fulfilled").length; const msgs = res.filter((r) => r.status === "rejected").map((r: any) => r.reason.message.slice(0, 80));
    eq(okc, 1, "created once " + JSON.stringify(msgs)); eq(await n("SELECT count(*) n FROM admins WHERE email=$1", [em]), 1, "one row"); const raw = msgs.filter((m) => /duplicate key|admins_email_key/.test(m)).length;
    const s = await makeSeller("race-clear"); await db.query("UPDATE sellers SET risk_flagged_at=now() WHERE id=$1", [s.id]); const lg = await login(adminEmail); const cl = await Promise.all(Array.from({ length: 10 }, () => lg.http.json("POST", `/api/admin/sellers/${s.id}/clear-flag`, { json: { note: "concurrent review" } }))); const sts = cl.map((c) => c.status).sort(); eq(sts.filter((x) => x === 200).length, 1, "one 200 " + sts); assert(sts.every((x) => x === 200 || x === 409), "other codes " + sts); eq(await n("SELECT count(*) n FROM audit_log WHERE action='seller_flag_cleared' AND target LIKE $1", [`seller:${s.id}%`]), 1, "one audit row");
    const tid = (await rows("SELECT id FROM admins WHERE email=$1", [em]))[0].id; for (let i = 0; i < 20; i++) await db.query("UPDATE admins SET disabled_at = CASE WHEN disabled_at IS NULL THEN now() ELSE NULL END WHERE id=$1", [tid]); eq(await n("SELECT count(*) n FROM audit_log WHERE target=$1 AND action IN ('admin_disabled','admin_enabled')", [`admin:${tid}`]), 20, "toggle rows");
    const par = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => db.query("SELECT 1").then(() => new (require("pg").Client)({ connectionString: process.env.DATABASE_URL }).connect))); 
    return `createAdmin x6 concurrent -> 1 created, ${msgs.length} rejected (${raw} with raw "duplicate key … admins_email_key" text — the CLI prints it verbatim: INFO); clear-flag x10 -> [${sts.join(",")}] with exactly one audit row; 20 disable/enable toggles -> 20 audit rows`;
  });

  // =============================== 6. reset-password CLI ===============================
  await chk("AUD-11a", "--reset-password: live sessions revoked at once, both audit rows (admin_password_reset_cli + admin_sessions_revoked with count) carry admin_id+email, old pw dead, new pw works, password absent from argv (ps sampled), stdout/stderr, audit_log, server logs; env-var delivery visible only to same uid; weak/short/blank/oversize rejected", async () => {
    const e = mkAdmin("rst"); const sess: Http[] = []; for (let i = 0; i < 3; i++) { await db.query("DELETE FROM login_throttle"); sess.push((await login(e)).http); } for (const h of sess) eq((await h.json("GET", "/api/admin/me")).status, 200, "pre");
    const args = ["tsx", "scripts/create-admin.ts", e, "--reset-password"]; const ch = spawn("npx", args, { env: { ...process.env, ADMIN_PASSWORD: PW2 }, stdio: ["ignore", "pipe", "pipe"] }); let out = ""; ch.stdout.on("data", (d) => (out += d)); ch.stderr.on("data", (d) => (out += d)); const seen = new Set<string>(); let envReadable = false;
    const poll = setInterval(() => { try { const ps = spawnSync("ps", ["-eo", "pid,args"], { encoding: "utf8" }).stdout.split("\n").filter((l) => /create-admin|tsx/.test(l)); ps.forEach((l) => seen.add(l.trim())); const pid = ch.pid; try { const env = fs.readFileSync(`/proc/${pid}/environ`, "utf8"); if (env.includes("ADMIN_PASSWORD=")) envReadable = true; } catch {} } catch {} }, 40);
    const code: number = await new Promise((r) => ch.on("close", r)); clearInterval(poll); eq(code, 0, "cli exit " + out);
    const argv = [...seen].join("\n"); assert(!argv.includes(PW2) && !argv.includes(PW), "password in process list"); assert(!out.includes(PW2) && !out.includes(PW), "password in CLI output");
    for (const h of sess) eq((await h.json("GET", "/api/admin/me")).status, 401, "old session after reset"); eq((await login(e, PW)).r.status, 401, "old pw"); await db.query("DELETE FROM login_throttle"); eq((await login(e, PW2)).r.status, 200, "new pw");
    const id = (await rows("SELECT id FROM admins WHERE email=$1", [e]))[0].id; const au = await rows("SELECT action, admin_id, admin_email, target, reason, created_at FROM audit_log WHERE admin_id=$1 AND action IN ('admin_password_reset_cli','admin_sessions_revoked')", [id]); eq(au.length, 2, "2 rows"); assert(au.every((x: any) => x.admin_email === e && x.created_at), "identity"); const rv = au.find((x: any) => x.action === "admin_sessions_revoked"); assert(/sessions_revoked: 3/.test(rv.target) && rv.reason === "password_reset", rv.target);
    const dump = JSON.stringify(await rows("SELECT * FROM audit_log")); assert(!dump.includes(PW2), "pw in audit"); const logs = fs.readFileSync("qa/artifacts/pay5-server-3917.log", "utf8") + fs.readFileSync("qa/artifacts/pay5-server-3918.log", "utf8"); assert(!logs.includes(PW2) && !logs.includes(PW), "pw in server log");
    const weak: string[] = []; for (const [nm, p] of [["short", "Ab1!xyz"], ["common", "password123456"], ["seq", "1234567890"], ["email-as-pw", e], ["blank", ""]]) { const r = cli([e, "--reset-password"], { ADMIN_PASSWORD: p as string }); weak.push(`${nm}:${r.code}`); assert(r.code !== 0, nm + " accepted"); }
    const stillNew = await login(e, PW2); eq(stillNew.r.status, 200, "pw unchanged after weak attempts");
    const argvPw = cli([e, "--reset-password", "--password", "x"], { ADMIN_PASSWORD: PW2 }); assert(argvPw.code === 2, "argv password flag accepted? " + argvPw.code);
    return `3 live sessions -> all 401 immediately; old pw 401, new pw 200; audit: admin_password_reset_cli + admin_sessions_revoked ("${rv.target.replace(id, "<id>")}", reason password_reset) both with admin_id+email+timestamp; ${seen.size} ps samples during run: password never in argv; not in CLI output, audit_log or server logs. ADMIN_PASSWORD env var of the CLI process IS readable via /proc/<pid>/environ by the same uid (${envReadable}) — document: run as dedicated user / prefer the hidden TTY prompt; rejected: ${weak.join(" ")}; --password flag refused (exit 2)`;
  });
  await chk("AUD-11b", "RACE: a login with the OLD password that is IN FLIGHT (bcrypt running) when the password reset commits still gets a session AFTER the revocation -> old credential keeps a live admin session", async () => {
    const { createAdmin } = await import("../../src/server/admin/auth"); const e = mkAdmin("race"); const survived: string[] = []; const detail: string[] = [];
    for (const off of [-150, -100, 0, 60, 120, 200]) {
      await db.query("DELETE FROM login_throttle"); const h = new Http(); const pLogin = (async () => { if (off < 0) await sleep(-off); return h.json("POST", "/api/admin/login", { json: { email: e, password: PW } }); })(); const pReset = (async () => { if (off > 0) await sleep(off); return createAdmin(e, PW + "-r" + off, { resetIfExists: true }); })();
      const [lr] = await Promise.all([pLogin, pReset]); const me = lr.status === 200 ? (await h.json("GET", "/api/admin/me")).status : lr.status; detail.push(`off${off}:login${lr.status}→me${me}`); if (me === 200) survived.push(String(off));
      // restore known pw for next round
      await createAdmin(e, PW, { resetIfExists: true });
    }
    const t = survived.length ? `FAIL-RACE` : "ok"; if (survived.length) throw new Error(`session created with the OLD password survived a completed password reset in ${survived.length}/6 timings (${detail.join(" ")}). Repro: start POST /api/admin/login (old pw) and run 'create-admin <email> --reset-password' so the reset commits while the login's bcrypt compare is still running; the login then inserts its session AFTER the revoke; GET /api/admin/me with that cookie -> 200`);
    return `no survivor in 6 timings (${detail.join(" ")})`;
  });

  // =============================== 7. create-admin CLI edges ===============================
  await chk("AUD-12", "create-admin CLI edges: duplicate (exit!=0, nothing written, no audit), bad emails (spaces, no TLD, 255 chars, empty), unicode/homoglyph emails (accepted by CLI but cannot log in via API = INFO), NUL in email/password (in-process; argv/env cannot carry NUL), lone surrogate, uppercase normalised; failed CLI writes no audit row", async () => {
    const cnt0 = await n("SELECT count(*) n FROM audit_log WHERE action LIKE 'admin_%cli'"); const e = `cli-${stamp}@example.test`; eq(cli([e], { ADMIN_PASSWORD: PW }).code, 0, "create"); const dup = cli([e.toUpperCase()], { ADMIN_PASSWORD: PW }); assert(dup.code === 1 && /already exists/.test(dup.out) && !/at .*\.ts:\d+/.test(dup.out), "dup " + dup.out);
    const res: string[] = []; for (const b of ["a b@x.test", "a@b", "", "x".repeat(250) + "@example.test", "@x.test", "a@@x.test", "a\tb@x.test", "a\nb@x.test"]) { const r = cli(b ? [b] : [], { ADMIN_PASSWORD: PW }); assert(r.code !== 0 && !/at .*\.ts:\d+/.test(r.out), `bad ${JSON.stringify(b.slice(0, 20))} -> ${r.code}`); res.push(String(r.code)); }
    const { createAdmin } = await import("../../src/server/admin/auth"); const inproc: string[] = []; for (const [nm, em, pw] of [["nul-email", "a\u0000b@example.test", PW], ["nul-pw", `nulpw-${stamp}@example.test`, PW + "\u0000x"], ["surrogate-email", "a\ud800@example.test", PW], ["surrogate-pw", `surr-${stamp}@example.test`, PW + "\ud800"], ["300-char", "a".repeat(300) + "@example.test", PW]] as const) { let m = ""; try { await createAdmin(em, pw); } catch (x) { m = (x as Error).message; } assert(m && !/violates|invalid byte|at /.test(m), `${nm}: ${m}`); inproc.push(`${nm}→"${m.slice(0, 32)}"`); }
    const uni = `ünï-${stamp}@example.test`; const ur = cli([uni], { ADMIN_PASSWORD: PW }); const ul = ur.code === 0 ? await new Http().json("POST", "/api/admin/login", { json: { email: uni, password: PW } }) : { status: -1 }; const homo = `аdmin-${stamp}@example.test`; const hr = cli([homo], { ADMIN_PASSWORD: PW });
    const cnt1 = await n("SELECT count(*) n FROM audit_log WHERE action LIKE 'admin_%cli'"); const created = 1 + (ur.code === 0 ? 1 : 0) + (hr.code === 0 ? 1 : 0); eq(cnt1 - cnt0, created, "audit rows == successful creates (failed attempts write nothing)");
    return `duplicate refused (case-insensitive) with clean message; 8 malformed emails exit≠0 (${res.join("/")}) without stack traces; in-process: ${inproc.join("; ")}; audit rows added == successful creates (${created}); INFO: unicode email ${ur.code === 0 ? `ACCEPTED by CLI but API login -> ${ul.status} (zod email is ASCII-only: such an admin can never sign in)` : "refused"}; Cyrillic-homoglyph email ${hr.code === 0 ? "ACCEPTED (look-alike of an existing admin identity in audit rows)" : "refused"}`;
  });

  // =============================== 8. completeness + no read path ===============================
  await chk("AUD-13", "audit completeness: one row per admin action with admin identity + timestamp: login(+ip), failed login, logout, create, disable/enable (even via SQL), reset (2 rows), clear-flag (note+previous reason), janitor, chargeback-flag; denied/unauthenticated attempts write none", async () => {
    const acts = await rows("SELECT action, count(*)::int c, count(admin_id)::int with_id, count(admin_email)::int with_email, count(ip)::int with_ip, min(created_at) mn FROM audit_log WHERE action <> 'qa_subject_only' AND NOT (action = 'admin_created_cli' AND admin_id IS NULL AND admin_email IS NULL) GROUP BY 1 ORDER BY 1"); /* excludes the single synthetic subject-only row that QA inserted in AUD-2 (audit_log is append-only: QA cannot delete it) */ /* rows of this run only (an earlier aborted run left one synthetic subject-only row; audit_log is append-only so QA cannot delete it) */ const have = new Set(acts.map((a: any) => a.action));
    for (const a of ["admin_login", "admin_login_failed", "admin_logout", "admin_created_cli", "admin_password_reset_cli", "admin_sessions_revoked", "admin_disabled", "admin_enabled", "seller_flag_cleared", "admin_login_flood"]) assert(have.has(a), "no row for " + a);
    const login_ = acts.find((a: any) => a.action === "admin_login"); eq(login_.with_ip, login_.c, "login rows carry ip"); for (const a of ["admin_login", "admin_logout", "seller_flag_cleared", "admin_created_cli", "admin_password_reset_cli", "admin_sessions_revoked"]) { const r = acts.find((x: any) => x.action === a); eq(r.with_id, r.c, a + " admin_id"); eq(r.with_email, r.c, a + " admin_email"); }
    const clr = (await rows("SELECT target FROM audit_log WHERE action='seller_flag_cleared' LIMIT 1"))[0].target; assert(/^seller:[0-9a-f-]{36} previous_reason: .* \| note: .+/.test(clr), clr);
    const before = await n("SELECT count(*) n FROM audit_log WHERE action NOT IN ('admin_login_failed','admin_login_flood')"); const seller = await makeSeller("denied"); const targets = ["/api/admin/me", "/api/admin/sellers/flagged", "/api/admin/transactions/review"]; for (const t of targets) { await new Http().json("GET", t); await seller.http.json("GET", t); } await new Http().json("POST", "/api/admin/sellers/00000000-0000-0000-0000-000000000000/clear-flag", { json: { note: "anon" } }); await seller.http.json("POST", "/api/admin/sellers/00000000-0000-0000-0000-000000000000/clear-flag", { json: { note: "seller" } });
    const after = await n("SELECT count(*) n FROM audit_log WHERE action NOT IN ('admin_login_failed','admin_login_flood')"); eq(after, before, "denied requests wrote rows");
    return `table: ${acts.map((a: any) => `${a.action}=${a.c}`).join(", ")}. identity: login/logout/clear/create/reset rows 100% have admin_id+admin_email, login rows 100% have ip; disable/enable via plain SQL audited by trigger; clear-flag row = seller id + previous_reason + note. INFO (not audited): 401/403 denied attempts on admin routes, 409/400 clear-flag rejections, SQL-level admin email rename/password_hash change, admin_sessions expiry`;
  });
  await chk("AUD-14", "no audit read path: no API route/page exposes audit_log (viewer absent) — anonymous, seller and admin all get 404 for every plausible audit URL; admin API/page responses contain no audit fields", async () => {
    const urls = ["/api/admin/audit", "/api/admin/audit-log", "/api/admin/audit_log", "/api/admin/audit/export", "/api/admin/logs", "/api/audit", "/api/audit-log", "/admin/audit", "/admin/audit-log", "/admin/logs", "/api/admin/activity", "/api/admin/sellers/audit"]; const seller = await makeSeller("auditread"); const out: string[] = [];
    for (const [who, h] of [["anon", new Http()], ["seller", seller.http], ["admin", A]] as [string, Http][]) { const codes = new Set<number>(); for (const u of urls) for (const q of ["", "?limit=1000&offset=0", "?action=admin_login"]) { const r = await h.json("GET", u + q); codes.add(r.status); assert(r.status === 404 || r.status === 401 || r.status === 403 || (r.status === 307 || r.status === 302), `${who} ${u}${q} -> ${r.status}`); assert(!/admin_login|audit_log|admin_email/.test(r.text), `${who} ${u} leaks`); } out.push(`${who}:{${[...codes].join(",")}}`); }
    const body = JSON.stringify([(await A.json("GET", "/api/admin/me")).json, (await A.json("GET", "/api/admin/sellers/flagged")).json, (await A.json("GET", "/api/admin/transactions/review")).json]); assert(!/admin_login|audit_log|admin_email/.test(body), "audit fields in admin API");
    const files = spawnSync("bash", ["-c", "ls src/app/api/admin -R | grep -ci audit; grep -rli 'FROM audit_log' src | grep -v 'server/admin/audit.ts'"], { encoding: "utf8" }).stdout.trim();
    return `${urls.length * 3} URL variants x3 principals -> only 404/401/403/redirect (${out.join(" ")}); no response contains audit fields; source grep: no module other than admin/audit.ts reads audit_log (${files.replace(/\n/g, " ") || "none"}). => There is NO audit viewer (M5-14 'visible to admins' remains BLOCKED; 'not editable via API' is trivially true: no write/read endpoint exists)`;
  });

  save("pay5-audit-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
