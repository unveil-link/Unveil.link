// @ts-nocheck
/* eslint-disable */
// Realistic variant of resetrace: attacker holding the OLD password logs in SEQUENTIALLY (one request at a time, no throttle tampering) while the owner runs --reset-password.
import { spawn, spawnSync } from "node:child_process";
import { Http, db, stamp, sleep, done } from "./qa-pay5-lib";
const PW = "Qa-Admin-Passphrase-93!x";
(async () => {
  let surv = 0; const lines: string[] = [];
  for (let trial = 0; trial < 5; trial++) {
    const email = `rr2-${trial}-${stamp}@example.test`; spawnSync("npx", ["tsx", "scripts/create-admin.ts", email], { env: { ...process.env, ADMIN_PASSWORD: PW }, encoding: "utf8", input: "" });
    const id = (await db.query("SELECT id FROM admins WHERE email=$1", [email])).rows[0].id; let stop = false; const wins: Http[] = []; let codes: Record<number, number> = {};
    const attacker = (async () => { while (!stop) { const h = new Http(); const r = await h.json("POST", "/api/admin/login", { json: { email, password: PW } }); codes[r.status] = (codes[r.status] ?? 0) + 1; if (r.status === 200) wins.push(h); } })();
    await sleep(800);
    const cli = spawn("npx", ["tsx", "scripts/create-admin.ts", email, "--reset-password"], { env: { ...process.env, ADMIN_PASSWORD: "Reset-To-This-Pass-55#q" + trial }, stdio: "ignore" }); await new Promise((r) => cli.on("close", r));
    await sleep(1500); stop = true; await attacker;
    const rv = (await db.query("SELECT created_at FROM audit_log WHERE admin_id=$1 AND action='admin_sessions_revoked'", [id])).rows[0].created_at;
    const after = (await db.query("SELECT count(*)::int c FROM admin_sessions WHERE admin_id=$1 AND created_at > $2 AND revoked_at IS NULL", [id, rv])).rows[0].c;
    let alive = 0; for (const h of wins) if ((await h.json("GET", "/api/admin/me")).status === 200) alive++; if (alive) surv++;
    lines.push(`trial${trial}: attacker HTTP codes ${JSON.stringify(codes)}; sessions created after revoke committed & still live: ${after}; /api/admin/me==200 using OLD-password sessions: ${alive}`);
  }
  console.log(lines.join("\n")); console.log(`TRIALS WITH A SURVIVING OLD-PASSWORD SESSION: ${surv}/5`); await done();
})();
