// Targeted re-test of the 7 failed cases against backend/fixes-1.
// Usage: BASE=http://localhost:3201 DB=postgres://.../unveil_e2e_qa2 STORAGE_LOCAL_DIR=... node qa/scripts/qa-fixes-1.mjs   (app started with RATE_LIMIT_ENABLED=0)
import sharp from "sharp"; import pg from "pg"; import crypto from "node:crypto";
const BASE = process.env.BASE ?? "http://localhost:3201";
const db = new pg.Client({ connectionString: process.env.DB }); await db.connect();
const log = (id, m) => console.log(`[${id}] ${m}`);
class C { constructor() { this.jar = {}; }
  async req(method, path, { json, form, headers = {} } = {}) {
    const h = { ...headers }; const ck = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "); if (ck) h.cookie = ck;
    let body; if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); } if (form) body = form;
    const r = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
    for (const x of r.headers.getSetCookie?.() ?? []) { const [kv] = x.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v === "" || /max-age=0/i.test(x)) delete this.jar[k]; else this.jar[k] = v; }
    const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString()); } catch {}
    return { status: r.status, headers: r.headers, buf, json: j, text: buf.toString("utf8") };
  } }
const u = () => crypto.randomBytes(4).toString("hex");
const PW = "Correct-Horse-Battery-9";
async function seller(verified = false, name = "QA Seller") {
  const c = new C(); const email = `qa-f-${u()}@example.com`;
  const r = await c.req("POST", "/api/auth/signup", { json: { email, password: PW, displayName: name } });
  if (r.status !== 201) throw new Error("signup " + r.text);
  if (verified) await db.query("update sellers set verification_status='verified' where email=$1", [email]);
  return { c, email, id: r.json.seller.id };
}
const mp = (n, d, t = "image/jpeg") => { const f = new FormData(); f.append("file", new Blob([d], { type: t }), n); return f; };
const jpg = async (w = 64, h = 64) => sharp({ create: { width: w, height: h, channels: 3, background: { r: Math.random() * 255, g: 90, b: 120 } } }).jpeg().toBuffer();
const att = { attestation: { over18: true, ownsRights: true, consentOfSubjects: true } };

