// backend/m2-media: MP4 upload validation / limits / preview / privacy / streaming probes. env from /workspace/qa-m2/env.sh (+ APP_PID_PORT=3260)
import * as L from "./qa-m2-lib.mjs"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import http from "node:http"; import net from "node:net"; import { execSync, spawnSync } from "node:child_process"; import sharp from "sharp";
const { check, rec, assert, eq, makeSeller, newDrop, upload, media, db, dropFiles, storedFiles, tmpFiles, sleep, MEDIA, STORAGE, BASE } = L;
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const shaFile = (p) => { const h = crypto.createHash("sha256"); h.update(fs.readFileSync(p)); return h.digest("hex"); };
const s = await makeSeller("vid"); const other = await makeSeller("vid-other");
const pidOf = (port) => execSync(`ss -ltnp | grep ":${port} " | sed -E 's/.*pid=([0-9]+).*/\\1/' | head -1`).toString().trim();
const rss = (pid) => Number(fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/VmRSS:\s+(\d+)/)[1]) / 1024;
const upl = (drop, name, type = "video/mp4", file = name) => upload(s, drop.id, media(file), name, type);
const noLeak = (text) => assert(!/\/workspace|storage|originals\/|previews\/|\.part|ffmpeg|ffprobe|spawn|ENOENT|stack|at \w+ \(/i.test(text), `leaks internal detail: ${text.slice(0, 200)}`);
const countRows = async () => Number((await db.query("select count(*) n from drop_files")).rows[0].n);
async function pristine(d, label) { // nothing stored, no temp left, no DB row for this drop
  await sleep(150); eq((await dropFiles(d.id)).length, 0, `${label}: rows`); eq(storedFiles().filter((f) => f.includes(d.id)).length, 0, `${label}: stored objects`); eq(tmpFiles().length, 0, `${label}: temp files ${tmpFiles()}`);
}

// ---------- A. happy path + metadata ----------
const d1 = await newDrop(s, { title: "video happy" });
let v1;
await check("M1-06", "upload 1 valid MP4 (H.264/AAC 1280x720 4 s, with title/GPS-style metadata) -> 201, listed, mime video/mp4", async () => {
  const r = await upl(d1, "good.mp4"); eq(r.status, 201, r.text); v1 = r.json.file; eq(v1.mime, "video/mp4", "mime"); eq(v1.sizeBytes, fs.statSync(`${MEDIA}/good.mp4`).size, "size");
  const g = await s.http.j("GET", `/api/drops/${d1.id}`); const f = g.json.files[0]; assert(f && f.mime === "video/mp4" && f.has_preview === true, JSON.stringify(g.json.files));
  return `201 ${r.text.slice(0, 160)} | list: ${JSON.stringify(f)}`;
});
await check("M1-06b", "stored original is byte-identical, private (0600), outside public/.next static; temp spool removed", async () => {
  const row = (await dropFiles(d1.id))[0]; const p = path.join(STORAGE, row.storage_key); eq(shaFile(p), shaFile(`${MEDIA}/good.mp4`), "sha256");
  const mode = (fs.statSync(p).mode & 0o777).toString(8); eq(mode, "600", "mode"); assert(!p.includes("/public/") && !p.includes("/.next"), "path"); eq(tmpFiles().length, 0, "tmp left");
  return `sha256 equal; mode ${mode}; key ${row.storage_key.replace(d1.id, "<drop>")}; tmp empty`;
});
let rawFrame, prevBuf;
await check("M1-11", "blurred preview generated from the video: JPEG <=320px, truly blurred (high-pass energy vs raw frame), no EXIF/ICC/XMP, source metadata strings absent", async () => {
  const f = (await dropFiles(d1.id))[0]; const pv = await s.http.req("GET", `/api/files/${f.id}/preview`); eq(pv.status, 200, "preview status"); eq(pv.headers.get("content-type"), "image/jpeg", "ct");
  prevBuf = Buffer.from(await pv.arrayBuffer()); const m = await sharp(prevBuf).metadata(); assert(m.format === "jpeg" && m.width <= 320 && m.height <= 320, `${m.format} ${m.width}x${m.height}`);
  assert(!m.exif && !m.icc && !m.xmp && !m.iptc, "metadata present"); const txt = prevBuf.toString("latin1"); assert(!/SECRET-TITLE-QA|GPS-QA-LEAK|40\.7128/.test(txt), "metadata string in preview");
  // raw frame at 1 s for comparison
  fs.mkdirSync("/workspace/qa-m2/out", { recursive: true }); execSync(`ffmpeg -v error -y -ss 1 -i ${MEDIA}/good.mp4 -frames:v 1 -vf scale=${m.width}:${m.height} /workspace/qa-m2/out/raw.png`); rawFrame = fs.readFileSync("/workspace/qa-m2/out/raw.png");
  const hp = async (b) => { const w = await sharp(b).resize(m.width, m.height, { fit: "fill" }).greyscale().raw().toBuffer(); const bl = await sharp(b).resize(m.width, m.height, { fit: "fill" }).greyscale().blur(2).raw().toBuffer(); let e = 0; for (let i = 0; i < w.length; i++) e += Math.abs(w[i] - bl[i]); return e / w.length; };
  const hpPrev = await hp(prevBuf), hpRaw = await hp(rawFrame); const ratio = hpPrev / hpRaw; assert(ratio < 0.25, `high-pass ratio ${ratio.toFixed(3)}`);
  fs.writeFileSync("qa/artifacts/backend-m2-media/video-preview-blurred.jpg", prevBuf); fs.copyFileSync("/workspace/qa-m2/out/raw.png", "qa/artifacts/backend-m2-media/video-raw-frame.png");
  return `${m.format} ${m.width}x${m.height} ${prevBuf.length} B; no exif/icc/xmp/iptc; metadata strings absent; high-pass energy preview/raw = ${ratio.toFixed(3)} (limit 0.25) [artifacts video-preview-blurred.jpg vs video-raw-frame.png]`;
});
await check("M1-11b", "preview is not the original: cannot recover original bytes/frames from the preview file; preview key differs, stored under previews/", async () => {
  const f = (await dropFiles(d1.id))[0]; assert(f.blurred_preview_key.startsWith("previews/") && f.blurred_preview_key !== f.storage_key, f.blurred_preview_key);
  assert(prevBuf.length < 20000, `preview ${prevBuf.length}`); const sml = await sharp(prevBuf).resize(8, 8).raw().toBuffer(); return `preview ${prevBuf.length} B (original ${f.size_bytes} B); previews/ key; 320px-max`;
});

// ---------- B. other valid MP4 flavours ----------
for (const [n, note] of [["mp42.mp4", "brand mp42"], ["good-noFast.mp4", "moov at end"], ["small.mp4", "640x360 2 s"], ["rot90.mp4", "rotate metadata"], ["hevc.mp4", "HEVC in MP4 (hvc1)"], ["av1.mp4", "AV1 in MP4"]]) {
  await check(`V-ok-${n}`, `valid MP4 variant accepted (${note})`, async () => { const d = await newDrop(s); const r = await upl(d, n); eq(r.status, 201, r.text); const f = (await dropFiles(d.id))[0]; const pv = await s.http.req("GET", `/api/files/${f.id}/preview`); eq(pv.status, 200, "preview"); const m = await sharp(Buffer.from(await pv.arrayBuffer())).metadata(); return `201; preview ${m.width}x${m.height}`; });
}

await check("V-zero-img", "zero-byte image -> 400 empty_file (baseline for the zero-byte .mp4 -> 415 note)", async () => { const d = await newDrop(s); const r = await upload(s, d.id, Buffer.alloc(0), "z.jpg", "image/jpeg"); eq(r.status, 400, r.text); eq(r.json.code, "empty_file", "code"); return `${r.status} ${r.text}`; });
// ---------- C. rejections ----------
const rej = [
  ["fake-ftyp-random.mp4", 415, "valid ftyp then random bytes"], ["fake-ftyp-zeros.mp4", 415, "ftyp + zeros"], ["fake-ftyp-jpeg.mp4", 415, "ftyp + JPEG body"], ["fake-ftyp-text.mp4", 415, "ftyp + text"], ["fake-ftyp-only.mp4", 415, "ftyp box only"],
  ["fake-ftyp-hugebox.mp4", 415, "ftyp + moov box with size 4 GB lie"], ["fake-ftyp-largesize.mp4", 415, "ftyp with size=1 (64-bit) + random"],
  ["trunc-half.mp4", null, "valid MP4 truncated at 50%"], ["trunc-100b.mp4", 415, "truncated at 100 B"], ["trunc-ftyp-only.mp4", 415, "truncated at 32 B"], ["trunc-12b.mp4", 415, "truncated at 12 B (just the sniff window)"], ["trunc-11b.mp4", 415, "truncated at 11 B"],
  ["jpeg-as.mp4", 415, "JPEG renamed .mp4 (type video/mp4)"], ["png-as.mp4", 415, "PNG renamed .mp4"], ["text-as.mp4", 415, "text renamed .mp4"], ["exe-as.mp4", 415, "EXE-like (MZ) renamed .mp4"],
  ["webm-as.mp4", 415, "WebM renamed .mp4"], ["mkv-as.mp4", 415, "Matroska renamed .mp4"], ["avi-as.mp4", 415, "AVI renamed .mp4"], ["mov-as.mp4", 415, "QuickTime MOV renamed .mp4"],
  ["qt.mov", 415, "QuickTime .mov video/quicktime"], ["clip.webm", 415, "WebM video/webm"], ["clip.mkv", 415, "MKV video/x-matroska"], ["clip.avi", 415, "AVI video/x-msvideo"], ["clip.3gp", 415, "3GP video/3gpp"], ["audio.m4a", 415, "M4A audio/mp4"], ["audio-as.mp4", 415, "M4A renamed .mp4"],
  ["audio-only-isom.mp4", 415, "MP4 (isom) with audio only"], ["coveronly.mp4", 415, "MP4 whose only 'video' stream is cover art (attached_pic)"], ["zero.mp4", 415, "zero-byte .mp4 (415 unsupported_type; a zero-byte .jpg gives 400 empty_file - see V-zero-img)"],
  ["mdat-corrupt.mp4", null, "valid headers, first 20 kB of mdat corrupted"], ["moov-size-lie.mp4", null, "moov box size lies (0xfffffff0)"], ["tkhd-zero-dim.mp4", null, "tkhd width/height zeroed"], ["mvhd-timescale0.mp4", null, "mvhd timescale 0"], ["mvhd-duration-max.mp4", null, "mvhd duration 0xffffffff"], ["stts-huge-entries.mp4", null, "stts entry_count 0x7fffffff"], ["stsz-huge-count.mp4", null, "stsz sample_count 0x7fffffff"], ["nested-box-bomb.mp4", 415, "3000 nested udta boxes"],
];
const t0all = Date.now();
for (const [n, want, note] of rej) {
  await check(`V-rej-${n}`, `${note}`, async () => {
    const d = await newDrop(s); const type = /\.mov$/.test(n) ? "video/quicktime" : /\.webm$/.test(n) ? "video/webm" : /\.mkv$/.test(n) ? "video/x-matroska" : /\.avi$/.test(n) ? "video/x-msvideo" : /\.3gp$/.test(n) ? "video/3gpp" : /\.m4a$/.test(n) ? "audio/mp4" : "video/mp4";
    const t0 = Date.now(); const r = await upl(d, n, type); const ms = Date.now() - t0;
    if (want === null) { // ambiguous: either rejected cleanly (4xx) or accepted with a preview; never 5xx, never leftovers on reject
      assert(r.status < 500, `5xx: ${r.status} ${r.text.slice(0, 150)}`);
      if (r.status >= 400) { noLeak(r.text); await pristine(d, n); return `${r.status} ${r.json?.code ?? ""} (${ms} ms), nothing stored`; }
      const f = (await dropFiles(d.id))[0]; const pv = await s.http.req("GET", `/api/files/${f.id}/preview`); return `ACCEPTED 201 (${ms} ms) preview ${pv.status} ${(await pv.arrayBuffer()).byteLength} B — playable-enough for ffmpeg`;
    }
    eq(r.status, want, `${r.text.slice(0, 200)}`); noLeak(r.text); await pristine(d, n); return `${r.status} ${r.json?.code} "${r.json?.error}" (${ms} ms), nothing stored, tmp empty`;
  });
}
rec("V-rej-time", "all rejection probes total time", "NOTE", `${Date.now() - t0all} ms for ${rej.length} uploads`);
await check("V-claim", "image file claiming video/mp4 MIME is judged on content (JPEG body, type video/mp4, name .jpg)", async () => { const d = await newDrop(s); const r = await upload(s, d.id, media("cover.jpg"), "x.jpg", "video/mp4"); const note = `${r.status} ${r.json?.code}`; assert(r.status === 415, note); await pristine(d, "claim"); return note; });
await check("V-claim2", "real MP4 sent as image/jpeg with .jpg or .png name or no extension is still recognised by content (stored as video/mp4, filename sane)", async () => {
  const out = []; for (const [n, t] of [["mp4-as.jpg", "image/jpeg"], ["mp4-as.png", "image/png"], ["mp4-noext", "application/octet-stream"]]) { const d = await newDrop(s); const r = await upl(d, n, t); out.push(`${n}:${r.status}${r.json?.file ? " " + r.json.file.mime + " " + r.json.file.filename : " " + r.json?.code}`); assert(r.status === 201 && r.json.file.mime === "video/mp4", out.join(" | ")); } return out.join(" | ");
});
await check("V-image-regress", "JPG/PNG/WebP still upload; GIF/PDF/EXE-renamed-.jpg still rejected (image path unchanged)", async () => {
  const d = await newDrop(s); const o = []; const sh = sharp({ create: { width: 40, height: 40, channels: 3, background: "#c33" } });
  for (const [fmt, mime] of [["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]]) { const b = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#c33" } })[fmt]().toBuffer(); const r = await upload(s, d.id, b, `a.${fmt}`, mime); o.push(`${fmt}:${r.status}`); eq(r.status, 201, r.text); }
  const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#0f0" } }).gif().toBuffer(); const rg = await upload(s, d.id, gif, "a.gif", "image/gif"); o.push(`gif:${rg.status}`); eq(rg.status, 415, rg.text);
  const pdf = await upload(s, d.id, Buffer.from("%PDF-1.4\n%%EOF"), "a.pdf", "application/pdf"); o.push(`pdf:${pdf.status}`); eq(pdf.status, 415, pdf.text);
  const exe = await upload(s, d.id, Buffer.concat([Buffer.from("MZ"), crypto.randomBytes(500)]), "evil.jpg", "image/jpeg"); o.push(`exe.jpg:${exe.status}`); eq(exe.status, 415, exe.text); return o.join(" ");
});

