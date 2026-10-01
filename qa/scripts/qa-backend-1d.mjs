// Expiry probe using the QA instance's own SIGNED_URL_SECRET (env), plus misc missing-endpoint probes. Usage: BASE=.. DB=.. SIGNED_URL_SECRET=.. node qa/scripts/qa-backend-1d.mjs
import crypto from "node:crypto"; import pg from "pg"; import sharp from "sharp";
const BASE = process.env.BASE ?? "http://localhost:3200"; const SECRET = process.env.SIGNED_URL_SECRET;
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const f = (await db.query("select id from drop_files limit 1")).rows[0].id;
const sign = (exp) => crypto.createHmac("sha256", SECRET).update(`original:${f}:${exp}`).digest("base64url");
const now = Math.floor(Date.now() / 1000); const out = [];
for (const [l, exp] of [["valid(+60s)", now + 60], ["expired(-10s)", now - 10], ["expired(-1d)", now - 86400]]) {
  const r = await fetch(`${BASE}/api/files/${f}/original?exp=${exp}&sig=${sign(exp)}`); out.push(`${l}=${r.status}`);
}
const far = now + 10 * 365 * 86400; const r = await fetch(`${BASE}/api/files/${f}/original?exp=${far}&sig=${sign(far)}`); out.push(`10y-future=${r.status}`);
console.log("[M2-15] " + out.join(" "));
const jar = {}; const email = `qa-d-${crypto.randomBytes(3).toString("hex")}@example.com`;
const s = await fetch(BASE + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "Passw0rd!long", displayName: "D" }) });
const ck = s.headers.getSetCookie()[0].split(";")[0];
const call = async (m, p, b) => (await fetch(BASE + p, { method: m, headers: { cookie: ck, "content-type": "application/json" }, body: b && JSON.stringify(b) })).status;
const d = (await (await fetch(BASE + "/api/drops", { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: JSON.stringify({ title: "t", priceCents: 1000 }) })).json()).drop;
console.log(`[PROBE] seller edit/delete endpoints: DELETE drop=${await call("DELETE", `/api/drops/${d.id}`)} DELETE file=${await call("DELETE", `/api/drops/${d.id}/files/${f}`)} DELETE /api/files/:id=${await call("DELETE", `/api/files/${f}`)} PATCH /api/auth/me=${await call("PATCH", "/api/auth/me", { bio: "x" })} PUT /api/auth/me=${await call("PUT", "/api/auth/me", { bio: "x" })}`);
await db.end();