// ===== M1-04
{
  const s = await seller(); const old = s.c.jar.unveil_session;
  const dev2 = new C(); const l2 = await dev2.req("POST", "/api/auth/login", { json: { email: s.email, password: PW } });
  const pre = (await s.c.req("GET", "/api/auth/me")).status;
  const lo = await s.c.req("POST", "/api/auth/logout");
  const replay = new C(); replay.jar.unveil_session = old;
  const rp = await replay.req("GET", "/api/auth/me");
  const rpWrite = await replay.req("POST", "/api/drops", { json: { title: "x", priceCents: 1000 } });
  const other = await dev2.req("GET", "/api/auth/me");
  const rows = (await db.query("select count(*)::int n, count(revoked_at)::int r from sessions where seller_id=$1", [s.id])).rows[0];
  log("M1-04", `me-before=${pre}; logout=${lo.status}; REPLAY old cookie: GET /api/auth/me=${rp.status}, POST /api/drops=${rpWrite.status}; other device session still=${other.status}; sessions rows total=${rows.n} revoked=${rows.r}`);
  const relog = await new C().req("POST", "/api/auth/login", { json: { email: s.email, password: PW } });
  log("M1-04", `re-login after logout=${relog.status}`);
  // expired session
  await db.query("update sessions set expires_at = now() - interval '1 minute' where seller_id=$1 and revoked_at is null", [s.id]);
  log("M1-04", `session with expires_at in past -> /api/auth/me=${(await dev2.req("GET", "/api/auth/me")).status}`);
  // forged jwt with unknown jti was covered in e2e; forge here w/o secret: random
  const f = new C(); f.jar.unveil_session = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ sub: s.id, jti: crypto.randomUUID() })).toString("base64url") + ".AAAA";
  log("M1-04", `forged token (right sub, random jti, bad sig) -> ${(await f.req("GET", "/api/auth/me")).status}`);
  // password reset revokes
  const a = new C(); await a.req("POST", "/api/auth/login", { json: { email: s.email, password: PW } });
  const fp = await new C().req("POST", "/api/auth/forgot-password", { json: { email: s.email } });
  log("M1-04", `forgot-password=${fp.status} ${fp.text}; unknown email=${(await new C().req("POST", "/api/auth/forgot-password", { json: { email: "nobody-" + u() + "@example.com" } })).status} (same status → no enumeration)`);
}
// ===== M1-08
{
  const s = await seller(); const mk = async () => (await s.c.req("POST", "/api/drops", { json: { title: "q", priceCents: 1000 } })).json.drop;
  const st = await (await fetch(BASE + "/api/settings")).json();
  log("M1-08", `GET /api/settings => maxFilesPerDrop=${st.maxFilesPerDrop} maxTotalBytesPerDrop=${st.maxTotalBytesPerDrop} (=${st.maxTotalBytesPerDrop / 1024 ** 3} GiB)`);
  const row = (await db.query("select max_files_per_drop m, max_total_bytes_per_drop t from platform_settings")).rows[0];
  log("M1-08", `DB defaults: max_files_per_drop=${row.m} max_total_bytes_per_drop=${row.t}`);
  // sequential 12
  let d = await mk(); const seq = []; for (let i = 1; i <= 12; i++) seq.push((await s.c.req("POST", `/api/drops/${d.id}/files`, { form: mp(`s${i}.jpg`, await jpg()) })).status);
  const r11 = await s.c.req("POST", `/api/drops/${d.id}/files`, { form: mp("x.jpg", await jpg()) });
  log("M1-08", `sequential 12 uploads: ${seq.join(",")}; 11th body: ${(await s.c.req("POST", `/api/drops/${d.id}/files`, { form: mp("y.jpg", await jpg()) })).text}`);
  // parallel
  const runPar = async (N) => { const d2 = await mk(); const imgs = await Promise.all(Array.from({ length: N }, () => jpg())); const rs = await Promise.all(imgs.map((b, i) => s.c.req("POST", `/api/drops/${d2.id}/files`, { form: mp(`p${i}.jpg`, b) }))); const n = (await db.query("select count(*)::int n from drop_files where drop_id=$1", [d2.id])).rows[0].n; const fsn = await import("node:fs").then((m) => { const p = `${process.env.STORAGE_LOCAL_DIR}/originals/${d2.id}`; return m.existsSync(p) ? m.readdirSync(p).length : 0; }); return `${N} parallel -> 201=${rs.filter((r) => r.status === 201).length} 400=${rs.filter((r) => r.status === 400).length} other=${rs.filter((r) => ![201, 400].includes(r.status)).length}; DB rows=${n}; files on disk=${fsn}`; };
  for (let k = 0; k < 3; k++) log("M1-08", `race run ${k + 1}: ${await runPar(30)}`);
  // parallel across two sessions same seller
  // total-size cap: lower to 150000 bytes
  const big = async (kb) => sharp(crypto.randomBytes(300 * 300 * 3), { raw: { width: 300, height: 300, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  const sample = await big(); log("M1-08", `sample incompressible jpeg = ${sample.length} bytes`);
  const cap = sample.length * 3 + 100; await db.query("update platform_settings set max_total_bytes_per_drop=$1", [cap]);
  d = await mk(); const seqc = []; for (let i = 0; i < 5; i++) { const r = await s.c.req("POST", `/api/drops/${d.id}/files`, { form: mp(`b${i}.jpg`, sample) }); seqc.push(`${r.status}${r.json?.code ? ":" + r.json.code : ""}`); }
  const tot = (await db.query("select coalesce(sum(size_bytes),0)::int t from drop_files where drop_id=$1", [d.id])).rows[0].t;
  log("M1-08", `total-size cap=${cap}B (3 files fit): sequential 5 uploads -> ${seqc.join(",")}; stored total=${tot}B (<= cap: ${tot <= cap})`);
  const msg = await s.c.req("POST", `/api/drops/${d.id}/files`, { form: mp("z.jpg", sample) }); log("M1-08", `cap error message: ${msg.status} ${msg.text}`);
  const d3 = await mk(); const imgs = await Promise.all(Array.from({ length: 12 }, () => big())); const rs = await Promise.all(imgs.map((b, i) => s.c.req("POST", `/api/drops/${d3.id}/files`, { form: mp(`c${i}.jpg`, b) })));
  const t3 = (await db.query("select coalesce(sum(size_bytes),0)::int t, count(*)::int n from drop_files where drop_id=$1", [d3.id])).rows[0];
  log("M1-08", `total-size cap race: 12 parallel -> 201=${rs.filter((r) => r.status === 201).length}, rejected=${rs.filter((r) => r.status === 400 || r.status === 413).length} (codes ${[...new Set(rs.map((r) => r.status + ":" + (r.json?.code ?? "")))]}); stored n=${t3.n} total=${t3.t}B <= cap ${cap}: ${t3.t <= cap}`);
  await db.query("update platform_settings set max_total_bytes_per_drop=2147483648");
  // 2GB boundary at default using a pre-seeded drop (size_bytes inserted directly; no real bytes)
  const d4 = await mk(); await db.query("insert into drop_files(drop_id,storage_key,filename,mime,size_bytes) values ($1,$2,'seed.jpg','image/jpeg',$3)", [d4.id, `qa/seed/${u()}`, 2147483648 - 1000]);
  const over = await s.c.req("POST", `/api/drops/${d4.id}/files`, { form: mp("o.jpg", await big()) });
  const d5 = await mk(); await db.query("insert into drop_files(drop_id,storage_key,filename,mime,size_bytes) values ($1,$2,'seed.jpg','image/jpeg',$3)", [d5.id, `qa/seed/${u()}`, 2147483648 - 1000000]);
  const under = await s.c.req("POST", `/api/drops/${d5.id}/files`, { form: mp("u.jpg", await big()) });
  log("M1-08", `2 GiB boundary at DEFAULT setting (drop pre-seeded with a 2GiB-1000B row): next ~${sample.length}B upload -> ${over.status} ${over.json?.code}; drop at 2GiB-1,000,000B + ~${sample.length}B -> ${under.status}`);
  const big16 = Buffer.alloc(16 * 1024 * 1024, 7); const d6 = await mk(); const r16 = await s.c.req("POST", `/api/drops/${d6.id}/files`, { form: mp("big.jpg", big16) });
  log("M1-08", `per-file 15MiB cap still enforced: 16MiB -> ${r16.status} ${r16.json?.code}`);
}
// ===== M2-04 / M2-07 / M2-09
{
  const s = await seller(true, "Aria Test"); const d = (await s.c.req("POST", "/api/drops", { json: { title: "Summer set", description: "desc here", priceCents: 2000 } })).json.drop;
  const pre = await s.c.req("POST", `/api/drops/${d.id}/publish`, { json: att }); // no files
  await s.c.req("POST", `/api/drops/${d.id}/files`, { form: mp("a.jpg", await jpg()) });
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } }).png().toBuffer(); await s.c.req("POST", `/api/drops/${d.id}/files`, { form: mp("b.png", png, "image/png") });
  const pub = await s.c.req("POST", `/api/drops/${d.id}/publish`, { json: att });
  const url = pub.json.url;
  log("M2-04", `publish=${pub.status} url=${url} matches ^/u/[A-Za-z0-9_-]{12}$: ${/^\/u\/[A-Za-z0-9_-]{12}$/.test(url)}; GET ${url}=${(await new C().req("GET", url)).status}; legacy /d/<id>=${(await new C().req("GET", "/d/" + d.public_link_id)).status} → ${(await new C().req("GET", "/d/" + d.public_link_id)).headers.get("location")}`);
  const ids = []; for (let i = 0; i < 40; i++) ids.push((await s.c.req("POST", "/api/drops", { json: { title: "l", priceCents: 100 } })).json.drop.public_link_id);
  log("M2-04", `40 new links: unique=${new Set(ids).size} all 12 chars=${ids.every((x) => /^[A-Za-z0-9_-]{12}$/.test(x))}`);
  const page = await new C().req("GET", url); const api = await new C().req("GET", `/api/public/drops/${d.public_link_id}`);
  const main = page.text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").match(/<main[\s\S]*?<\/main>/)?.[0] ?? "";
  const txt = main.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " | ").replace(/\s+/g, " ").replace(/(\| )+/g, "| ");
  log("M2-07", `page ${page.status} main text: ${txt.slice(0, 300)}`);
  log("M2-07", `has title=${txt.includes("Summer set")} seller name=${txt.includes("Aria Test")} file count+types=${/2 files: 2 images/.test(txt)} price=${txt.includes("$20.00")} blurred imgs=${(main.match(/<img/g) ?? []).length}`);
  log("M2-07", `API: ${JSON.stringify({ seller: api.json.seller, summary: api.json.summary, priceCents: api.json.drop.priceCents })}; email/uuid leak=${/@|[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify({ d: api.json.drop, s: api.json.seller, su: api.json.summary })) }`);
  const files = (await db.query("select id, storage_key, filename from drop_files where drop_id=$1", [d.id])).rows;
  const leak = files.flatMap((f) => [f.storage_key, "/original", "originals/", f.filename]).filter((n) => page.text.includes(n) || api.text.includes(n));
  log("M2-08(regr)", `originals/keys/filenames in page or API: ${leak.length ? "FOUND " + leak : "none"}`);
  // mixed video row for type label (db seeded only, no bytes) 
  await db.query("insert into drop_files(drop_id,storage_key,filename,mime,size_bytes,sort_order) values ($1,$2,'v.mp4','video/mp4',1000,99)", [d.id, `qa/seed/${u()}`]);
  const api2 = await new C().req("GET", `/api/public/drops/${d.public_link_id}`); log("M2-07", `with a seeded video row: summary=${JSON.stringify(api2.json.summary)}`);
  await db.query("delete from drop_files where filename='v.mp4' and drop_id=$1", [d.id]);
  // M2-09
  const h = (r, k) => r.headers.get(k) ?? "(absent)";
  const pv = await new C().req("GET", api.json.previews[0].url);
  const rob = await new C().req("GET", "/robots.txt"); const sm = await new C().req("GET", "/sitemap.xml");
  const metas = page.text.match(/<meta[^>]+name="robots"[^>]*>/gi);
  log("M2-09", `${url}: X-Robots-Tag=${h(page, "x-robots-tag")}; meta=${JSON.stringify(metas)}`);
  log("M2-09", `/api/public/drops/<id> X-Robots-Tag=${h(api, "x-robots-tag")}; preview X-Robots-Tag=${h(pv, "x-robots-tag")}; legacy /d redirect X-Robots-Tag=${h(await new C().req("GET", "/d/" + d.public_link_id), "x-robots-tag")}; 404 link page X-Robots-Tag=${h(await new C().req("GET", "/u/zzzzzzzzzzzz"), "x-robots-tag")}`);
  log("M2-09", `/robots.txt ${rob.status} ${JSON.stringify(rob.text)}; /sitemap.xml ${sm.status}`);
  const mint = await s.c.req("POST", `/api/files/${files[0].id}/signed-url`); const orig = await new C().req("GET", mint.json.path);
  log("M2-09", `signed original X-Robots-Tag=${h(orig, "x-robots-tag")}`);
  log("M2-09", `no listings: ${["/u", "/explore", "/browse", "/api/public/drops"].map(async () => 0).length ? (await Promise.all(["/u", "/explore", "/browse", "/api/public/drops"].map(async (p) => `${p}=${(await new C().req("GET", p)).status}`))).join(" ") : ""}`);
  // M6-02 headers
  const targets = { "/": null, [url]: null, "/login": null, "/api/settings": null, [`/api/public/drops/${d.public_link_id}`]: null, [api.json.previews[0].url]: null, [mint.json.path]: null, "/no-such-page": null, "/_next/static/chunks/nonexistent.js": null, "/dashboard": null };
  const want = ["content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"];
  for (const p of Object.keys(targets)) { const r = await new C().req("GET", p); const miss = want.filter((k) => !r.headers.get(k)); log("M6-02", `GET ${p.replace(/\?.*/, "?…").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, "<uuid>")} -> ${r.status}; missing: ${miss.length ? miss.join(",") : "none"}; x-powered-by=${h(r, "x-powered-by")}`); }
  const root = await new C().req("GET", "/");
  for (const k of want) log("M6-02", `  ${k}: ${root.headers.get(k)}`);
  const post = await s.c.req("POST", "/api/auth/logout", {}); log("M6-02", `POST /api/auth/logout headers present: ${want.filter((k) => post.headers.get(k)).length}/6`);
  // CSP in real browser is checked by qa-ui-smoke
}
await db.end();