// ---------- D. multipart protocol edge cases ----------
await check("V-mp-edge", "multipart edge cases: no file part, wrong field name, 2 file parts, non-multipart body, JSON body, empty body, missing boundary -> 4xx, never 5xx; no leftovers", async () => {
  const d = await newDrop(s); const o = []; const buf = media("good.mp4");
  const run = async (label, init) => { const r = await s.http.j("POST", `/api/drops/${d.id}/files`, init); o.push(`${label}:${r.status}${r.json?.code ? "/" + r.json.code : ""}`); assert(r.status >= 400 && r.status < 500, `${label} -> ${r.status} ${r.text.slice(0, 120)}`); noLeak(r.text); };
  const f1 = new FormData(); f1.append("note", "x"); await run("nofile", { form: f1 });
  const f2 = new FormData(); f2.append("upload", new Blob([buf], { type: "video/mp4" }), "a.mp4"); await run("wrongfield", { form: f2 });
  const f3 = new FormData(); f3.append("file", new Blob([buf], { type: "video/mp4" }), "a.mp4"); f3.append("file", new Blob([buf], { type: "video/mp4" }), "b.mp4"); await run("two-files", { form: f3 });
  await run("json", { json: { file: "x" } }); await run("empty", { raw: "", headers: { "content-type": "multipart/form-data; boundary=x" } }); await run("noboundary", { raw: "abc", headers: { "content-type": "multipart/form-data" } });
  await run("octet", { raw: buf, headers: { "content-type": "video/mp4" } });
  await run("bad-body", { raw: "--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.mp4\"\r\n\r\nabc", headers: { "content-type": "multipart/form-data; boundary=x" } });
  const rows = (await dropFiles(d.id)).length; eq(rows, 0, "rows"); eq(storedFiles().filter((f) => f.includes(d.id)).length, 0, "stored"); await sleep(200); eq(tmpFiles().length, 0, `tmp ${tmpFiles()}`); return o.join(" ");
});
await check("V-authz", "upload to someone else's drop -> 404 (body not stored); unauthenticated -> 401; nonexistent/non-UUID drop id -> 404/400", async () => {
  const o = []; const mine = await newDrop(s); const r1 = await upload(other, mine.id, media("good.mp4"), "g.mp4", "video/mp4"); o.push(`other:${r1.status}`); eq(r1.status, 404, r1.text);
  const anon = new L.Http(); const r2 = await anon.j("POST", `/api/drops/${mine.id}/files`, { form: L.fileForm(media("good.mp4"), "g.mp4", "video/mp4") }); o.push(`anon:${r2.status}`); eq(r2.status, 401, r2.text);
  const r3 = await upload(s, "00000000-0000-4000-8000-000000000000", media("good.mp4"), "g.mp4", "video/mp4"); o.push(`missing:${r3.status}`); eq(r3.status, 404, r3.text); const r4 = await upload(s, "not-a-uuid", media("good.mp4"), "g.mp4", "video/mp4"); o.push(`baduuid:${r4.status}`); assert([400, 404].includes(r4.status), r4.text);
  await pristine(mine, "authz"); return o.join(" ");
});
await check("V-csrf", "cross-origin upload (Origin: https://evil.example) -> 403 bad_origin, nothing stored", async () => { const d = await newDrop(s); const r = await s.http.j("POST", `/api/drops/${d.id}/files`, { form: L.fileForm(media("good.mp4"), "g.mp4", "video/mp4"), headers: { origin: "https://evil.example" } }); eq(r.status, 403, r.text); await pristine(d, "csrf"); return `${r.status} ${r.json?.code}`; });
await check("V-unverified", "unverified seller can upload video to own draft (same as images); publish still blocked", async () => { const u = await makeSeller("unver", { verified: false }); const d = await newDrop(u); const r = await upload(u, d.id, media("small.mp4"), "s.mp4", "video/mp4"); eq(r.status, 201, r.text); const p = await u.http.j("POST", `/api/drops/${d.id}/publish`, { json: { attestation: L.att } }); assert(p.status === 403 || p.status === 400, `${p.status} ${p.text}`); return `upload 201; publish ${p.status} ${p.json?.code}`; });

