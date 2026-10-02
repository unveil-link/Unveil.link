// What a seller is told in each verification state vs what exists (admin verification queue? support contact? signup promise). env BASE, SEED, DB, OUT, WT
import * as L from "./qa-fe6-lib.mjs"; const { log, ok, seed } = L; const db = await L.dbc(); const b = await L.browser();
const { p } = await L.login(b, seed.maya.email); const mid = (await db.query("select id from sellers where email=$1", [seed.maya.email])).rows[0].id;
for (const st of ["pending", "failed", "manual_review", "verified"]) {
  await db.query("update sellers set verification_status=$1 where id=$2", [st, mid]); await p.goto(L.BASE + "/dashboard", { waitUntil: "networkidle" });
  const t = await p.evaluate(() => [...document.querySelectorAll("[data-testid=verification]")].map((e) => e.innerText).join(" "));  log(`[${st}] alert text: ` + t.replace(/\s+/g, " ")); await p.screenshot({ path: `${L.OUT}/fe6-verif-${st}.png` });
}
await db.query("update sellers set verification_status='verified' where id=$1", [mid]);
const c = await fetch(L.BASE + "/contact"); const ct = await c.text(); ok(/Coming soon/.test(ct), "/contact is a 'Coming soon.' placeholder: there is no support channel to 'Contact support to continue' (failed state)");
import fs from "node:fs"; import path from "node:path"; const writers = []; const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); if (n.isDirectory()) walk(f); else if (/\.tsx?$/.test(n.name)) { fs.readFileSync(f, "utf8").split("\n").forEach((ln, i) => { if (/set\s+verification_status/i.test(ln)) writers.push(`${path.relative(process.env.WT, f)}:${i + 1}`); }); } } }; walk(process.env.WT + "/src");
log("code in src/ that writes sellers.verification_status: " + (writers.join(", ") || "none")); ok(writers.length === 0, "no admin screen, API route or service in src/ sets verification_status (only scripts/set-verification.ts / SQL) -> 'A person is reviewing your verification' and 'Contact support' have nothing behind them");
const sp = await (await fetch(L.BASE + "/signup")).text(); ok(/Start sharing paid links today/.test(sp), "signup subtitle still says 'Start sharing paid links today.' although new sellers are 'pending' and cannot publish");
await db.end(); await b.close(); L.done();
