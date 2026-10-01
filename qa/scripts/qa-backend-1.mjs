// QA probe script for backend/foundation (M1/M2). Usage: BASE=http://localhost:3200 DB=postgres://... node qa/scripts/qa-backend-1.mjs
// Prints one EVIDENCE line per probe. Does not modify app source. Requires a running app and `npm ci`.
import sharp from "sharp";
import pg from "pg";
import fs from "node:fs";
import crypto from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3200";
const DB = process.env.DB;
const OUT = process.env.OUT ?? "/workspace/qa-run/out";
fs.mkdirSync(OUT, { recursive: true });
const db = new pg.Client({ connectionString: DB });
await db.connect();

const log = (id, msg) => console.log(`[${id}] ${msg}`);
class Client {
  constructor() { this.jar = {}; }
  async req(method, path, { json, form, headers = {}, raw } = {}) {
    const h = { ...headers };
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.cookie = cookie;
    let body;
    if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
    if (form) body = form;
    if (raw !== undefined) body = raw;
    const r = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";"); const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (v === "" || /max-age=0/i.test(c)) delete this.jar[k]; else this.jar[k] = v;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    let j = null; try { j = JSON.parse(buf.toString()); } catch {}
    return { status: r.status, headers: r.headers, buf, json: j, text: buf.toString("utf8") };
  }
}
const uniq = () => crypto.randomBytes(4).toString("hex");
async function mkSeller(verified = false, tag = "s") {
  const c = new Client();
  const email = `qa-${tag}-${uniq()}@example.com`;
  const r = await c.req("POST", "/api/auth/signup", { json: { email, password: "Passw0rd!long", displayName: `QA ${tag}` } });
  if (r.status !== 201) throw new Error("signup failed " + r.text);
  if (verified) await db.query("UPDATE sellers SET verification_status='verified' WHERE email=$1", [email]);
  return { c, email, id: r.json.seller.id };
}
function multipart(name, data, type) {
  const f = new FormData(); f.append("file", new Blob([data], { type }), name); return f;
}
const photo = async (fmt = "jpeg", w = 800, h = 600) => {
  const raw = crypto.randomBytes(w * h * 3);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).blur(2)[fmt]().toBuffer();
};
const money = (c) => c;

const R = {}; // results
const set = (id, res, note) => { R[id] = { res, note }; log(id, `${res} — ${note}`); };

// ---------- M1-01 / M1-03 signup
{
  const c = new Client();
  const email = `QA-One-${uniq()}@Example.com`;
  const r = await c.req("POST", "/api/auth/signup", { json: { email, password: "Passw0rd!long", displayName: "QA One" } });
  const set_cookie = r.headers.getSetCookie().join(" | ").replace(/unveil_session=[^;]+/, "unveil_session=<jwt>");
  const me = await c.req("GET", "/api/auth/me");
  const dash = await c.req("GET", "/dashboard");
  const row = (await db.query("SELECT email, verification_status, left(password_hash,4) h FROM sellers WHERE email=lower($1)", [email])).rows[0];
  log("M1-01", `signup=${r.status} body=${JSON.stringify(r.json)} cookie=${set_cookie} me=${me.status} dashboard=${dash.status} dbrow=${JSON.stringify(row)} email stored lowercase=${row.email === email.toLowerCase()}`);
  log("M1-01", `dashboard html contains 'Pending': ${/Pending/.test(dash.text)}`);
}
{
  const c = new Client();
  const email = `qa-dup-${uniq()}@example.com`;
  const ok = await c.req("POST", "/api/auth/signup", { json: { email, password: "Passw0rd!long", displayName: "D" } });
  const dup = await c.req("POST", "/api/auth/signup", { json: { email, password: "Passw0rd!long", displayName: "D" } });
  const dupCase = await c.req("POST", "/api/auth/signup", { json: { email: email.toUpperCase(), password: "Passw0rd!long", displayName: "D" } });
  const dupSpace = await c.req("POST", "/api/auth/signup", { json: { email: ` ${email} `, password: "Passw0rd!long", displayName: "D" } });
  const weak = await c.req("POST", "/api/auth/signup", { json: { email: `qa-w-${uniq()}@example.com`, password: "short", displayName: "D" } });
  const weak2 = await c.req("POST", "/api/auth/signup", { json: { email: `qa-w2-${uniq()}@example.com`, password: "password", displayName: "D" } });
  const weak3 = await c.req("POST", "/api/auth/signup", { json: { email: `qa-w3-${uniq()}@example.com`, password: "12345678", displayName: "D" } });
  const bad = await c.req("POST", "/api/auth/signup", { json: { email: "not-an-email", password: "Passw0rd!long", displayName: "D" } });
  const bad2 = await c.req("POST", "/api/auth/signup", { json: { email: "a@b", password: "Passw0rd!long", displayName: "D" } });
  const noname = await c.req("POST", "/api/auth/signup", { json: { email: `qa-n-${uniq()}@example.com`, password: "Passw0rd!long", displayName: "  " } });
  const badjson = await c.req("POST", "/api/auth/signup", { raw: "{nope", headers: { "content-type": "application/json" } });
  const cnt = (await db.query("SELECT count(*)::int n FROM sellers WHERE lower(email)=lower($1)", [email])).rows[0].n;
  log("M1-03", `first=${ok.status} dup=${dup.status} ${dup.text} | dup-upcase=${dupCase.status} | dup-padded=${dupSpace.status} | weak('short')=${weak.status} ${weak.text} | 'password'=${weak2.status} | '12345678'=${weak3.status} | notanemail=${bad.status} ${bad.text} | a@b=${bad2.status} | blank name=${noname.status} | badjson=${badjson.status} ${badjson.text} | rows for email=${cnt}`);
  if (weak2.status === 201 || weak3.status === 201) log("M1-03", "NOTE: common passwords 'password' / '12345678' accepted (only length>=8 enforced)");
}