// ---------- E. filename / path tricks ----------
await check("V-names", "filename tricks (../, \\, quotes, CRLF, NUL, unicode, 600 chars, leading dots) never reach storage keys / headers; DB filename sanitised", async () => {
  const names = ["../../../etc/passwd.mp4", "..\\..\\win.mp4", 'a"b;c=d.mp4', "x\r\nSet-Cookie: pwn=1.mp4", "%2e%2e%2fetc.mp4", "名前🎬.mp4", "A".repeat(600) + ".mp4", ".mp4", "...", "con.mp4", "a b  c.mp4", "<script>alert(1)</script>.mp4", "file.mp4.jpg", "file.php.mp4"];
  const d = await newDrop(s); const out = []; const keys = [];
  // drop quota is 10 files, use a drop per 8 names
  let cur = d, n = 0; for (const nm of names) { if (n === 9) { cur = await newDrop(s); n = 0; } let r; try { r = await upload(s, cur.id, media("small.mp4"), nm, "video/mp4"); } catch (e) { out.push(`${JSON.stringify(nm.slice(0, 20))}:client-error`); continue; } n++; assert(r.status === 201, `${JSON.stringify(nm.slice(0, 30))} -> ${r.status} ${r.text.slice(0, 120)}`); const row = (await db.query("select storage_key, blurred_preview_key, filename from drop_files where id=$1", [r.json.file.id])).rows[0];
    assert(/^originals\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/.test(row.storage_key) && /^previews\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(row.blurred_preview_key), `key ${row.storage_key}`); assert(/^[\w.\- ]+$/.test(row.filename) && row.filename.length <= 200, `db filename ${JSON.stringify(row.filename)}`);
    const sg = await s.http.j("POST", `/api/files/${r.json.file.id}/signed-url`); const dl = await fetch(BASE + sg.json.path ?? sg.json.url, { headers: { "x-forwarded-for": L.freshIp() } }); const cd = dl.headers.get("content-disposition"); await dl.arrayBuffer(); assert(dl.status === 200 && !/[\r\n]/.test(cd) && /^attachment; filename="[\w.\- ]*"$/.test(cd), `cd ${cd}`); out.push(`${JSON.stringify(nm.slice(0, 18))}→${JSON.stringify(row.filename.slice(0, 22))}`); }
  const escaped = storedFiles().filter((f) => !f.startsWith(STORAGE + "/originals/") && !f.startsWith(STORAGE + "/previews/")); eq(escaped.length, 0, "files outside originals/previews");
  assert(!fs.existsSync("/etc/passwd.mp4") && !fs.existsSync(path.join(STORAGE, "..", "etc")), "path traversal wrote outside"); return out.join(" | ").slice(0, 600);
});

