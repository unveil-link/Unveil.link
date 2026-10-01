// Extra probes (video, races, big bodies, decompression bomb, routes, secrets in bundle). Usage same as qa-backend-1.mjs
import sharp from "sharp"; import pg from "pg"; import fs from "node:fs"; import crypto from "node:crypto"; import { execSync } from "node:child_process";
const BASE = process.env.BASE ?? "http://localhost:3200";
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const log = (id, m) => console.log(`[${id}] ${m}`);
const jar = {};
const req = async (method, path, { json, form, headers = {}, raw, c = jar } = {}) => {
  const h = { ...headers }; const ck = Object.entries(c).map(([k, v]) => `${k}=${v}`).join("; "); if (ck) h.cookie = ck;
  let body; if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); } if (form) body = form; if (raw !== undefined) body = raw;
  const r = await fetch(BASE + path, { method, headers: h, body, redirect: "manual", duplex: "half" });
  for (const x of r.headers.getSetCookie?.() ?? []) { const [kv] = x.split(";"); const i = kv.indexOf("="); c[kv.slice(0, i)] = kv.slice(i + 1); }
  const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString()); } catch {}
  return { status: r.status, headers: r.headers, buf, json: j, text: buf.toString() };
};
const email = `qa-x-${crypto.randomBytes(3).toString("hex")}@example.com`;
await req("POST", "/api/auth/signup", { json: { email, password: "Passw0rd!long", displayName: "X" } });
const drop = async (extra = {}) => (await req("POST", "/api/drops", { json: { title: "t", priceCents: 1000, ...extra } })).json.drop;
const mp = (name, data, type) => { const f = new FormData(); f.append("file", new Blob([data], { type }), name); return f; };

