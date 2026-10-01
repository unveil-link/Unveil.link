// Race confirmation + Google/not-configured probes. Usage same as qa-backend-1.mjs
import sharp from "sharp"; import pg from "pg"; import crypto from "node:crypto";
const BASE = process.env.BASE ?? "http://localhost:3200";
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const jar = {};
const req = async (method, path, { json, form, headers = {} } = {}) => {
  const h = { ...headers }; const ck = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "); if (ck) h.cookie = ck;
  let body; if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); } if (form) body = form;
  const r = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
  for (const x of r.headers.getSetCookie?.() ?? []) { const [kv] = x.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, text: t, headers: r.headers };
};
await req("POST", "/api/auth/signup", { json: { email: `qa-c-${crypto.randomBytes(3).toString("hex")}@example.com`, password: "Passw0rd!long", displayName: "C" } });
const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#789" } }).jpeg().toBuffer();
const mp = (n) => { const f = new FormData(); f.append("file", new Blob([img], { type: "image/jpeg" }), n); return f; };
await db.query("UPDATE platform_settings SET max_files_per_drop=5");
const s = (await req("POST", "/api/drops", { json: { title: "seq", priceCents: 1000 } })).json.drop;
const seq = []; for (let i = 0; i < 8; i++) seq.push((await req("POST", `/api/drops/${s.id}/files`, { form: mp(`s${i}.jpg`) })).status);
console.log(`[M1-08(race)] sequential, limit=5: ${seq.join(",")}`);
for (const N of [10, 25]) {
  const d = (await req("POST", "/api/drops", { json: { title: "par", priceCents: 1000 } })).json.drop;
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => req("POST", `/api/drops/${d.id}/files`, { form: mp(`p${i}.jpg`) })));
  const n = (await db.query("select count(*)::int n from drop_files where drop_id=$1", [d.id])).rows[0].n;
  console.log(`[M1-08(race)] parallel ${N} uploads, limit=5: statuses 201=${rs.filter((r) => r.status === 201).length} 400=${rs.filter((r) => r.status === 400).length}; rows in DB=${n}`);
}
await db.query("UPDATE platform_settings SET max_files_per_drop=20");
const g = await req("GET", "/api/auth/google"); const cb = await req("GET", "/api/auth/google/callback?code=x&state=y");
console.log(`[M1-02] GET /api/auth/google (no creds) => ${g.status} ${g.text}; callback => ${cb.status} location=${cb.headers.get("location")}`);
const cols = (await db.query("select table_name, string_agg(column_name, ',' order by ordinal_position) c from information_schema.columns where table_schema='public' and table_name<>'schema_migrations' group by 1 order by 1")).rows;
console.log("[M1-14] schema:\n" + cols.map((r) => `   ${r.table_name}(${r.c})`).join("\n"));
await db.end();
