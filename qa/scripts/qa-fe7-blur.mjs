// "Originals are stored privately. Buyers only see blurred previews." -> upload a high-detail image, compare preview vs original; anonymous access to original; storage location. env BASE, SEED, DB, OUT, WT
import * as L from "./qa-fe7-lib.mjs"; import { createRequire } from "node:module"; import crypto from "node:crypto"; import fs from "node:fs";
const require = createRequire(process.env.WT + "/package.json"); const sharp = require("sharp"); const { log, ok, seed, BASE } = L; const db = await L.dbc();
const lr = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": L.fakeIp(66) }, body: JSON.stringify({ email: seed.maya.email, password: L.PW }) }); const ck = lr.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
const noise = await sharp(crypto.randomBytes(800 * 600 * 3), { raw: { width: 800, height: 600, channels: 3 } }).jpeg({ quality: 95 }).toBuffer(); // maximum detail
const mid = (await db.query("select id from sellers where email=$1", [seed.maya.email])).rows[0].id; const link = crypto.randomBytes(9).toString("base64url");
const did = (await db.query("insert into drops (seller_id,title,description,price_cents,status,public_link_id) values ($1,'Blur test','d',500,'published',$2) returning id", [mid, link])).rows[0].id;
const fd = new FormData(); fd.append("file", new Blob([noise], { type: "image/jpeg" }), "noise.jpg");
const up = await fetch(`${BASE}/api/drops/${did}/files`, { method: "POST", headers: { cookie: ck, origin: BASE, "x-forwarded-for": L.fakeIp(66) }, body: fd }); const uj = await up.json(); ok(up.status === 201 || up.status === 200, `upload noise.jpg -> ${up.status}`);
const fid = uj.file?.id ?? uj.id ?? (await db.query("select id from files where drop_id=$1", [did])).rows[0].id;
const pv = Buffer.from(await (await fetch(`${BASE}/api/files/${fid}/preview`)).arrayBuffer()); const pm = await sharp(pv).metadata();
const hf = async (buf) => { const { data, info } = await sharp(buf).greyscale().resize(256, 192, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true }); let s = 0, n = 0; for (let y = 0; y < info.height; y++) for (let x = 1; x < info.width; x++) { const d = data[y * info.width + x] - data[y * info.width + x - 1]; s += d * d; n++; } return s / n; };
const eo = await hf(noise), ep = await hf(pv); log(`   high-frequency energy: original ${eo.toFixed(0)}, public preview ${ep.toFixed(0)} (${(ep / eo * 100).toFixed(1)}%), preview ${pm.width}x${pm.height} ${(pv.length / 1024).toFixed(0)} KB vs original ${(noise.length / 1024).toFixed(0)} KB`);
ok(ep < eo * 0.05, "anonymous preview is heavily blurred (<5% of the original's high-frequency detail)");
const ao = await fetch(`${BASE}/api/files/${fid}/original`); ok(ao.status === 403 || ao.status === 401, `anonymous GET /original -> ${ao.status}`);
const pj = await (await fetch(`${BASE}/api/public/drops/${link}`)).text(); ok(!/storage|original|filename|noise\.jpg|\/uploads\//i.test(pj), "public drop JSON exposes no storage key / filename / original URL");
const st = process.env.WT + "/.qa-storage"; ok(fs.existsSync(st) && !st.includes("/public"), `storage dir is outside public/: ${st}`);
const pub = await fetch(`${BASE}/${fid}.jpg`); ok(pub.status === 404, "no static file route exposes the original (GET /<id>.jpg -> " + pub.status + ")");
await db.query("delete from files where drop_id=$1", [did]).catch(() => {}); await db.query("delete from drops where id=$1", [did]).catch(() => {}); await db.end(); L.done();
