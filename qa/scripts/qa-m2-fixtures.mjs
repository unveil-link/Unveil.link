// Generates the malformed/boundary MP4 fixtures from /workspace/qa-m2/media/good.mp4 (ffmpeg-made, see results doc). Run after creating good.mp4.
import fs from "node:fs"; import crypto from "node:crypto"; import { execSync } from "node:child_process";
process.chdir("/workspace/qa-m2/media");
const good = fs.readFileSync("good.mp4");
const free = (n) => { const b = Buffer.alloc(n); b.writeUInt32BE(n, 0); b.write("free", 4, "latin1"); return b; };
const padTo = (src, size, out) => { const pad = size - src.length; if (pad < 8) throw new Error("pad<8"); const fd = fs.openSync(out, "w"); fs.writeSync(fd, src); const hdr = Buffer.alloc(8); hdr.writeUInt32BE(pad, 0); hdr.write("free", 4, "latin1"); fs.writeSync(fd, hdr); let left = pad - 8; const z = Buffer.alloc(1 << 20); while (left > 0) { const n = Math.min(left, z.length); fs.writeSync(fd, z, 0, n); left -= n; } fs.closeSync(fd); };
padTo(good, 524288000, "big500.mp4");               // exactly the cap
fs.copyFileSync("big500.mp4", "big500p1.mp4"); fs.appendFileSync("big500p1.mp4", Buffer.from([0])); // cap + 1 byte
padTo(good, 524288000 - 1, "big500m1.mp4");          // cap - 1
padTo(good, 50331648, "fill50.mp4");                 // 2GiB - 4*500e6 exactly
fs.copyFileSync("fill50.mp4", "fill50p1.mp4"); fs.appendFileSync("fill50p1.mp4", Buffer.from([0]));
// truncated variants
fs.writeFileSync("trunc-half.mp4", good.subarray(0, good.length >> 1));
fs.writeFileSync("trunc-100b.mp4", good.subarray(0, 100));
fs.writeFileSync("trunc-ftyp-only.mp4", good.subarray(0, 32));
fs.writeFileSync("trunc-12b.mp4", good.subarray(0, 12));
fs.writeFileSync("trunc-11b.mp4", good.subarray(0, 11));
fs.writeFileSync("zero.mp4", Buffer.alloc(0));
// fake ftyp
const ftyp = (brand = "isom") => { const b = Buffer.alloc(24); b.writeUInt32BE(24, 0); b.write("ftyp", 4, "latin1"); b.write(brand, 8, "latin1"); b.writeUInt32BE(512, 12); b.write("isomiso2", 16, "latin1"); return b; };
fs.writeFileSync("fake-ftyp-random.mp4", Buffer.concat([ftyp(), crypto.randomBytes(200000)]));
fs.writeFileSync("fake-ftyp-zeros.mp4", Buffer.concat([ftyp(), Buffer.alloc(100000)]));
fs.writeFileSync("fake-ftyp-jpeg.mp4", Buffer.concat([ftyp(), fs.readFileSync("cover.jpg")]));
fs.writeFileSync("fake-ftyp-text.mp4", Buffer.concat([ftyp(), Buffer.from("hello world, not a video\n".repeat(100))]));
fs.writeFileSync("fake-ftyp-only.mp4", ftyp());
fs.writeFileSync("fake-ftyp-hugebox.mp4", Buffer.concat([ftyp(), (() => { const b = Buffer.alloc(16); b.writeUInt32BE(0xffffffff, 0); b.write("moov", 4, "latin1"); return b; })(), Buffer.alloc(5000)]));
fs.writeFileSync("fake-ftyp-largesize.mp4", Buffer.concat([(() => { const b = Buffer.alloc(16); b.writeUInt32BE(1, 0); b.write("ftyp", 4, "latin1"); b.write("isom", 8, "latin1"); return b; })(), crypto.randomBytes(5000)]));
fs.writeFileSync("jpeg-as.mp4", fs.readFileSync("cover.jpg"));
fs.writeFileSync("png-as.mp4", await (await import("sharp")).default({ create: { width: 32, height: 32, channels: 3, background: "#f00" } }).png().toBuffer());
fs.writeFileSync("text-as.mp4", Buffer.from("just text\n"));
fs.writeFileSync("exe-as.mp4", Buffer.concat([Buffer.from("MZ"), crypto.randomBytes(5000)]));
fs.copyFileSync("clip.webm", "webm-as.mp4"); fs.copyFileSync("clip.mkv", "mkv-as.mp4"); fs.copyFileSync("clip.avi", "avi-as.mp4"); fs.copyFileSync("qt.mov", "mov-as.mp4");
// real mp4 under other names/types
fs.copyFileSync("good.mp4", "mp4-as.jpg"); fs.copyFileSync("good.mp4", "mp4-as.png"); fs.copyFileSync("good.mp4", "mp4-noext");
// malformed metadata (patch bytes of a valid file)
const find = (buf, tag, from = 0) => buf.indexOf(Buffer.from(tag, "latin1"), from);
let m = Buffer.from(good); let i = find(m, "mvhd"); // timescale at i+4+4+4+4 (v0: ver/flags 4, ctime 4, mtime 4, timescale 4, duration 4)
m.writeUInt32BE(0, i + 16); fs.writeFileSync("mvhd-timescale0.mp4", m);
m = Buffer.from(good); i = find(m, "mvhd"); m.writeUInt32BE(0xffffffff, i + 20); fs.writeFileSync("mvhd-duration-max.mp4", m);
m = Buffer.from(good); i = find(m, "moov"); m.writeUInt32BE(0xfffffff0, i - 4); fs.writeFileSync("moov-size-lie.mp4", m);
m = Buffer.from(good); i = find(m, "tkhd"); m.writeUInt32BE(0, i + 80); m.writeUInt32BE(0, i + 84); fs.writeFileSync("tkhd-zero-dim.mp4", m);
m = Buffer.from(good); i = find(m, "mdat"); for (let k = i + 8; k < i + 8 + 20000 && k < m.length; k++) m[k] = crypto.randomInt(256); fs.writeFileSync("mdat-corrupt.mp4", m);
m = Buffer.from(good); i = find(m, "stts"); m.writeUInt32BE(0x7fffffff, i + 8); fs.writeFileSync("stts-huge-entries.mp4", m);
m = Buffer.from(good); i = find(m, "stsz"); m.writeUInt32BE(0x7fffffff, i + 12); fs.writeFileSync("stsz-huge-count.mp4", m);
// deeply nested udta bomb appended after moov-less? build: ftyp + moov containing 5000 nested 'udta' boxes
{ let inner = Buffer.alloc(0); for (let d = 0; d < 3000; d++) { const b = Buffer.alloc(8 + inner.length); b.writeUInt32BE(b.length, 0); b.write("udta", 4, "latin1"); inner.copy(b, 8); inner = b; } const moov = Buffer.alloc(8 + inner.length); moov.writeUInt32BE(moov.length, 0); moov.write("moov", 4, "latin1"); inner.copy(moov, 8); fs.writeFileSync("nested-box-bomb.mp4", Buffer.concat([ftyp(), moov])); }
// metadata-heavy: 20 MB udta blob in a valid file
{ const blob = Buffer.alloc(20 * 1024 * 1024, 0x41); const meta = Buffer.alloc(8 + blob.length); meta.writeUInt32BE(meta.length, 0); meta.write("free", 4, "latin1"); blob.copy(meta, 8); fs.writeFileSync("free-20mb-after-ftyp.mp4", Buffer.concat([good.subarray(0, 24 > 0 ? good.readUInt32BE(0) : 0), meta, good.subarray(good.readUInt32BE(0))])); }
console.log("fixtures ok");
