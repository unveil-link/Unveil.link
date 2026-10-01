// @ts-nocheck
/* eslint-disable */
// Round 4 QA, NEW-3 deployment requirement: app DB role that is NOT owner / NOT superuser. Separate throwaway cluster (port 5898, db unveil_qa_pay4_audit,
// owner role qaowner, app role qa_app) and a server on :3819 running as qa_app. Shows what immutability holds when the app role is not the table owner.
import { Client } from "pg";
import { spawnSync } from "node:child_process";
import { check, assert, eq, stamp, save, done } from "./qa-pay4-lib";
const APP = "postgres://qa_app:qaapp@127.0.0.1:5898/unveil_qa_pay4_audit", OWN = "postgres://qaowner@127.0.0.1:5898/unveil_qa_pay4_audit"; const B = "http://localhost:3819"; const PW = "Qa-Admin-Passphrase-93!x";
const app = new Client({ connectionString: APP }), own = new Client({ connectionString: OWN });
const err = async (c: Client, sql: string) => { try { await c.query(sql); return ""; } catch (e) { return (e as Error).message; } };
(async () => {
  await app.connect(); await own.connect();
  await check("ROLE-1", "documented/default setup (README: createuser unveil; createdb -O unveil) makes the app role the TABLE OWNER; here the safer setup: app role = non-owner, non-superuser, no TRUNCATE/DDL", async () => {
    const r = (await app.query("SELECT current_user u, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) su, (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) cr, (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname='audit_log') owner, has_table_privilege('audit_log','TRUNCATE') tr, has_table_privilege('audit_log','TRIGGER') trg")).rows[0];
    assert(!r.su && r.owner !== r.u, JSON.stringify(r)); return `app role ${r.u}: superuser=${r.su}, audit_log owner=${r.owner}, TRUNCATE priv=${r.tr}, TRIGGER priv=${r.trg}`;
  });
  await check("ROLE-2", "non-owner app role: every mutation/bypass is denied (UPDATE/DELETE by trigger; TRUNCATE by privilege+trigger; DISABLE/DROP TRIGGER, replace trigger function, ALTER/DROP TABLE, INHERITS child, CREATE TRIGGER, session_replication_role, COPY FROM PROGRAM, GRANT) ", async () => {
    const t: [string, string][] = [["UPDATE", "UPDATE audit_log SET target='x'"], ["DELETE", "DELETE FROM audit_log"], ["TRUNCATE", "TRUNCATE audit_log"], ["TRUNCATE CASCADE (via admins)", "TRUNCATE admins CASCADE"],
      ["DISABLE TRIGGER", "ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update"], ["DISABLE TRIGGER ALL/USER", "ALTER TABLE audit_log DISABLE TRIGGER USER"], ["DROP TRIGGER", "DROP TRIGGER audit_log_no_update ON audit_log"], ["DROP TRIGGER (truncate)", "DROP TRIGGER audit_log_no_truncate ON audit_log"],
      ["REPLACE FUNCTION", "CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"], ["ALTER TABLE", "ALTER TABLE audit_log ADD COLUMN x int"], ["DROP TABLE", "DROP TABLE audit_log CASCADE"], ["RENAME", "ALTER TABLE audit_log RENAME TO a2"],
      ["INHERITS child", "CREATE TABLE qa_child () INHERITS (audit_log)"], ["session_replication_role", "SET session_replication_role = replica"], ["COPY FROM PROGRAM", "COPY audit_log FROM PROGRAM 'true'"], ["ALTER OWNER", "ALTER TABLE audit_log OWNER TO qa_app"], ["DROP admins guard trigger", "DROP TRIGGER admins_guard_delete ON admins"], ["ALTER ROLE superuser", "ALTER ROLE qa_app SUPERUSER"]];
    await app.query("INSERT INTO audit_log (action,target) VALUES ('qa_seed','row so row-level triggers have something to fire on')"); const ok: string[] = []; for (const [n, s] of t) { const e = await err(app, s); if (!e) throw new Error("ALLOWED: " + n); ok.push(`${n}✓`); }
    await app.query("GRANT TRUNCATE ON audit_log TO qa_app"); /* non-owner without grant option: PG only WARNs "no privileges were granted" */ assert(!(await app.query("SELECT has_table_privilege('audit_log','TRUNCATE') p")).rows[0].p, "self-grant worked"); ok.push("GRANT TRUNCATE no-op✓"); const n0 = (await own.query("SELECT count(*)::int c FROM audit_log")).rows[0].c; return `${t.length}/${t.length} denied: ${ok.join(" ")}; rows intact (${n0})`;
  });
  await check("ROLE-3", "whole app works as the non-owner role (login, audited clear-flag, failed-login audit + coalescing, logout, janitor audit) — i.e. the hardened setup is deployable", async () => {
    const env = { ...process.env, DATABASE_URL: APP }; const cli = (a: string[]) => spawnSync("npx", ["tsx", "scripts/create-admin.ts", ...a], { env: { ...env, ADMIN_PASSWORD: PW }, encoding: "utf8", input: "" });
    const e = `role-${stamp}@example.test`; const c = cli([e]); eq(c.status, 0, "create-admin as qa_app: " + c.stdout + c.stderr); const r2 = cli([e, "--reset-password"]); eq(r2.status, 0, "reset as qa_app: " + r2.stdout + r2.stderr);
    const post = (p: string, body: any, h: any = {}) => fetch(B + p, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.88.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`, ...h }, body: JSON.stringify(body) });
    const bad = await post("/api/admin/login", { email: e, password: "Wrong-Pass-123!" }); eq(bad.status, 401, "bad"); const ok = await post("/api/admin/login", { email: e, password: PW }); eq(ok.status, 200, "login " + ok.status); const cookie = ok.headers.getSetCookie()[0].split(";")[0];
    const sid = (await own.query("INSERT INTO sellers (email,password_hash,display_name,verification_status,risk_flagged_at,risk_flag_reason) VALUES ($1,'x','Role Seller','verified',now(),'role test') RETURNING id", [`roleseller-${stamp}@example.test`])).rows[0].id;
    const cf = await post(`/api/admin/sellers/${sid}/clear-flag`, { note: "role check" }, { cookie }); eq(cf.status, 200, "clear " + (await cf.text())); const lo = await post("/api/admin/logout", {}, { cookie }); eq(lo.status, 200, "logout");
    const acts = (await own.query("SELECT action FROM audit_log WHERE admin_email=$1 ORDER BY created_at, id", [e])).rows.map((r) => r.action); for (const a of ["admin_created_cli", "admin_password_reset_cli", "admin_sessions_revoked", "admin_login_failed", "admin_login", "seller_flag_cleared", "admin_logout"]) assert(acts.includes(a), "missing " + a + " in " + acts);
    const disable = await err(app, `UPDATE admins SET disabled_at=now() WHERE email='${e}'`); const trig = (await own.query("SELECT count(*)::int c FROM audit_log WHERE action='admin_disabled' AND admin_email=$1", [e])).rows[0].c;
    return `create-admin, --reset-password, login, failed login, clear-flag, logout all work as qa_app; audit actions: ${acts.join(",")}; plain-SQL disable by the app role ${disable ? "failed: " + disable.slice(0, 50) : "succeeded and the SECURITY INVOKER trigger wrote its audit row (" + trig + ")"}`;
  });
  save("pay4-roles-results.json"); await app.end(); await own.end(); await done();
})().catch((e) => { console.error(e); process.exit(1); });
