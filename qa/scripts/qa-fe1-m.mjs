// FE QA part M: "Verified creator" badge vs seller status; reset token single-use (rate limits OFF app); /design in prod. env BASE(3205), BASE2(3206), DB, DB2, MAIL2
import pg from "pg"; import fs from "node:fs"; import crypto from "node:crypto"; const log = (...a) => console.log(...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = JSON.parse(fs.readFileSync("/workspace/qa-run5/out/c-state.json", "utf8")); const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const page = async () => (await fetch(`${process.env.BASE}/u/${st.dropRow.public_link_id}`)).text();
log("[badge] seller verified: page status ok, 'Verified creator' present:", /Verified creator/.test(await page()));
await db.query("update sellers set verification_status='pending' where email=$1", [st.email]);
const h = await page(); log("[badge] seller set to 'pending' while drop still published -> page still renders:", /Spring|Verified creator|buy-button/.test(h) || h.includes("drop-title"), "| 'Verified creator' badge still shown:", /Verified creator/.test(h));
await db.query("update sellers set verification_status='verified' where email=$1", [st.email]);
// reset token reuse (app 3206 has rate limiting off)
const B = process.env.BASE2, M = process.env.MAIL2, e = `qa-tok-${crypto.randomBytes(3).toString("hex")}@example.com`, hd = { "content-type": "application/json", origin: B };
await fetch(B + "/api/auth/signup", { method: "POST", headers: hd, body: JSON.stringify({ email: e, password: "Sunrise-Harbor-4821", displayName: "T" }) }); const b0 = new Set(fs.readdirSync(M)); await fetch(B + "/api/auth/forgot-password", { method: "POST", headers: hd, body: JSON.stringify({ email: e }) });
let mail; for (let i = 0; i < 30 && !mail; i++) { await sleep(300); const f = fs.readdirSync(M).filter((x) => !b0.has(x)); if (f.length) mail = JSON.parse(fs.readFileSync(M + "/" + f[0], "utf8")); }
const tok = mail.text.match(/token=([^\s]+)/)[1]; const r1 = await fetch(B + "/api/auth/reset-password", { method: "POST", headers: hd, body: JSON.stringify({ token: tok, password: "Zebra-Quartz-9315-x" }) }); const r2 = await fetch(B + "/api/auth/reset-password", { method: "POST", headers: hd, body: JSON.stringify({ token: tok, password: "Another-Strong-7731-y" }) });
log("[reset] token first use:", r1.status, "| reuse:", r2.status, (await r2.text()));
log("[reset-email] subject/from:", mail.subject, "|", mail.from, "| body neutral (no adult terms):", !/adult|porn|nsfw|explicit|sex/i.test(mail.text + mail.html));
const d = await fetch(process.env.BASE + "/design"); const dt = await d.text(); log("[design] /design in prod build:", d.status, "| robots noindex meta:", /noindex/.test(dt), "| robots.txt disallow /design:", /Disallow: \/design/.test(await (await fetch(process.env.BASE + "/robots.txt")).text()), "| has DownloadPanel text:", /Download all|Download panel/i.test(dt));
await db.end();
