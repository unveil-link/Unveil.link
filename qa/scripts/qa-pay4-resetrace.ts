// @ts-nocheck
/* eslint-disable */
// Round 4 QA: --reset-password vs an attacker who knows the OLD password and keeps logging in during the reset (real CLI process, real server).
// Question: after the CLI prints "existing sessions revoked", can an old-password session still be live?
import { spawn, spawnSync } from "node:child_process";
import { Http, db, stamp, sleep, done } from "./qa-pay4-lib";
const PW = "Qa-Admin-Passphrase-93!x";
(async () => {
  const results: string[] = []; let survivedTrials = 0;
  for (let trial = 0; trial < 5; trial++) {
    const email = `rr-${trial}-${stamp}@example.test`; spawnSync("npx", ["tsx", "scripts/create-admin.ts", email], { env: { ...process.env, ADMIN_PASSWORD: PW }, encoding: "utf8", input: "" });
    const id = (await db.query("SELECT id FROM admins WHERE email=$1", [email])).rows[0].id; let stop = false; const wins: Http[] = [];
    const attacker = (async () => { while (!stop) { await db.query("DELETE FROM login_throttle"); const h = new Http(); h.json("POST", "/api/admin/login", { json: { email, password: PW } }).then((r) => { if (r.status === 200) wins.push(h); }).catch(() => {}); await sleep(60); } })();
    await sleep(500);
    const cli = spawn("npx", ["tsx", "scripts/create-admin.ts", email, "--reset-password"], { env: { ...process.env, ADMIN_PASSWORD: "Reset-To-This-Pass-55#q" + trial }, stdio: "ignore" }); await new Promise((r) => cli.on("close", r));
    await sleep(1500); stop = true; await attacker; await sleep(800);
    const rv = (await db.query("SELECT created_at FROM audit_log WHERE admin_id=$1 AND action='admin_sessions_revoked'", [id])).rows[0].created_at;
    const live = (await db.query("SELECT count(*)::int c, min(created_at) mn FROM admin_sessions WHERE admin_id=$1 AND revoked_at IS NULL AND expires_at>now()", [id])).rows[0];
    const after = (await db.query("SELECT count(*)::int c FROM admin_sessions WHERE admin_id=$1 AND created_at > $2", [id, rv])).rows[0].c;
    let alive = 0; for (const h of wins) if ((await h.json("GET", "/api/admin/me")).status === 200) alive++;
    if (alive > 0) survivedTrials++; results.push(`trial${trial}: attacker got ${wins.length} sessions; sessions created AFTER the revoke committed: ${after}; live sessions now: ${live.c}; /api/admin/me 200 with old-password sessions: ${alive}`);
  }
  console.log(results.join("\n")); console.log(`TRIALS WITH A SURVIVING OLD-PASSWORD SESSION: ${survivedTrials}/5`); await done();
})();