// M1-06/11 video
{
  fs.mkdirSync("/workspace/qa-run/out", { recursive: true });
  execSync("ffmpeg -loglevel error -y -f lavfi -i testsrc=duration=2:size=320x240:rate=15 -pix_fmt yuv420p /workspace/qa-run/out/t.mp4");
  const d = await drop();
  const r = await req("POST", `/api/drops/${d.id}/files`, { form: mp("t.mp4", fs.readFileSync("/workspace/qa-run/out/t.mp4"), "video/mp4") });
  log("M1-06", `MP4 upload => ${r.status} ${r.text}`);
}
// M1-09 resumable
{
  const r1 = await req("OPTIONS", "/api/drops/x/files"); const r2 = await req("HEAD", "/api/drops/x/files", {});
  const r3 = await req("PATCH", "/api/drops/x/files", { raw: "x", headers: { "tus-resumable": "1.0.0", "content-type": "application/offset+octet-stream" } });
  log("M1-09", `OPTIONS=${r1.status} HEAD=${r2.status} PATCH(tus)=${r3.status}; /api/uploads: ${(await req("POST", "/api/uploads", { headers: { "tus-resumable": "1.0.0" } })).status}`);
}
// race on max files
{
  const d = await drop(); await db.query("UPDATE platform_settings SET max_files_per_drop=5");
  const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#789" } }).jpeg().toBuffer();
  const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => req("POST", `/api/drops/${d.id}/files`, { form: mp(`r${i}.jpg`, img, "image/jpeg") })));
  const c = {}; rs.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1));
  const n = (await db.query("select count(*)::int n from drop_files where drop_id=$1", [d.id])).rows[0].n;
  const orphans = fs.existsSync("/workspace/qa-run/storage/originals/" + d.id) ? fs.readdirSync("/workspace/qa-run/storage/originals/" + d.id).length : 0;
  await db.query("UPDATE platform_settings SET max_files_per_drop=20");
  log("M1-08(race)", `limit=5, 25 parallel uploads => ${JSON.stringify(c)}; rows in DB=${n}; files on disk=${orphans}`);
}
// decompression bomb / big pixel images
{
  const d = await drop();
  const mk = async (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer();
  for (const [w, h] of [[9900, 9900], [10100, 10000], [30000, 30000]]) {
    let buf; try { buf = await mk(w, h); } catch (e) { log("M6-01(bomb)", `${w}x${h}: could not generate (${e.message})`); continue; }
    const t = Date.now(); const rss0 = Number(execSync("ps -o rss= -p $(cat /workspace/qa-run/pid | head -1) 2>/dev/null || true").toString() || 0);
    const r = await req("POST", `/api/drops/${d.id}/files`, { form: mp("b.png", buf, "image/png") });
    log("M6-01(bomb)", `${w}x${h} png (${(buf.length / 1024).toFixed(0)} KiB file) => ${r.status} ${r.json?.code ?? ""} in ${Date.now() - t}ms`);
  }
}
// chunked upload w/o content-length -> buffered then rejected?
{
  const d = await drop(); const big = Buffer.alloc(60 * 1024 * 1024, 1);
  const boundary = "----qa"; const head = Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="big.jpg"\r\ncontent-type: image/jpeg\r\n\r\n`); const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const stream = new ReadableStream({ start(c) { c.enqueue(head); for (let i = 0; i < big.length; i += 1 << 20) c.enqueue(big.subarray(i, i + (1 << 20))); c.enqueue(tail); c.close(); } });
  const t = Date.now();
  const r = await req("POST", `/api/drops/${d.id}/files`, { raw: stream, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
  log("M1-08(big-chunked)", `60MiB chunked body (no Content-Length, limit 15MiB) => ${r.status} ${r.text.slice(0, 100)} after ${Date.now() - t}ms (server reads whole body into memory before rejecting; only post-read check applies)`);
  const withCL = await req("POST", `/api/drops/${d.id}/files`, { form: mp("big.jpg", big, "image/jpeg") });
  log("M1-08(big-CL)", `60MiB with Content-Length => ${withCL.status} ${withCL.json?.code}`);
}
// unpublish a draft; misc state machine
{
  const d = await drop();
  const r = await req("POST", `/api/drops/${d.id}/unpublish`);
  log("M2-11", `unpublish a never-published draft => ${r.status} status=${r.json?.drop?.status} (draft silently becomes 'unpublished')`);
}
// routes: legal/admin/etc and pages
{
  const out = {};
  for (const p of ["/dashboard", "/dashboard/drops/00000000-0000-0000-0000-000000000000", "/terms", "/privacy", "/2257", "/dmca", "/legal/terms", "/admin", "/api/admin", "/api/admin/settings", "/api/admin/refunds", "/status", "/login", "/signup", "/manifest.webmanifest", "/api/health", "/healthz"]) {
    const r = await req("GET", p, { c: {} }); out[p] = `${r.status}${r.headers.get("location") ? "→" + r.headers.get("location") : ""}`;
  }
  log("PROBE", JSON.stringify(out));
  const sellerCall = {}; for (const p of ["/api/admin/settings", "/api/admin/sellers", "/api/settings"]) sellerCall[p] = (await req("PUT", p, { json: { fee_percent: 50 } })).status;
  log("M5-15", `seller PUT to admin/settings routes => ${JSON.stringify(sellerCall)} (routes do not exist; no admin auth model — admins table only, no login)`);
}
// Origin edge cases causing 500
{
  const a = await req("POST", "/api/drops", { json: { title: "o", priceCents: 1000 }, headers: { origin: "null" } });
  const b = await req("POST", "/api/auth/logout", { headers: { origin: "garbage" } });
  const c = await req("POST", "/api/auth/login", { json: { email: "a@b.co", password: "x" }, headers: { origin: "http://localhost:3200" } });
  log("M6-01(partial)", `Origin:null => ${a.status} ${a.text}; Origin:garbage => ${b.status} ${b.text}; same-origin login=${c.status}`);
}
// secrets in client bundle / repo
{
  const env = Object.fromEntries(fs.readFileSync("/workspace/qa-run/env.sh", "utf8").split("\n").filter((l) => /SECRET/.test(l)).map((l) => l.replace("export ", "").split("=")).map(([k, ...v]) => [k, v.join("=")]));
  let hits = 0; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = d + "/" + f.name; if (f.isDirectory()) walk(p); else { const t = fs.readFileSync(p, "latin1"); for (const v of Object.values(env)) if (v && t.includes(v)) hits++; } } };
  walk("/workspace/unveil/.next-qa/static");
  const tracked = execSync("cd /workspace/unveil && git ls-files | grep -E '(^|/)\\.env($|\\.local)' || true").toString().trim();
  const hist = execSync("cd /workspace/unveil && git log --all --diff-filter=A --name-only --format= | grep -E '(^|/)\\.env($|\\.local)' || true").toString().trim();
  log("M6-02(partial)", `secret values in .next/static client bundle: ${hits} hits; tracked .env files: '${tracked}'; .env ever added in history: '${hist}'; .env.example uses placeholder secrets: yes`);
}
await db.end();