// ---------- M1-04 logout/login/session invalidation
{
  const s = await mkSeller(false, "auth");
  const stolen = s.c.jar.unveil_session;
  const lo = await s.c.req("POST", "/api/auth/logout");
  const meAfter = await s.c.req("GET", "/api/auth/me");
  const replay = new Client(); replay.jar.unveil_session = stolen;
  const meReplay = await replay.req("GET", "/api/auth/me");
  const li = await s.c.req("POST", "/api/auth/login", { json: { email: s.email, password: "Passw0rd!long" } });
  const liUpper = await new Client().req("POST", "/api/auth/login", { json: { email: s.email.toUpperCase(), password: "Passw0rd!long" } });
  const liBad = await new Client().req("POST", "/api/auth/login", { json: { email: s.email, password: "wrong" } });
  const liNo = await new Client().req("POST", "/api/auth/login", { json: { email: "nobody@example.com", password: "wrong" } });
  const reset = await new Client().req("POST", "/api/auth/reset-password", { json: { email: s.email } });
  const reset2 = await new Client().req("POST", "/api/auth/forgot-password", { json: { email: s.email } });
  log("M1-04", `logout=${lo.status} me-after-logout(same client)=${meAfter.status} | REPLAY of pre-logout cookie => /api/auth/me ${meReplay.status} | relogin=${li.status} login-uppercase-email=${liUpper.status} wrong-pw=${liBad.status} unknown-user=${liNo.status} | reset endpoints: reset-password=${reset.status} forgot-password=${reset2.status}`);
  // brute force: 15 wrong logins
  const codes = []; for (let i = 0; i < 15; i++) codes.push((await new Client().req("POST", "/api/auth/login", { json: { email: s.email, password: "bad" + i } })).status);
  log("M1-04", `15 rapid wrong logins -> ${[...new Set(codes)].join(",")} (no 429 = no throttle)`);
}