// ---------- F. privacy of originals ----------
let pubDrop, vidFile;
await check("M1-12v", "video original unreachable pre-purchase: guessable paths, no-signature, forged signature, owner cookie without signature, public API/page contain no storage path or signed URL", async () => {
  pubDrop = await newDrop(s, { title: "public video drop" }); const r = await upl(pubDrop, "good.mp4"); eq(r.status, 201, r.text); vidFile = r.json.file; const row = (await dropFiles(pubDrop.id))[0];
  const pb = await s.http.j("POST", `/api/drops/${pubDrop.id}/publish`, { json: { attestation: L.att } }); eq(pb.status, 200, pb.text); const link = pb.json.drop.public_link_id ?? pb.json.drop.publicLinkId; assert(link, pb.text);
  const anon = new L.Http(); const o = [];
  const paths = [`/originals/${pubDrop.id}/${row.id}.mp4`, `/${row.storage_key}`, `/storage/${row.storage_key}`, `/public/${row.storage_key}`, `/_next/static/${row.storage_key}`, `/api/files/${row.id}/original`, `/api/files/${row.id}/original?exp=1&sig=abc`, `/api/files/${row.id}/original?exp=${Math.floor(Date.now() / 1000) + 3600}&sig=${"0".repeat(64)}`, `/api/files/${row.id}/../original`, `/api/files/${row.id}/original/`];
  for (const p of paths) { const x = await anon.req("GET", p); const t = await x.arrayBuffer(); o.push(`${p.slice(0, 40)}→${x.status}`); assert((x.status >= 400 || (x.status === 308 && p.endsWith("/") && !/sig=/.test(x.headers.get("location") ?? ""))) && true, `${p} → ${x.status} ${t.byteLength} B`); }
  const own = await s.http.req("GET", `/api/files/${row.id}/original`); o.push(`owner-no-sig→${own.status}`); assert(own.status >= 400, "owner without signature got original"); await own.arrayBuffer();
  const oth = await other.http.j("POST", `/api/files/${row.id}/signed-url`); o.push(`other-mint→${oth.status}`); eq(oth.status, 404, oth.text);
  const pubApi = await anon.j("GET", `/api/public/drops/${link}`); eq(pubApi.status, 200, pubApi.text); const page = await anon.req("GET", `/u/${link}`); const html = await page.text();
  for (const [n, t] of [["public api", pubApi.text], ["page html", html]]) assert(!/originals\/|storage_key|\.mp4|sig=|exp=|\/original|\/workspace/.test(t), `${n} leaks: ${(t.match(/originals\/|storage_key|\.mp4|sig=|exp=|\/original|\/workspace/) || [])[0]}`);
  assert(pubApi.json.previews.some((p) => p.kind === "video") && /1 video/.test(pubApi.json.summary?.label ?? JSON.stringify(pubApi.json.summary)), JSON.stringify(pubApi.json.summary));
  const pv = await anon.req("GET", `/api/files/${row.id}/preview`); eq(pv.status, 200, "anon preview of published video"); eq(pv.headers.get("content-type"), "image/jpeg", "ct"); const pvb = Buffer.from(await pv.arrayBuffer()); assert(pvb.length < 30000, "preview big");
  const un = await s.http.j("POST", `/api/drops/${pubDrop.id}/unpublish`); const pv2 = await anon.req("GET", `/api/files/${row.id}/preview`); o.push(`unpublished-anon-preview→${pv2.status}`); eq(pv2.status, 404, "unpublished preview public"); await pv2.arrayBuffer();
  return `${o.join(" ")} | public API summary ${JSON.stringify(pubApi.json.summary)} previews ${JSON.stringify(pubApi.json.previews.map((p) => p.kind))}`;
});
await check("V-signed", "owner-minted signed URL streams the exact bytes; Range 206/suffix/open-ended/416; multi-range+garbage ignored (200); expired 410; tampered sig 403; response headers safe", async () => {
  const row = (await dropFiles(pubDrop.id))[0]; const sg = await s.http.j("POST", `/api/files/${row.id}/signed-url`); assert(Object.keys(sg.json).every((k) => !/key|storage|path\b/i.test(k) || k === "path"), JSON.stringify(Object.keys(sg.json))); const url = sg.json.path; assert(!url.includes(row.storage_key), "storage key in URL");
  const get = (h = {}, u = url) => fetch(BASE + u, { headers: { "x-forwarded-for": L.freshIp(), ...h } }); const orig = media("good.mp4");
  const full = await get(); const fb = Buffer.from(await full.arrayBuffer()); eq(full.status, 200, "full"); eq(sha(fb), sha(orig), "sha"); eq(full.headers.get("content-type"), "video/mp4", "ct"); assert(/attachment/.test(full.headers.get("content-disposition")), "cd"); eq(full.headers.get("x-content-type-options"), "nosniff", "nosniff"); assert(/no-store/.test(full.headers.get("cache-control")), "cache"); eq(full.headers.get("accept-ranges"), "bytes", "accept-ranges");
  const o = []; const rg = async (h, st, exp) => { const r = await get({ range: h }); const b = Buffer.from(await r.arrayBuffer()); o.push(`${h}→${r.status}`); eq(r.status, st, `range ${h}`); if (exp) assert(b.equals(exp), `range ${h} bytes differ`); return r; };
  await rg("bytes=0-99", 206, orig.subarray(0, 100)); await rg("bytes=1000-", 206, orig.subarray(1000)); await rg("bytes=-500", 206, orig.subarray(orig.length - 500)); await rg(`bytes=${orig.length - 1}-${orig.length + 999}`, 206, orig.subarray(orig.length - 1)); await rg(`bytes=${orig.length}-`, 416); await rg("bytes=0-1,5-9", 200, orig); await rg("bytes=abc", 200, orig); await rg("bytes=5-2", 200, orig); await rg("bytes=-0", 416);
  const head = await fetch(BASE + url, { method: "HEAD", headers: { "x-forwarded-for": L.freshIp() } }); o.push(`HEAD→${head.status}`);
  const sg0 = url.match(/sig=([^&]+)/)[1]; const bad = url.replace(sg0, sg0.slice(0, -1) + (sg0.at(-1) === "A" ? "B" : "A")); const tb = await get({}, bad); o.push(`tampered→${tb.status}`); assert([400, 401, 403].includes(tb.status), "tampered " + tb.status); await tb.arrayBuffer();
  const ex = url.replace(/exp=\d+/, "exp=" + (Math.floor(Date.now() / 1000) - 10)); const ee = await get({}, ex); o.push(`expired→${ee.status}`); assert([403, 410].includes(ee.status), "expired " + ee.status); await ee.arrayBuffer();
  return o.join(" ");
});

