// @ts-nocheck
/* eslint-disable */
// Round 5 NEW-4 verification: old-password attackers (sequential or fast/parallel) hammer /api/admin/login while the REAL CLI runs --reset-password.
// usage: MODE=seq|fast TRIALS=30 npx tsx qa-pay5-resetrace.ts
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { Http, db, stamp, sleep, done } from "./qa-pay5-lib";
const PW = "Qa-Admin-Passphrase-93!x", MODE = process.env.MODE ?? "seq", TRIALS = Number(process.env.TRIALS ?? 30), PAR = MODE === "fast" ? 4 : 1;
const tkey = (e: string) => "login:" + crypto.createHash("sha256").update(("admin:" + e).trim().toLowerCase()).digest("hex").slice(0, 24);
const cli = (args: string[], pw: string) => new Promise<number>((r) => { const p = spawn("npx", ["tsx", "scripts/create-admin.ts", ...args], { env: { ...process.env, ADMIN_PASSWORD: pw }, stdio: "ignore" }); p.on("close", (c) => r(c ?? -1)); });
(async () => {
  const tot = { trials: 0, minted: 0, mintedAfterRevoke: 0, sessionRowsAfterRevoke: 0, aliveOld: 0, cookieAfterRevoke200: 0, superseded: 0, trialsWithSurvivor: 0, codes: {} as Record<number, number>, newPwLogin200: 0, oldPw401: 0, cliFail: 0 };
  for (let t = 0; t < TRIALS; t++) {
    const email = `rr5-${MODE}-${t}-${stamp}@example.test`;
    if (await cli([email], PW) !== 0) { tot.cliFail++; continue; }
    const id = (await db.query("SELECT id FROM admins WHERE email=$1", [email])).rows[0].id;
    let stop = false; const wins: { h: Http; at: number }[] = []; const loop = async () => { while (!stop) { const h = new Http(); const r = await h.json("POST", "/api/admin/login", { json: { email, password: PW } }); tot.codes[r.status] = (tot.codes[r.status] ?? 0) + 1; if (r.status === 200) wins.push({ h, at: Date.now() }); else if (r.status === 429) await sleep(30); } };
    const atk = Array.from({ length: PAR }, loop);
    await sleep(500 + Math.floor(Math.random() * 600));
    const rc = await cli([email, "--reset-password"], "Reset-To-This-Pass-55#q" + t); if (rc !== 0) tot.cliFail++;
    await sleep(1500); stop = true; await Promise.all(atk); await sleep(300);
    const rv = (await db.query("SELECT created_at FROM audit_log WHERE admin_id=$1 AND action='admin_sessions_revoked' ORDER BY created_at DESC LIMIT 1", [id])).rows[0].created_at;
    const after = (await db.query("SELECT count(*)::int c FROM admin_sessions WHERE admin_id=$1 AND created_at > $2", [id, rv])).rows[0].c;
    const liveAfter = (await db.query("SELECT count(*)::int c FROM admin_sessions WHERE admin_id=$1 AND created_at > $2 AND revoked_at IS NULL AND expires_at>now()", [id, rv])).rows[0].c;
    let alive = 0; for (const w of wins) if ((await w.h.json("GET", "/api/admin/me")).status === 200) alive++;
    const sup = (await db.query("SELECT count(*)::int c FROM audit_log WHERE admin_email=$1 AND action='admin_login_failed' AND reason='superseded'", [email])).rows[0].c;
    const liveOld = (await db.query("SELECT count(*)::int c FROM admin_sessions WHERE admin_id=$1 AND revoked_at IS NULL AND expires_at>now()", [id])).rows[0].c;
    tot.trials++; tot.minted += wins.length; tot.sessionRowsAfterRevoke += after; tot.mintedAfterRevoke += liveAfter; tot.aliveOld += alive; tot.superseded += sup; if (alive || liveOld) tot.trialsWithSurvivor++;
    await db.query("DELETE FROM login_throttle WHERE key=$1", [tkey(email)]);
    const nl = await new Http().json("POST", "/api/admin/login", { json: { email, password: "Reset-To-This-Pass-55#q" + t } }); if (nl.status === 200) tot.newPwLogin200++;
    await db.query("DELETE FROM login_throttle WHERE key=$1", [tkey(email)]);
    const ol = await new Http().json("POST", "/api/admin/login", { json: { email, password: PW } }); if (ol.status === 401) tot.oldPw401++;
    console.log(`${MODE} trial${t}: minted-before-reset ${wins.length}; session rows created after revoke committed ${after}; live ${liveAfter}; /me==200 with old-pw cookies ${alive}; live sessions of admin now ${liveOld}; superseded audits ${sup}`);
  }
  console.log("TOTAL", JSON.stringify(tot)); await done();
})();