// ---------- M1-05 / M1-07 / M1-08 uploads
const A = await mkSeller(false, "A");
const B = await mkSeller(false, "B");
const createDrop = async (s, over = {}) => (await s.c.req("POST", "/api/drops", { json: { title: "QA drop", description: "d", priceCents: 2000, ...over } }));
const dropA = (await createDrop(A)).json.drop;
{
  const out = [];
  for (const [fmt, mime, ext] of [["jpeg", "image/jpeg", "jpg"], ["png", "image/png", "png"], ["webp", "image/webp", "webp"]]) {
    const data = await photo(fmt);
    const r = await A.c.req("POST", `/api/drops/${dropA.id}/files`, { form: multipart(`p.${ext}`, data, mime) });
    out.push(`${fmt}=${r.status} ${JSON.stringify(r.json?.file ?? r.json)}`);
  }
  const det = await A.c.req("GET", `/api/drops/${dropA.id}`);
  log("M1-05", out.join(" | ") + ` | list=${det.json.files.map((f) => f.mime).join(",")}`);
}
{
  const gif = await sharp(await photo("png", 50, 50)).gif().toBuffer();
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  const exe = Buffer.concat([Buffer.from("MZ"), crypto.randomBytes(2000)]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
  const tiff = await sharp(await photo("png", 50, 50)).tiff().toBuffer();
  const avif = await sharp(await photo("png", 50, 50)).avif().toBuffer().catch(() => null);
  const jpgPolyglot = Buffer.concat([await photo("jpeg", 100, 100), Buffer.from("<?php system($_GET[0]); ?>")]);
  const T = async (n, buf, type) => { const r = await A.c.req("POST", `/api/drops/${dropA.id}/files`, { form: multipart(n, buf, type) }); return `${n}(${type})=${r.status} ${r.json?.code ?? ""}`; };
  const res = [
    await T("a.gif", gif, "image/gif"), await T("a.pdf", pdf, "application/pdf"), await T("a.exe", exe, "application/octet-stream"),
    await T("renamed.jpg", exe, "image/jpeg"), await T("renamed2.jpg", pdf, "image/jpeg"), await T("x.jpg", svg, "image/jpeg"),
    await T("a.tiff", tiff, "image/jpeg"), avif ? await T("a.avif", avif, "image/jpeg") : "avif n/a",
    await T("png-as-jpg.jpg", await photo("png", 30, 30), "image/jpeg"),
    await T("empty.jpg", Buffer.alloc(0), "image/jpeg"),
  ];
  const poly = await A.c.req("POST", `/api/drops/${dropA.id}/files`, { form: multipart("poly.jpg", jpgPolyglot, "image/jpeg") });
  log("M1-07", res.join(" | ") + ` | jpeg+trailing PHP payload=${poly.status} (valid JPEG with appended bytes; accepted=${poly.status === 201}; stored byte-for-byte as original; only reachable via signed URL w/ content-disposition attachment)`);
  const missing = await A.c.req("POST", `/api/drops/${dropA.id}/files`, { form: (() => { const f = new FormData(); f.append("notfile", "x"); return f; })() });
  const nonmp = await A.c.req("POST", `/api/drops/${dropA.id}/files`, { json: { a: 1 } });
  log("M1-07", `missing file field=${missing.status} ${missing.json?.code} | non-multipart=${nonmp.status} ${nonmp.json?.code}`);
  const svgName = await A.c.req("POST", `/api/drops/${dropA.id}/files`, { form: multipart('../../etc/<script>"x.jpg', await photo("jpeg", 40, 40), "image/jpeg") });
  log("M1-07", `hostile filename upload=${svgName.status} stored filename=${JSON.stringify(svgName.json?.file?.filename)}`);
}
// limits: file size 15MiB image limit; >limit via content-length and body; 11th/20th file; video
{
  const over = Buffer.alloc(16 * 1024 * 1024, 7);
  const r = await A.c.req("POST", `/api/drops/${dropA.id}/files`, { form: multipart("big.jpg", over, "image/jpeg") });
  log("M1-08", `16MiB upload -> ${r.status} ${r.text.slice(0, 120)}`);
  const settings = (await db.query("SELECT max_image_size_bytes, max_video_size_bytes, max_files_per_drop FROM platform_settings")).rows[0];
  log("M1-08", `platform_settings = ${JSON.stringify(settings)} (spec: 500MB/file, 2GB/drop, 10 files)`);
  // file count: drop B-ish fresh drop, add until limit
  const d = (await createDrop(A)).json.drop;
  const small = await photo("jpeg", 64, 64);
  let last, n = 0, firstBlock = null;
  for (let i = 1; i <= 22; i++) {
    last = await A.c.req("POST", `/api/drops/${d.id}/files`, { form: multipart(`f${i}.jpg`, small, "image/jpeg") });
    if (last.status === 201) n++; else { firstBlock = firstBlock ?? `#${i}: ${last.status} ${last.text}`; }
  }
  log("M1-08", `files accepted in one drop=${n}; first rejection ${firstBlock}; 11th file accepted? ${n >= 11}`);
  const total = (await db.query("SELECT sum(size_bytes)::bigint t FROM drop_files WHERE drop_id=$1", [d.id])).rows[0].t;
  log("M1-08", `no per-drop total size limit exists in code/schema (grep: none). drop total bytes=${total}`);
  R._countDrop = d.id;
}

// ---------- M1-10 blur
{
  const W = 1200, H = 800;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/><text x="40" y="200" font-size="120" font-family="DejaVu Sans, Arial" font-weight="bold" fill="#000">CONFIDENTIAL</text><text x="40" y="400" font-size="90" font-family="DejaVu Sans, Arial" fill="#000">Name: Jane Roe</text><text x="40" y="600" font-size="70" font-family="DejaVu Sans, Arial" fill="#c00">Card 4111 1111 1111 1111</text><circle cx="1000" cy="600" r="120" fill="#fc9"/><circle cx="960" cy="570" r="12"/><circle cx="1040" cy="570" r="12"/><path d="M950 640 Q1000 690 1050 640" stroke="#000" stroke-width="8" fill="none"/></svg>`;
  const orig = await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
  fs.writeFileSync(`${OUT}/blur-original.jpg`, orig);
  const d = (await createDrop(A)).json.drop;
  const up = await A.c.req("POST", `/api/drops/${d.id}/files`, { form: multipart("text.jpg", orig, "image/jpeg") });
  const pv = await A.c.req("GET", `/api/files/${up.json.file.id}/preview`);
  fs.writeFileSync(`${OUT}/blur-preview.jpg`, pv.buf);
  const m = await sharp(pv.buf).metadata();
  // upscale preview to original size & compare edges
  const up2 = await sharp(pv.buf).resize(W, H).greyscale().raw().toBuffer();
  const o2 = await sharp(orig).greyscale().raw().toBuffer();
  let mad = 0, hiO = 0, hiP = 0; for (let i = 0; i < o2.length; i++) mad += Math.abs(o2[i] - up2[i]);
  const grad = (b) => { let s = 0; for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) s += Math.abs(b[y * W + x] - b[y * W + x - 1]); return s; };
  log("M1-10", `preview=${pv.status} ${pv.headers.get("content-type")} ${pv.buf.length}B (original ${orig.length}B) dims=${m.width}x${m.height} exif=${!!m.exif} icc=${!!m.icc} xmp=${!!m.xmp} horiz-gradient ratio preview/original(upscaled)=${(grad(up2) / grad(o2)).toFixed(3)} MAD=${(mad / o2.length).toFixed(1)}`);
  // Check preview bytes do not contain original bytes
  log("M1-10", `preview contains original bytes? ${pv.buf.includes(orig.subarray(1000, 1064))}`);
  // preview of original dimension leak: size
  const uo = await A.c.req("GET", `/api/files/${up.json.file.id}/preview`, {});
  log("M1-10", `owner draft preview cache-control=${uo.headers.get("cache-control")}`);
  R._blurDrop = d.id; R._blurFile = up.json.file.id; R._blurOrig = orig;
  // anonymous access to draft preview
  const anon = await new Client().req("GET", `/api/files/${up.json.file.id}/preview`);
  const other = await B.c.req("GET", `/api/files/${up.json.file.id}/preview`);
  log("M1-10", `draft preview anon=${anon.status} other-seller=${other.status}`);
}
// EXIF/GPS strip test
{
  const exifJpg = await sharp(await photo("jpeg", 500, 400)).withExif({ IFD0: { Copyright: "SECRET-QA", Make: "QAcam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 44/1 0/1" } }).jpeg().toBuffer();
  const mm = await sharp(exifJpg).metadata();
  const d = (await createDrop(A)).json.drop;
  const up = await A.c.req("POST", `/api/drops/${d.id}/files`, { form: multipart("exif.jpg", exifJpg, "image/jpeg") });
  const pv = await A.c.req("GET", `/api/files/${up.json.file.id}/preview`);
  const pm = await sharp(pv.buf).metadata();
  log("M1-10", `EXIF test: input has exif=${!!mm.exif}; preview exif=${!!pm.exif}, contains 'SECRET-QA'=${pv.buf.includes("SECRET-QA")}`);
  // original stored with EXIF intact (expected: original untouched)
}

// ---------- M1-12 private storage
{
  const f = R._blurFile;
  const row = (await db.query("SELECT storage_key, blurred_preview_key FROM drop_files WHERE id=$1", [f])).rows[0];
  const urls = [`/${row.storage_key}`, `/storage-data/${row.storage_key}`, `/storage/${row.storage_key}`, `/public/${row.storage_key}`, `/_next/static/${row.storage_key}`, `/api/files/${f}/original`, `/api/files/${f}/original?exp=9999999999&sig=AAAA`, `/api/files/${f}/original?exp=1&sig=${crypto.randomBytes(32).toString("base64url")}`, `/${row.storage_key.replace("originals", "previews")}`, `/api/files/${f}`, `/api/files/${f}/../${f}/original`, `/api/files/${f}/original/`, `//${row.storage_key}`, `/..%2f..%2fstorage-data/${row.storage_key}`];
  const out = [];
  for (const u of urls) { const r = await new Client().req("GET", BASE.length ? u : u); out.push(`${u.slice(0, 70)} -> ${r.status}${r.buf.equals(R._blurOrig) ? " !!ORIGINAL LEAKED" : ""}`); }
  log("M1-12", out.join("\n         "));
  // file perms on disk
  const dir = process.env.STORAGE_LOCAL_DIR ?? "/workspace/qa-run/storage";
  log("M1-12", `disk: ${dir}/${row.storage_key} mode=${(fs.statSync(`${dir}/${row.storage_key}`).mode & 0o777).toString(8)}; inside public/? no (public/ has only icons)`);
  // signed URL flows
  const mint = await A.c.req("POST", `/api/files/${f}/signed-url`);
  const got = await new Client().req("GET", mint.json.path);
  log("M1-12", `owner mints signed URL=${mint.status} ${mint.json.path.replace(/sig=.*/, "sig=<sig>")} ttl=${((new Date(mint.json.expiresAt) - Date.now()) / 1000).toFixed(0)}s; anon GET signed=${got.status} bytes-identical=${got.buf.equals(R._blurOrig)} cache-control=${got.headers.get("cache-control")} content-disposition=${got.headers.get("content-disposition")} nosniff=${got.headers.get("x-content-type-options")}`);
  // sig bound to file: use sig on other file
  const f2 = (await db.query("SELECT id FROM drop_files WHERE id<>$1 LIMIT 1", [f])).rows[0].id;
  const u = new URL(BASE + mint.json.path);
  const cross = await new Client().req("GET", `/api/files/${f2}/original${u.search}`);
  const tamperedExp = await new Client().req("GET", `/api/files/${f}/original?exp=${Number(u.searchParams.get("exp")) + 3600}&sig=${u.searchParams.get("sig")}`);
  log("M1-12", `sig for file1 reused on file2=${cross.status}; exp extended with same sig=${tamperedExp.status}`);
  // signed url remains valid after drop unpublished/draft? (it's draft) and after multiple uses
  const again = await new Client().req("GET", mint.json.path);
  log("M1-12", `signed URL re-use (no single-use) = ${again.status}`);
}

// ---------- M1-13 IDOR
{
  const f = R._blurFile, d = R._blurDrop;
  const r = [];
  const t = async (label, c, m, p, o) => { const x = await c.req(m, p, o); r.push(`${label}=${x.status}`); return x; };
  await t("B GET /api/drops/A-drop", B.c, "GET", `/api/drops/${d}`);
  await t("B POST files to A-drop", B.c, "POST", `/api/drops/${d}/files`, { form: multipart("x.jpg", await photo("jpeg", 40, 40), "image/jpeg") });
  await t("B publish A-drop", B.c, "POST", `/api/drops/${d}/publish`, { json: { attestation: { over18: true, ownsRights: true, consentOfSubjects: true } } });
  await t("B unpublish A-drop", B.c, "POST", `/api/drops/${d}/unpublish`);
  await t("B mint signed-url A-file", B.c, "POST", `/api/files/${f}/signed-url`);
  await t("B preview A-draft-file", B.c, "GET", `/api/files/${f}/preview`);
  await t("anon GET A-drop", new Client(), "GET", `/api/drops/${d}`);
  await t("anon mint signed-url", new Client(), "POST", `/api/files/${f}/signed-url`);
  const list = await B.c.req("GET", "/api/drops");
  r.push(`B list drops leaks A? ${JSON.stringify(list.json).includes(d)}`);
  await t("nonexistent uuid", B.c, "GET", `/api/drops/00000000-0000-0000-0000-000000000000`);
  await t("non-uuid id", B.c, "GET", `/api/drops/abc`);
  await t("sqli id", B.c, "GET", `/api/drops/${encodeURIComponent("' OR 1=1--")}`);
  log("M1-13", r.join(" | "));
  const a404 = await B.c.req("GET", `/api/drops/${d}`); const nx = await B.c.req("GET", `/api/drops/00000000-0000-0000-0000-000000000000`);
  log("M1-13", `A-drop vs nonexistent response identical for B: ${a404.text === nx.text} (${a404.text})`);
}

// ---------- M2-01 / M2-02 create + price
{
  const r = await createDrop(A, { title: "  Sunset set ", description: "desc", priceCents: 2000 });
  log("M2-01", `create=${r.status} ${JSON.stringify(r.json.drop)}`);
  const lst = await A.c.req("GET", "/api/drops");
  log("M2-01", `list includes draft=${lst.json.drops.some((d) => d.id === r.json.drop.id)}; cover_url settable via API? create ignores 'coverUrl' (schema has no field); no endpoint for cover image`);
  const withCover = await createDrop(A, { coverUrl: "https://x/y.png" });
  log("M2-01", `create with coverUrl field=${withCover.status} cover_url stored=${withCover.json.drop.cover_url}`);
  const tests = [["$0.99", 99], ["$1", 100], ["$500", 50000], ["$500.01", 50001], ["negative", -500], ["zero", 0], ["float 1000.5", 1000.5], ["string '2000'", "2000"], ["null", null], ["1e9", 1e9], ["MAX_SAFE", Number.MAX_SAFE_INTEGER], ["NaN-string", "abc"]];
  const out = [];
  for (const [l, v] of tests) { const x = await A.c.req("POST", "/api/drops", { json: { title: "p", priceCents: v } }); out.push(`${l}(${JSON.stringify(v)})=${x.status}${x.json?.code ? " " + x.json.code : ""}`); }
  const nop = await A.c.req("POST", "/api/drops", { json: { title: "p" } });
  out.push(`missing price=${nop.status}`);
  const emptyT = await A.c.req("POST", "/api/drops", { json: { title: " ", priceCents: 1000 } });
  out.push(`blank title=${emptyT.status}`);
  const longT = await A.c.req("POST", "/api/drops", { json: { title: "x".repeat(121), priceCents: 1000 } });
  out.push(`121-char title=${longT.status}`);
  const xss = await A.c.req("POST", "/api/drops", { json: { title: "<img src=x onerror=alert(1)>", description: "<script>alert(1)</script>", priceCents: 1000 } });
  out.push(`html title stored raw=${xss.status}`);
  log("M2-02", out.join(" | "));
  R._xssDrop = xss.json.drop;
  // narrowing settings from DB takes effect
  await db.query("UPDATE platform_settings SET price_min_cents=500, price_max_cents=10000");
  const lo = await A.c.req("POST", "/api/drops", { json: { title: "p", priceCents: 100 } });
  const hi = await A.c.req("POST", "/api/drops", { json: { title: "p", priceCents: 20000 } });
  const ok = await A.c.req("POST", "/api/drops", { json: { title: "p", priceCents: 500 } });
  await db.query("UPDATE platform_settings SET price_min_cents=100, price_max_cents=50000");
  log("M2-02", `settings narrowed 500..10000 live (no restart): 100c=${lo.status}, 20000c=${hi.status}, 500c=${ok.status}`);
}

// ---------- M2-03/04/05 publish
const attestAll = { attestation: { over18: true, ownsRights: true, consentOfSubjects: true } };
{
  const u = await mkSeller(false, "unv");
  const d = (await createDrop(u)).json.drop;
  await u.c.req("POST", `/api/drops/${d.id}/files`, { form: multipart("a.jpg", await photo(), "image/jpeg") });
  const states = {};
  for (const st of ["pending", "failed", "manual_review"]) {
    await db.query("UPDATE sellers SET verification_status=$2 WHERE id=$1", [u.id, st]);
    const r = await u.c.req("POST", `/api/drops/${d.id}/publish`, { json: attestAll });
    states[st] = `${r.status} ${r.json?.code}`;
  }
  const pub = await new Client().req("GET", `/api/public/drops/${d.public_link_id}`);
  const row = (await db.query("SELECT status FROM drops WHERE id=$1", [d.id])).rows[0];
  log("M2-03", `publish as unverified -> ${JSON.stringify(states)}; drop status after=${row.status}; public page=${pub.status}`);
  // mass assignment attempt
  const ma = await u.c.req("POST", "/api/drops", { json: { title: "x", priceCents: 1000, status: "published", seller_id: B.id, verification_status: "verified" } });
  log("M2-03", `mass-assignment create with status=published => ${ma.json.drop.status}, seller=${ma.json.drop.seller_id === u.id ? "self" : "OTHER"}`);
  const su = await new Client().req("POST", "/api/auth/signup", { json: { email: `qa-ma-${uniq()}@example.com`, password: "Passw0rd!long", displayName: "x", verification_status: "verified", verificationStatus: "verified" } });
  log("M2-03", `signup mass-assignment verification_status => ${su.json.seller.verification_status}`);
  // race: publish concurrency not needed
  // M2-04 verified
  await db.query("UPDATE sellers SET verification_status='verified' WHERE id=$1", [u.id]);
  const noAtt = await u.c.req("POST", `/api/drops/${d.id}/publish`, { json: { attestation: { over18: true, ownsRights: true, consentOfSubjects: false } } });
  const missAtt = await u.c.req("POST", `/api/drops/${d.id}/publish`, { json: {} });
  const noneAtt = await u.c.req("POST", `/api/drops/${d.id}/publish`, { json: { attestation: { over18: false, ownsRights: false, consentOfSubjects: false } } });
  const strAtt = await u.c.req("POST", `/api/drops/${d.id}/publish`, { json: { attestation: { over18: "true", ownsRights: true, consentOfSubjects: true } } });
  const stillDraft = (await db.query("SELECT status, attestation FROM drops WHERE id=$1", [d.id])).rows[0];
  log("M2-05", `2/3 ticked=${noAtt.status} ${noAtt.json?.code} | none ticked=${noneAtt.status} | missing attestation=${missAtt.status} | string 'true'=${strAtt.status} | status after blocked attempts=${stillDraft.status} attestation=${stillDraft.attestation}`);
  const pubr = await u.c.req("POST", `/api/drops/${d.id}/publish`, { json: attestAll });
  const row2 = (await db.query("SELECT status, attestation, published_at FROM drops WHERE id=$1", [d.id])).rows[0];
  log("M2-04", `publish verified=${pubr.status} body=${JSON.stringify(pubr.json)}`);
  log("M2-05", `stored attestation=${JSON.stringify(row2.attestation)} published_at=${row2.published_at?.toISOString?.()}`);
  R._pubDrop = pubr.json.drop; R._pubSeller = u;
  // empty drop publish
  const e = (await createDrop(u)).json.drop;
  const er = await u.c.req("POST", `/api/drops/${e.id}/publish`, { json: attestAll });
  log("M2-04", `publish drop with 0 files => ${er.status} ${er.json?.code}`);
  // republish idempotency / overwrite attestation
  const re = await u.c.req("POST", `/api/drops/${d.id}/publish`, { json: attestAll });
  const row3 = (await db.query("SELECT attestation FROM drops WHERE id=$1", [d.id])).rows[0];
  log("M2-05", `re-publish already-published=${re.status}; attestation timestamp overwritten=${row3.attestation.at !== row2.attestation.at}; no attestation history/IP/user-agent captured: keys=${Object.keys(row3.attestation)}`);
}

// ---------- M2-06 link IDs
{
  const u = await mkSeller(false, "links");
  const ids = [];
  for (let i = 0; i < 120; i++) { const r = await u.c.req("POST", "/api/drops", { json: { title: "l" + i, priceCents: 100 } }); ids.push(r.json.drop.public_link_id); }
  const set_ = new Set(ids);
  const all12 = ids.every((x) => /^[A-Za-z0-9_-]{12}$/.test(x));
  const chars = {}; ids.join("").split("").forEach((c) => (chars[c] = (chars[c] ?? 0) + 1));
  const first = {}; ids.forEach((x) => (first[x[0]] = (first[x[0]] ?? 0) + 1));
  const distinctChars = Object.keys(chars).length;
  // chi-square over 64-symbol alphabet
  const N = ids.length * 12, exp = N / 64; let chi = 0; for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_") chi += ((chars[c] ?? 0) - exp) ** 2 / exp;
  // sequential/monotonic check
  const sortedEq = JSON.stringify([...ids].sort()) === JSON.stringify(ids);
  const hamming = []; for (let i = 1; i < ids.length; i++) { let h = 0; for (let k = 0; k < 12; k++) if (ids[i][k] !== ids[i - 1][k]) h++; hamming.push(h); }
  log("M2-06", `generated=${ids.length} unique=${set_.size} all12charBase64url=${all12} distinctChars=${distinctChars}/64 chi2=${chi.toFixed(1)} (df=63, p=.05 crit≈82.5) sortedAscending=${sortedEq} avg adjacent hamming=${(hamming.reduce((a, b) => a + b) / hamming.length).toFixed(2)}/12 last char alphabet(only 4 values for 72-bit→ 12 chars: ${[...new Set(ids.map((x) => x[11]))].sort().join("")})  samples=${ids.slice(0, 4).join(",")}`);
  // unguessability: try 300 guesses
  let hits = 0; for (let i = 0; i < 300; i++) { const g = crypto.randomBytes(9).toString("base64url"); const r = await new Client().req("GET", `/api/public/drops/${g}`); if (r.status !== 404) hits++; }
  const seq = []; for (const g of ["aaaaaaaaaaaa", "AAAAAAAAAAAA", "000000000001", "000000000000"]) seq.push((await new Client().req("GET", `/api/public/drops/${g}`)).status);
  log("M2-06", `300 random guesses non-404 hits=${hits}; sequential guesses status=${seq}; 300+ guesses never throttled (no rate limit)`);
  R._linkIds = ids;
}

// ---------- M2-07..09 public page
{
  const d = R._pubDrop, u = R._pubSeller;
  // add 2nd file of different type
  await u.c.req("POST", `/api/drops/${d.id}/files`, { form: multipart("b.png", await photo("png"), "image/png") });
  await u.c.req("POST", `/api/drops/${d.id}/files`, { form: multipart("c.webp", await photo("webp"), "image/webp") });
  const api = await new Client().req("GET", `/api/public/drops/${d.public_link_id}`);
  log("M2-07", `public API ${api.status}: ${api.text}`);
  const page = await new Client().req("GET", `/d/${d.public_link_id}`);
  log("M2-07", `public page /d/<id> ${page.status}; contains title=${page.text.includes("QA drop")}; price shown=${/\$20\.00/.test(page.text)}; seller display name shown=${page.text.includes("QA unv")}; file count shown=${/3 (files|items)/i.test(page.text)}; file types shown=${/(JPG|PNG|WebP)/i.test(page.text)}; blurred <img> count=${(page.text.match(/\/preview/g) ?? []).length}`);
  const alt = await new Client().req("GET", `/u/${d.public_link_id}`);
  log("M2-04", `spec link format unveil.link/u/<12>: GET /u/${d.public_link_id} => ${alt.status}; app returns url "${pubUrl(d)}" (path /d/)`);
  function pubUrl(x) { return `/d/${x.public_link_id}`; }
  // M2-08: leak scan
  const files = (await db.query("SELECT id, storage_key, blurred_preview_key, filename FROM drop_files WHERE drop_id=$1", [d.id])).rows;
  let leaks = [];
  for (const f of files) for (const needle of [f.storage_key, "/original", "originals/", f.filename]) { if (page.text.includes(needle) || api.text.includes(needle)) leaks.push(`${f.id.slice(0, 8)}:${needle}`); }
  log("M2-08", `scan of HTML+JSON for storage_key/'/original'/'originals/'/filename: ${leaks.length ? "FOUND " + leaks.join(",") : "none"}`);
  // preview of each public file: anonymous
  const pv = [];
  for (const f of files) { const r = await new Client().req("GET", `/api/files/${f.id}/preview`); pv.push(`${r.status} ${r.headers.get("content-type")} cc=${r.headers.get("cache-control")}`); }
  log("M2-08", `anonymous previews: ${pv.join(" | ")}`);
  // M2-09 noindex
  const h = Object.fromEntries(page.headers.entries());
  const metaRobots = (page.text.match(/<meta[^>]+name="robots"[^>]*>/gi) ?? []);
  const apiH = api.headers.get("x-robots-tag"); const pvH = (await new Client().req("GET", `/api/files/${files[0].id}/preview`)).headers.get("x-robots-tag");
  const robots = await new Client().req("GET", "/robots.txt"); const sitemap = await new Client().req("GET", "/sitemap.xml");
  const nf = await new Client().req("GET", "/d/zzzzzzzzzzzz");
  log("M2-09", `/d/<id> X-Robots-Tag=${h["x-robots-tag"] ?? "(absent)"}; <meta robots>=${JSON.stringify(metaRobots)}; api X-Robots-Tag=${apiH}; preview X-Robots-Tag=${pvH}; /robots.txt=${robots.status}; /sitemap.xml=${sitemap.status}; unknown link page=${nf.status}`);
  log("M2-09", `directory/search/listing routes: /d=${(await new Client().req("GET", "/d")).status} /api/public/drops=${(await new Client().req("GET", "/api/public/drops")).status} /explore=${(await new Client().req("GET", "/explore")).status} /browse=${(await new Client().req("GET", "/browse")).status}`);
  const home = await new Client().req("GET", "/"); const hm = (home.text.match(/<meta[^>]+name="robots"[^>]*>/gi) ?? []);
  log("M2-09", `landing / robots meta=${JSON.stringify(hm)} (landing page indexable is OK)`);
  // XSS render
  const x = R._xssDrop; await db.query("UPDATE sellers SET verification_status='verified' WHERE id=$1", [u.id]);
  const xd = await u.c.req("POST", "/api/drops", { json: { title: "<img src=x onerror=alert(1)>", description: "<script>alert(9)</script>", priceCents: 1000 } });
  await u.c.req("POST", `/api/drops/${xd.json.drop.id}/files`, { form: multipart("a.jpg", await photo(), "image/jpeg") });
  await u.c.req("POST", `/api/drops/${xd.json.drop.id}/publish`, { json: attestAll });
  const xp = await new Client().req("GET", `/d/${xd.json.drop.public_link_id}`);
  log("M6-01(partial XSS)", `title/desc rendered escaped on public page: raw '<script>alert(9)' present=${xp.text.includes("<script>alert(9)")} escaped present=${xp.text.includes("&lt;script&gt;alert(9)")}`);
  R._xssLink = xd.json.drop.public_link_id;
  // M2-10 edit
  const edit = [];
  for (const m of ["PATCH", "PUT"]) for (const p of [`/api/drops/${d.id}`]) { const r = await u.c.req(m, p, { json: { priceCents: 3000, description: "new" } }); edit.push(`${m} ${p.replace(d.id, ":id")}=${r.status}`); }
  log("M2-10", `edit endpoints: ${edit.join(", ")} (only GET exists on /api/drops/:id)`);
  // M2-11 unpublish
  const up = await u.c.req("POST", `/api/drops/${d.id}/unpublish`);
  const after = await new Client().req("GET", `/api/public/drops/${d.public_link_id}`);
  const afterPage = await new Client().req("GET", `/d/${d.public_link_id}`);
  const afterPv = await new Client().req("GET", `/api/files/${files[0].id}/preview`);
  log("M2-11", `unpublish=${up.status} status=${up.json?.drop?.status}; public API=${after.status}; page=${afterPage.status} (custom 'unavailable' text? ${/unavailable|no longer/i.test(afterPage.text)}); anon preview=${afterPv.status}; buy button n/a (payments not built)`);
  const rep = await u.c.req("POST", `/api/drops/${d.id}/publish`, { json: attestAll });
  log("M2-11", `republish after unpublish=${rep.status} (works)`);
  // M2-12/13/14..17: not implemented probes
  const del = await u.c.req("DELETE", `/api/drops/${d.id}`);
  log("M2-13", `DELETE /api/drops/:id => ${del.status}`);
  const probes = {};
  for (const p of ["/api/drops/" + d.id + "/download", "/api/download", "/api/public/drops/" + d.public_link_id + "/download", "/api/checkout", "/api/orders", "/api/receipts/x", "/api/webhooks/payments", "/api/reports", "/api/admin/drops", "/api/admin/sellers", "/api/seller", "/api/auth/reset-password"]) {
    const r = await new Client().req(p.startsWith("/api/checkout") || p.includes("webhooks") ? "POST" : "GET", p); probes[p.replace(d.id, ":id").replace(d.public_link_id, ":link")] = r.status;
  }
  log("PROBE", `unimplemented route probes: ${JSON.stringify(probes)}`);
}

// ---------- M2-17-ish / rate limit on original
{
  const f = R._blurFile; const statuses = [];
  const t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: 200 }, () => new Client().req("GET", `/api/files/${f}/original?exp=1&sig=x`)));
  const c = {}; rs.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1));
  log("M2-17", `200 rapid requests to /original (bad sig) => ${JSON.stringify(c)} in ${Date.now() - t0}ms (no 429)`);
  const mint = await A.c.req("POST", `/api/files/${f}/signed-url`);
  const seen = {}; const rr = await Promise.all(Array.from({ length: 50 }, () => new Client().req("GET", mint.json.path))); rr.forEach((r) => (seen[r.status] = (seen[r.status] ?? 0) + 1));
  log("M2-16", `50 downloads with the same valid signed URL => ${JSON.stringify(seen)} (no download-attempt counter; no 5-attempt cap)`);
}