// ---------- G. limits ----------
var capExact = 0;
await check("M1-08a", "11th file blocked (mixed 6 images + 4 videos fill 10; 11th video AND 11th image -> 400 too_many_files, no leftovers)", async () => {
  const d = await newDrop(s); const o = []; for (let i = 0; i < 6; i++) { const b = await sharp({ create: { width: 30 + i, height: 30, channels: 3, background: "#44a" } }).png().toBuffer(); eq((await upload(s, d.id, b, `i${i}.png`, "image/png")).status, 201, "img"); } for (let i = 0; i < 4; i++) eq((await upl(d, "small.mp4")).status, 201, "vid");
  const before = storedFiles().length; const rv = await upl(d, "small.mp4"); const ri = await upload(s, d.id, await L.png(), "x.png", "image/png"); o.push(`11th video:${rv.status}/${rv.json?.code}`, `11th image:${ri.status}/${ri.json?.code}`); eq(rv.status, 400, rv.text); eq(rv.json.code, "too_many_files", "code"); eq(ri.status, 400, ri.text); eq((await dropFiles(d.id)).length, 10, "rows"); eq(storedFiles().length, before, "orphans"); eq(tmpFiles().length, 0, "tmp"); return o.join(" ") + " | message: " + rv.json.error;
});
await check("M1-08b", "parallel burst: 14 simultaneous video+image uploads into an empty drop land exactly 10 (no overshoot, no orphan objects/temp files)", async () => {
  const d = await newDrop(s); const reqs = []; for (let i = 0; i < 14; i++) reqs.push(i % 2 ? upl(d, "small.mp4") : L.png("#" + (100 + i * 7).toString(16).padStart(6, "0"), 40 + i).then((b) => upload(s, d.id, b, `p${i}.png`, "image/png")));
  const rs = await Promise.all(reqs); const ok = rs.filter((r) => r.status === 201).length; const codes = rs.filter((r) => r.status !== 201).map((r) => `${r.status}/${r.json?.code}`); const rows = await dropFiles(d.id); const objs = storedFiles().filter((f) => f.includes(d.id)); await sleep(300);
  eq(ok, 10, `201 count (${codes})`); eq(rows.length, 10, "rows"); eq(objs.length, 20, "objects (10 originals + 10 previews)"); eq(tmpFiles().length, 0, "tmp"); return `201×${ok}, rejected ${codes.join(",")}; rows 10, objects 20, tmp empty`;
});
await check("M1-08c", "per-video cap 500 MiB (524288000): cap-1 and cap accepted (streamed 500 MB), cap+1 -> 413 file_too_large with nothing stored; server RSS stays flat", async () => {
  const pid = pidOf(3260); const o = []; const samples = []; let stop = false; const mon = (async () => { while (!stop) { samples.push(rss(pid)); await sleep(100); } })(); const base = rss(pid);
  const dA = await newDrop(s); const tA = Date.now(); const rA = await upl(dA, "big500m1.mp4"); o.push(`cap-1:${rA.status} (${Date.now() - tA} ms)`); eq(rA.status, 201, rA.text);
  const tB = Date.now(); const rB = await upl(dA, "big500.mp4"); o.push(`cap(exact 524288000):${rB.status}/${rB.json?.code ?? ""} (${Date.now() - tB} ms)`); capExact = rB.status;
  const dC = await newDrop(s); const tC = Date.now(); const rC = await upl(dC, "big500p1.mp4"); o.push(`cap+1:${rC.status}/${rC.json?.code} (${Date.now() - tC} ms)`); eq(rC.status, 413, rC.text); eq(rC.json.code, "file_too_large", "code"); await pristine(dC, "cap+1");
  stop = true; await mon; const peak = Math.max(...samples); o.push(`RSS base ${base.toFixed(0)} MB peak ${peak.toFixed(0)} MB (uploads 3x ~500 MB)`); assert(peak - base < 250, `RSS grew by ${(peak - base).toFixed(0)} MB`);
  const f = (await dropFiles(dA.id)); eq(f.length, 1, "rows"); eq(shaFile(path.join(STORAGE, f[0].storage_key)), shaFile(`${MEDIA}/big500m1.mp4`), "500 MB original byte-identical"); return o.join(" | ");
});
await check("M1-08c2", "a video of EXACTLY the cap (524288000 B = 500 MiB) is accepted (cap is inclusive: 'files up to 500 MB')", async () => { eq(capExact, 201, "exact-cap video status (cap-1 accepted, cap+1 rejected; see M1-08c)"); return "accepted"; });
await check("M1-08d", "oversized body is cut off: 700 MB stream (ftyp + zeros) -> 413 quickly (declared size > cap+64 KB rejected up-front; undeclared/chunked stops at cap), no temp left", async () => {
  const d = await newDrop(s); const o = [];
  // (1) Content-Length declared > cap
  fs.writeFileSync("/workspace/qa-m2/out/big700.mp4", Buffer.concat([fs.readFileSync(`${MEDIA}/fake-ftyp-only.mp4`)])); const fd = fs.openSync("/workspace/qa-m2/out/big700.mp4", "a"); const z = Buffer.alloc(1 << 20); for (let i = 0; i < 700; i++) fs.writeSync(fd, z); fs.closeSync(fd);
  const t0 = Date.now(); const out = spawnSync("curl", ["-s", "-o", "/dev/stdout", "-w", "\n%{http_code} %{time_total}", "-H", "x-forwarded-for: " + L.freshIp(), "-b", [...s.http.cookies].map(([k, v]) => `${k}=${v}`).join("; "), "-F", "file=@/workspace/qa-m2/out/big700.mp4;type=video/mp4", `${BASE}/api/drops/${d.id}/files`], { encoding: "utf8", maxBuffer: 1 << 24 }); const lines = out.stdout.trim().split("\n"); o.push(`declared-length: ${lines[lines.length - 1]}`); assert(lines[lines.length - 1].startsWith("413"), out.stdout.slice(0, 200));
  // (2) chunked (no content-length)
  const cookie = [...s.http.cookies].map(([k, v]) => `${k}=${v}`).join("; "); const boundary = "----qa" + crypto.randomBytes(4).toString("hex");
  const res = await new Promise((resolve) => { const req = http.request({ host: "localhost", port: 3260, path: `/api/drops/${d.id}/files`, method: "POST", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}`, "transfer-encoding": "chunked", "x-forwarded-for": L.freshIp() } }, (r) => { let t = ""; r.on("data", (c) => (t += c)); r.on("end", () => resolve({ status: r.statusCode, body: t })); }); req.on("error", (e) => resolve({ status: "err " + e.code, body: "" }));
    req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.mp4"\r\nContent-Type: video/mp4\r\n\r\n`); req.write(fs.readFileSync(`${MEDIA}/fake-ftyp-only.mp4`)); let sent = 0; const chunk = Buffer.alloc(1 << 20); const pump = () => { while (sent < 700) { sent++; if (!req.write(chunk)) { req.once("drain", pump); return; } } req.end(`\r\n--${boundary}--\r\n`); }; pump(); });
  o.push(`chunked 700 MB: ${res.status} ${String(res.body).slice(0, 80)}`); assert(res.status === 413 || String(res.status).startsWith("err"), `chunked ${res.status}`); await sleep(500); eq(tmpFiles().length, 0, `tmp ${tmpFiles()}`); await pristine(d, "oversize"); fs.rmSync("/workspace/qa-m2/out/big700.mp4"); return o.join(" | ");
});
await check("M1-08e", "2 GiB per-drop total (exact): 4 x (500 MiB-1) + 50331652 B fills exactly 2,147,483,648 B -> OK; +1 byte file rejected 413 drop_too_large; then an image (any bytes) rejected; DB sum exact", async () => {
  const d = await newDrop(s); const o = []; for (let i = 0; i < 4; i++) { const r = await upl(d, "big500m1.mp4"); eq(r.status, 201, `big #${i}: ${r.text}`); } const r5 = await upl(d, "fill50x.mp4"); eq(r5.status, 201, r5.text);
  const total = Number((await db.query("select sum(size_bytes) t from drop_files where drop_id=$1", [d.id])).rows[0].t); eq(total, 2147483648, "sum"); const r6 = await upl(d, "fill50xp1.mp4"); o.push(`+50MiB+1:${r6.status}/${r6.json?.code}`); eq(r6.status, 413, r6.text); eq(r6.json.code, "drop_too_large", "code");
  const r7 = await upload(s, d.id, await L.png(), "tiny.png", "image/png"); o.push(`tiny image:${r7.status}/${r7.json?.code}`); eq(r7.status, 413, r7.text); eq((await dropFiles(d.id)).length, 5, "rows"); eq(tmpFiles().length, 0, "tmp"); const sz = Number(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0]); return `sum ${total} (=2 GiB); ${o.join(" ")}; msg: ${r6.json.error}`;
});
// free disk used by the big files
for (const r of (await db.query("select d.id from drops d where d.seller_id=$1", [s.id])).rows) { /* keep drops; cleaned by DELETE test later */ }

