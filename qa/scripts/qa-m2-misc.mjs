// backend/m2-media: ffmpeg failure handling (MODE=nofmpeg on a 2nd instance with FFMPEG_PATH=/nonexistent, MODE=timeout on a 3rd with FFMPEG_TIMEOUT_MS=1),
// and media-geometry probes (MODE=geom on the normal instance). BASE selects the instance.
import * as L from "./qa-m2-lib.mjs"; import fs from "node:fs"; import sharp from "sharp";
const { check, assert, eq, makeSeller, newDrop, upload, media, db, sleep, STORAGE } = L; const MODE = process.env.MODE;
const s = await makeSeller("misc"); const upl = async (n, type = "video/mp4") => { const d = await newDrop(s); const r = await upload(s, d.id, media(n), n, type); return { d, r }; };
const clean = async (d, label) => { await sleep(150); eq((await L.dropFiles(d.id)).length, 0, label + " rows"); eq(L.storedFiles().filter((f) => f.includes(d.id)).length, 0, label + " objects"); eq(L.tmpFiles().length, 0, label + " tmp " + L.tmpFiles()); };
if (MODE === "nofmpeg") {
  await check("V-ffmpeg-missing", "ffmpeg/ffprobe missing (FFMPEG_PATH=/nonexistent): valid MP4 -> 503 video_unavailable, generic message (no binary path / spawn error), nothing stored, no temp left; instance stays healthy", async () => {
    const { d, r } = await upl("good.mp4"); eq(r.status, 503, r.text); eq(r.json.code, "video_unavailable", "code"); assert(!/nonexistent|spawn|ENOENT|\/workspace|ffmpeg|ffprobe/i.test(r.text), "leak: " + r.text); await clean(d, "503"); const h = await s.http.j("GET", "/api/settings"); eq(h.status, 200, "settings"); return `${r.status} ${r.text}`;
  });
  await check("V-ffmpeg-missing2", "same instance: fake MP4 still rejected 415 before ffmpeg; non-video types 415; images (sharp, no ffmpeg) still upload; sniff-level checks unaffected", async () => {
    const a = await upl("fake-ftyp-random.mp4"); const b = await upl("clip.webm", "video/webm"); const d = await newDrop(s); const png = await upload(s, d.id, await L.png(), "a.png", "image/png"); eq(png.status, 201, png.text); const o = [`fake-ftyp→${a.r.status}/${a.r.json?.code}`, `webm→${b.r.status}/${b.r.json?.code}`, `png→${png.status}`]; assert(a.r.status === 415 || a.r.status === 503, o.join(" ")); eq(b.r.status, 415, "webm"); await clean(b.d, "webm"); return o.join(" ");
  });
  await check("V-ffmpeg-missing3", "ffmpeg missing: no repeated expensive spawn per request (availability cached) and 10 parallel uploads all 503, no leftovers", async () => {
    const ds = await Promise.all([...Array(10)].map(() => newDrop(s))); const rs = await Promise.all(ds.map((d) => upload(s, d.id, media("small.mp4"), "s.mp4", "video/mp4"))); assert(rs.every((r) => r.status === 503), rs.map((r) => r.status).join()); eq(L.tmpFiles().length, 0, "tmp"); return "10 x 503";
  });
}
if (MODE === "timeout") { // instance with FFMPEG_TIMEOUT_MS=150
  await check("V-ffmpeg-timeout", "ffmpeg/ffprobe wall-clock timeout (FFMPEG_TIMEOUT_MS=150): a heavy video (8192x8192) -> clean JSON 4xx (invalid_video 'could not be analysed in time'), no hang, nothing stored, temp removed, no lingering ffmpeg procs; small video and images unaffected", async () => {
    const t0 = Date.now(); const { d, r } = await upl("big8k.mp4"); const ms = Date.now() - t0; assert(r.status >= 400 && r.status < 500 && r.json?.code, `unexpected ${r.status} ${r.text}`); assert(!/\/workspace|spawn|ENOENT|ffprobe|ffmpeg/i.test(r.text), "leak: " + r.text); await clean(d, "timeout"); const ok = await upl("small.mp4"); eq(ok.r.status, 201, ok.r.text); const dd = await newDrop(s); const png = await upload(s, dd.id, await L.png(), "a.png", "image/png"); eq(png.status, 201, "image"); await sleep(500);
    const ps = (await import("node:child_process")).execSync("pgrep -x 'ffmpeg|ffprobe' | wc -l").toString().trim(); return `big8k → ${r.status} ${r.text} in ${ms} ms; small.mp4 → 201; lingering ffmpeg/ffprobe procs: ${ps}`;
  });
}
if (MODE === "recover") { // instance with FFMPEG_PATH/FFPROBE_PATH pointing at /workspace/qa-m2/bin/{ffmpeg,ffprobe} (initially absent)
  await check("V-ffmpeg-recover", "ffmpeg installed AFTER the server started: uploads recover without restart (availability not cached forever)", async () => {
    const a = await upl("good.mp4"); eq(a.r.status, 503, "before install"); for (const n of ["ffmpeg", "ffprobe"]) fs.symlinkSync(`/usr/bin/${n}`, `/workspace/qa-m2/bin/${n}`); const b = await upl("good.mp4");
    if (b.r.status !== 201) { fs.rmSync("/workspace/qa-m2/bin", { recursive: true, force: true }); throw new Error(`still ${b.r.status} ${b.r.json?.code} after ffmpeg became available (negative availability result cached for the process lifetime; restart required)`); } return "recovered";
  });
}
if (MODE === "geom") {
  for (const [n, want, note] of [["huge110mp.mp4", "?", "11000x10000 (110 MP, > 100 MP limit)"], ["big8k.mp4", "?", "8192x8192 (67 MP)"], ["tiny16.mp4", "?", "16x16"], ["long10h.mp4", "?", "36000 s (10 h) duration"], ["bigmeta.mp4", "?", "60 KB title metadata"]]) {
    await check(`V-geom-${n}`, note, async () => { const t0 = Date.now(); const { d, r } = await upl(n); const ms = Date.now() - t0; assert(r.status < 500, `5xx ${r.status} ${r.text}`); let extra = ""; if (r.status === 201) { const f = (await L.dropFiles(d.id))[0]; const pv = await s.http.req("GET", `/api/files/${f.id}/preview`); const m = await sharp(Buffer.from(await pv.arrayBuffer())).metadata(); extra = ` preview ${m.width}x${m.height} dur=${r.json.file.durationSec}`; } else await clean(d, n); return `${r.status} ${r.json?.code ?? ""} in ${ms} ms${extra} ${r.status >= 400 ? r.json?.error : ""}`; });
  }
  await check("V-orient", "rotated (rot90) video preview orientation = displayed orientation (portrait), blurred", async () => {
    const { d, r } = await upl("rot90.mp4"); eq(r.status, 201, r.text); const f = (await L.dropFiles(d.id))[0]; const pv = await s.http.req("GET", `/api/files/${f.id}/preview`); const m = await sharp(Buffer.from(await pv.arrayBuffer())).metadata(); const probe = (await import("node:child_process")).execSync(`ffprobe -v error -show_entries stream=width,height:stream_side_data=rotation -of compact ${L.MEDIA}/rot90.mp4`).toString().replace(/\n/g, " "); return `preview ${m.width}x${m.height}; source ${probe}`;
  });
}
L.save(`misc-${MODE}.json`); fs.writeFileSync(`qa/evidence-m2-misc-${MODE}.json`, JSON.stringify(L.recs, null, 2)); await L.done();