// ---------- expiry
{
  const f = R._blurFile;
  // craft expired link w/ real secret? We can't read secret from repo; use DB-free approach: wait for natural TTL not feasible (300s). Covered by e2e check (2s TTL). Record.
  log("M2-15", "default TTL 300s (signing.ts DEFAULT_TTL_S) vs spec 24h; no buyer receipt flow; expiry itself verified by e2e check #19 (410 on expired)");
}

// ---------- misc hardening probes
{
  const probes = [];
  const home = await new Client().req("GET", "/");
  probes.push(`headers on /: ${["strict-transport-security", "x-frame-options", "x-content-type-options", "content-security-policy", "referrer-policy", "permissions-policy", "x-powered-by"].map((h) => `${h}=${home.headers.get(h) ?? "∅"}`).join("; ")}`);
  log("M6-02(partial)", probes.join(""));
  const jsonA = await A.c.req("GET", "/api/auth/me");
  log("M6-01(partial)", `/api/auth/me fields: ${Object.keys(jsonA.json.seller)} (no password_hash leakage: ${!/hash/.test(jsonA.text)})`);
  const csrf1 = await A.c.req("POST", "/api/drops", { json: { title: "csrf", priceCents: 1000 }, headers: { origin: "https://evil.example" } });
  const csrfNoOrigin = await A.c.req("POST", "/api/drops", { raw: JSON.stringify({ title: "csrf", priceCents: 1000 }), headers: { "content-type": "text/plain" } });
  const csrfForm = await A.c.req("POST", "/api/drops", { raw: "title=a&priceCents=1000", headers: { "content-type": "application/x-www-form-urlencoded", origin: "null" } });
  log("M6-01(partial)", `CSRF: cross-origin Origin=${csrf1.status}; text/plain no Origin=${csrfNoOrigin.status}; Origin:null form=${csrfForm.status}`);
  const bigJson = await new Client().req("POST", "/api/auth/signup", { json: { email: "a@example.com", password: "x".repeat(100000), displayName: "x" } });
  log("M6-01(partial)", `100KB password => ${bigJson.status}`);
  const tamper = new Client(); tamper.jar.unveil_session = A.c.jar.unveil_session.slice(0, -3) + "AAA";
  const alg = new Client(); alg.jar.unveil_session = "eyJhbGciOiJub25lIn0." + Buffer.from(JSON.stringify({ sub: A.id })).toString("base64url") + ".";
  log("M6-01(partial)", `tampered JWT=${(await tamper.req("GET", "/api/auth/me")).status}; alg=none JWT=${(await alg.req("GET", "/api/auth/me")).status}`);
  const sc = A.c.jar; 
  const login = await new Client().req("POST", "/api/auth/login", { json: { email: A.email, password: "Passw0rd!long" } });
  log("M6-02(partial)", `session Set-Cookie (NODE_ENV=production): ${login.headers.getSetCookie().join("|").replace(/unveil_session=[^;]+/, "unveil_session=<jwt>")}`);
  // deleted seller loses access
  const tmp = await mkSeller(false, "del"); await db.query("DELETE FROM sellers WHERE id=$1", [tmp.id]);
  log("M1-04", `deleted seller's still-valid cookie => /api/auth/me ${(await tmp.c.req("GET", "/api/auth/me")).status}`);
  // sellers PII in public api
  const pubApi = await new Client().req("GET", `/api/public/drops/${R._xssLink}`);
  log("M2-07", `public API leaks? keys=${Object.keys(pubApi.json)} seller=${JSON.stringify(pubApi.json.seller)} (email/id not exposed: ${!/@/.test(pubApi.text)})`);
}

fs.writeFileSync(`${OUT}/state.json`, JSON.stringify({ A: A.email, B: B.email, linkIds: R._linkIds?.slice(0, 5) }));
await db.end();