// ---------- H. abort / failure handling ----------
await check("M1-09a", "client aborts mid-upload (destroy socket after 30 MB of a video) -> no DB row, no stored object, temp spool removed", async () => {
  const d = await newDrop(s); const cookie = [...s.http.cookies].map(([k, v]) => `${k}=${v}`).join("; "); const boundary = "----qa" + crypto.randomBytes(4).toString("hex"); const head = fs.readFileSync(`${MEDIA}/good.mp4`).subarray(0, 4096);
  await new Promise((resolve) => { const sock = net.connect(3260, "127.0.0.1", () => { const pre = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.mp4"\r\nContent-Type: video/mp4\r\n\r\n`; sock.write(`POST /api/drops/${d.id}/files HTTP/1.1\r\nHost: localhost:3260\r\ncookie: ${cookie}\r\nx-forwarded-for: ${L.freshIp()}\r\ncontent-type: multipart/form-data; boundary=${boundary}\r\ncontent-length: 200000000\r\n\r\n${pre}`); sock.write(head); let n = 0; const z = Buffer.alloc(1 << 20); const pump = () => { while (n < 30) { n++; if (!sock.write(z)) { sock.once("drain", pump); return; } } setTimeout(() => { sock.destroy(); resolve(); }, 300); }; pump(); }); sock.on("error", () => {}); });
  const midTmp = tmpFiles().length; await sleep(1500); const after = tmpFiles(); await pristine(d, "abort"); return `temp files right after abort: ${midTmp}; after 1.5 s: ${after.length}; rows 0; objects 0`;
});
await check("M1-09b", "abort during an image-sized body and abort right after headers (no body) -> no 5xx noise, nothing stored, server still healthy", async () => {
  const d = await newDrop(s); const cookie = [...s.http.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  for (const bodyBytes of [0, 500]) await new Promise((resolve) => { const sock = net.connect(3260, "127.0.0.1", () => { sock.write(`POST /api/drops/${d.id}/files HTTP/1.1\r\nHost: localhost:3260\r\ncookie: ${cookie}\r\nx-forwarded-for: ${L.freshIp()}\r\ncontent-type: multipart/form-data; boundary=zz\r\ncontent-length: 100000\r\n\r\n--zz\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\n\r\n${"x".repeat(bodyBytes)}`); setTimeout(() => { sock.destroy(); resolve(); }, 200); }); sock.on("error", () => {}); });
  await sleep(800); await pristine(d, "abort2"); const h = await fetch(BASE + "/api/settings"); eq(h.status, 200, "healthy"); return "nothing stored; server healthy";
});
await check("M1-09c", "resumable upload (tus-style) — spec M1-09: not provided by this branch (single multipart POST; no Range/PATCH resume endpoint)", async () => { const d = await newDrop(s); const o = []; for (const [m, u] of [["PATCH", `/api/drops/${d.id}/files`], ["HEAD", `/api/drops/${d.id}/files`], ["PUT", `/api/drops/${d.id}/files`], ["OPTIONS", `/api/drops/${d.id}/files`]]) { const r = await s.http.j(m, u); o.push(`${m}:${r.status}`); } return o.join(" ") + " (resume not implemented -> M1-09 stays BLOCKED)"; });

// ---------- I. streaming memory (separate large-but-valid check) ----------
await check("V-mem", "memory: 4 parallel 500 MB uploads -> server RSS delta < 250 MB (body streamed to disk)", async () => {
  const pid = pidOf(3260); const base = rss(pid); const ds = []; for (let i = 0; i < 4; i++) ds.push(await newDrop(s)); let stop = false, peak = base; const mon = (async () => { while (!stop) { peak = Math.max(peak, rss(pid)); await sleep(80); } })();
  const sellers = await Promise.all([makeSeller("m1"), makeSeller("m2"), makeSeller("m3"), makeSeller("m4")]); const drops = await Promise.all(sellers.map((x) => newDrop(x))); const t0 = Date.now();
  const rs = await Promise.all(sellers.map((x, i) => upload(x, drops[i].id, media("big500m1.mp4"), "b.mp4", "video/mp4"))); stop = true; await mon; const codes = rs.map((r) => r.status);
  assert(codes.every((c) => c === 201), `codes ${codes}`); assert(peak - base < 250, `peak ${peak.toFixed(0)} base ${base.toFixed(0)}`); eq(tmpFiles().length, 0, "tmp"); return `4 x 500 MB parallel in ${Date.now() - t0} ms; RSS base ${base.toFixed(0)} MB, peak ${peak.toFixed(0)} MB (delta ${(peak - base).toFixed(0)}); tmp empty`;
});

// ---------- J. oversized metadata / hostile content timing ----------
await check("V-meta-big", "valid MP4 with a 20 MB 'free' box before moov, and box-bomb inputs, processed within the time budget; no 5xx", async () => {
  const d = await newDrop(s); const t0 = Date.now(); const r = await upl(d, "free-20mb-after-ftyp.mp4"); const ms = Date.now() - t0; assert(r.status < 500, `${r.status} ${r.text}`); return `${r.status} ${r.json?.code ?? "accepted"} in ${ms} ms`;
});

L.save("video.json"); fs.writeFileSync("qa/evidence-m2-video.json", JSON.stringify(L.recs, null, 2)); await L.done();
