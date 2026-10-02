import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unveil-video-test-"));
beforeAll(() => {
  process.env.DATABASE_URL = "postgres://unused/unused";
  process.env.SIGNED_URL_SECRET = "unit-test-secret-unit-test-secret-1234";
  process.env.APP_URL = "http://localhost:3000";
  process.env.UPLOAD_TMP_DIR = path.join(tmp, "uploads");
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

function ftyp(brand: string, size = 24): Buffer {
  const b = Buffer.alloc(Math.max(size, 16));
  b.writeUInt32BE(size, 0);
  b.write("ftyp", 4, "latin1");
  b.write(brand, 8, "latin1");
  return b;
}

describe("MP4 magic bytes (isMp4Header)", async () => {
  const { isMp4Header } = await import("../src/server/services/video");
  it("accepts ISO-BMFF ftyp boxes with MP4 video brands", () => {
    for (const brand of ["isom", "mp42", "mp41", "avc1", "iso2", "dash"]) expect(isMp4Header(ftyp(brand)), brand).toBe(true);
  });
  it("rejects QuickTime / HEIC / 3GP / M4A brands (same container, not MP4 video)", () => {
    for (const brand of ["qt  ", "heic", "3gp4", "M4A ", "M4V ", "avif"]) expect(isMp4Header(ftyp(brand)), brand).toBe(false);
  });
  it("rejects images, text, truncated and absurd headers", () => {
    expect(isMp4Header(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]))).toBe(false);
    expect(isMp4Header(Buffer.from("this is just text, named .mp4"))).toBe(false);
    expect(isMp4Header(ftyp("isom").subarray(0, 11))).toBe(false);
    expect(isMp4Header(Buffer.alloc(64))).toBe(false);
    const huge = ftyp("isom"); huge.writeUInt32BE(0x7fffffff, 0);
    expect(isMp4Header(huge)).toBe(false);
    const tiny = ftyp("isom"); tiny.writeUInt32BE(8, 0);
    expect(isMp4Header(tiny)).toBe(false);
  });
});

describe("ffprobe validation (validateProbe)", async () => {
  const { validateProbe } = await import("../src/server/services/video");
  const good = { format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.5" }, streams: [{ codec_type: "audio" }, { codec_type: "video", width: 640, height: 360 }] };
  it("accepts a normal MP4 and reports duration + size", () => {
    expect(validateProbe(good)).toEqual({ durationSec: 3.5, width: 640, height: 360 });
  });
  it("rejects non-mp4 demuxers, audio-only, cover-art-only, zero/huge dimensions", () => {
    expect(() => validateProbe({ ...good, format: { format_name: "matroska,webm" } })).toThrow(/valid MP4/);
    expect(() => validateProbe({ ...good, streams: [{ codec_type: "audio" }] })).toThrow(/valid MP4/);
    expect(() => validateProbe({ ...good, streams: [{ codec_type: "video", width: 100, height: 100, disposition: { attached_pic: 1 } }] })).toThrow(/valid MP4/);
    expect(() => validateProbe({ ...good, streams: [{ codec_type: "video", width: 0, height: 10 }] })).toThrow(/valid MP4/);
    expect(() => validateProbe({ ...good, streams: [{ codec_type: "video", width: 20000, height: 20000 }] })).toThrow(/valid MP4/);
    expect(() => validateProbe(null)).toThrow();
  });
});

describe("Range parsing", async () => {
  const { parseRange } = await import("../src/server/services/range");
  it("handles the single-range forms", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=10-5000", 1000)).toEqual({ start: 10, end: 999 });
  });
  it("416 when unsatisfiable, ignores garbage and multi-range", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1", 0)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1,5-9", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
    expect(parseRange("bytes=9-3", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
  });
});

async function post(parts: { name: string; type: string; data: Buffer | Uint8Array }[], extra?: Record<string, string>): Promise<Request> {
  const fd = new FormData();
  for (const p of parts) fd.append("file", new Blob([new Uint8Array(p.data)], { type: p.type }), p.name);
  for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
  // round-trip through Request so the body is a real multipart stream with a boundary
  const r = new Request("http://localhost/x", { method: "POST", body: fd });
  return new Request("http://localhost/x", { method: "POST", body: r.body, headers: { "content-type": r.headers.get("content-type")! }, duplex: "half" } as RequestInit);
}

describe("receiveUpload (streaming multipart)", async () => {
  const { receiveUpload, uploadTmpDir } = await import("../src/server/upload");
  const limits = { maxImageBytes: 1000, maxVideoBytes: 5000 };
  const mp4Like = (n: number) => Buffer.concat([ftyp("isom"), Buffer.alloc(n - 24, 7)]);

  it("MP4 bytes go to a 0600 temp file (not memory); cleanup removes it", async () => {
    const data = mp4Like(4000);
    const u = await receiveUpload(await post([{ name: "a.mp4", type: "video/mp4", data }]), limits);
    expect(u.kind).toBe("video");
    if (u.kind !== "video") return;
    expect(u.size).toBe(4000);
    expect(fs.readFileSync(u.path).equals(data)).toBe(true);
    expect(fs.statSync(u.path).mode & 0o777).toBe(0o600);
    expect(u.path.startsWith(uploadTmpDir())).toBe(true);
    await u.cleanup();
    expect(fs.existsSync(u.path)).toBe(false);
  });
  it("a multi-MB MP4-like body is spooled completely (not truncated) and the request only resolves once the temp file is flushed", async () => {
    const big = Buffer.concat([ftyp("isom"), Buffer.alloc(8 * 1024 * 1024, 9)]);
    for (let i = 0; i < 5; i++) {
      const u = await receiveUpload(await post([{ name: "big.mp4", type: "video/mp4", data: big }]), { maxImageBytes: 1000, maxVideoBytes: 20 * 1024 * 1024 });
      expect(u.kind).toBe("video");
      if (u.kind === "video") { expect(u.size).toBe(big.length); expect(fs.statSync(u.path).size).toBe(big.length); await u.cleanup(); }
    }
  });
  it("video over the VIDEO cap -> 413 and no temp file left", async () => {
    await expect(receiveUpload(await post([{ name: "a.mp4", type: "video/mp4", data: mp4Like(6000) }]), limits)).rejects.toMatchObject({ status: 413, code: "file_too_large" });
    expect(fs.existsSync(uploadTmpDir()) ? fs.readdirSync(uploadTmpDir()) : []).toEqual([]);
  });
  it("non-video over the IMAGE cap -> 413 (video cap does not apply to images)", async () => {
    await expect(receiveUpload(await post([{ name: "a.jpg", type: "image/jpeg", data: Buffer.alloc(2000, 1) }]), limits)).rejects.toMatchObject({ status: 413 });
  });
  it("image-sized bytes stay in memory on the image path", async () => {
    const u = await receiveUpload(await post([{ name: "a.png", type: "image/png", data: Buffer.alloc(500, 2) }]), limits);
    expect(u.kind).toBe("image");
    if (u.kind === "image") expect(u.data.length).toBe(500);
  });
  it("spoofed MP4: video MIME or .mp4 name with non-MP4 bytes -> 415", async () => {
    await expect(receiveUpload(await post([{ name: "a.mp4", type: "video/mp4", data: Buffer.from("MZ not a video at all") }]), limits)).rejects.toMatchObject({ status: 415, code: "unsupported_type" });
    await expect(receiveUpload(await post([{ name: "evil.mp4", type: "image/jpeg", data: Buffer.alloc(100, 0xff) }]), limits)).rejects.toMatchObject({ status: 415 });
    await expect(receiveUpload(await post([{ name: "a.jpg", type: "video/mp4", data: Buffer.alloc(100, 1) }]), limits)).rejects.toMatchObject({ status: 415 });
  });
  it("tiny file shorter than the sniff window and claiming video -> 415; empty non-video -> image path (rejected later)", async () => {
    await expect(receiveUpload(await post([{ name: "a.mp4", type: "video/mp4", data: Buffer.from("abc") }]), limits)).rejects.toMatchObject({ status: 415 });
  });
  it("missing file / wrong field / not multipart / second file -> 400", async () => {
    await expect(receiveUpload(await post([], { other: "x" }), limits)).rejects.toMatchObject({ status: 400 });
    const notMp = new Request("http://localhost/x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    await expect(receiveUpload(notMp, limits)).rejects.toMatchObject({ status: 400, code: "bad_form" });
    await expect(receiveUpload(await post([{ name: "a.png", type: "image/png", data: Buffer.alloc(10) }, { name: "b.png", type: "image/png", data: Buffer.alloc(10) }]), limits)).rejects.toMatchObject({ status: 400 });
  });
});

describe.skipIf(!hasFfmpeg)("ffmpeg pipeline (real MP4)", async () => {
  const v = await import("../src/server/services/video");
  const mp4 = path.join(tmp, "t.mp4");
  beforeAll(() => {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=640x360:rate=24", "-f", "lavfi", "-i", "sine=duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-metadata", "title=SECRET-TITLE", "-metadata", "comment=gps+41.0-71.0", "-shortest", "-movflags", "+faststart", mp4]);
  });
  it("ffmpegAvailable + header + probe of a generated MP4", async () => {
    expect(await v.ffmpegAvailable()).toBe(true);
    expect(v.isMp4Header(fs.readFileSync(mp4).subarray(0, 12))).toBe(true);
    const info = await v.probeVideo(mp4);
    expect(info.width).toBe(640); expect(info.height).toBe(360); expect(info.durationSec).toBeGreaterThan(2.5);
  });
  it("preview: <=320px blurred JPEG, no metadata, and far less detailed than the raw frame", async () => {
    const info = await v.probeVideo(mp4);
    const preview = await v.makeVideoPreview(mp4, info.durationSec);
    const meta = await sharp(preview).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(320);
    expect(meta.exif).toBeUndefined(); expect(meta.icc).toBeUndefined(); expect(meta.xmp).toBeUndefined();
    expect(preview.includes(Buffer.from("SECRET-TITLE"))).toBe(false);
    const frame = await v.extractFrame(mp4, info.durationSec);
    // high-pass energy = mean |img - gaussianBlur(img, 1.5)| at a common 320x180: how much fine detail is left.
    const hp = async (b: Buffer) => {
      const base = await sharp(b).resize(320, 180, { fit: "fill" }).greyscale().raw().toBuffer();
      const soft = await sharp(base, { raw: { width: 320, height: 180, channels: 1 } }).blur(1.5).toColourspace("b-w").raw().toBuffer();
      let s = 0; for (let i = 0; i < base.length; i++) s += Math.abs(base[i] - soft[i]);
      return s / base.length;
    };
    const [hPrev, hFrame] = [await hp(preview), await hp(frame)];
    expect(hPrev).toBeLessThan(hFrame * 0.25);
    // and the pixels themselves differ substantially from the raw frame
    const rs = async (b: Buffer) => sharp(b).resize(64, 36, { fit: "fill" }).greyscale().raw().toBuffer();
    const [pa, fa] = [await rs(preview), await rs(frame)];
    let d = 0; for (let i = 0; i < pa.length; i++) d += Math.abs(pa[i] - fa[i]);
    expect(d / pa.length).toBeGreaterThan(5);
  });
  it("rejects a file with an MP4 header but garbage body (ffprobe) and a truncated MP4", async () => {
    const junk = path.join(tmp, "junk.mp4");
    fs.writeFileSync(junk, Buffer.concat([ftyp("isom"), Buffer.alloc(5000, 0x41)]));
    await expect(v.probeVideo(junk)).rejects.toMatchObject({ status: 415, code: "invalid_video" });
    const trunc = path.join(tmp, "trunc.mp4");
    fs.writeFileSync(trunc, fs.readFileSync(mp4).subarray(0, 400));
    await expect(v.probeVideo(trunc).then((i) => v.makeVideoPreview(trunc, i.durationSec))).rejects.toMatchObject({ status: 415 });
  });
  it("ffmpeg missing => clear 503 video_unavailable (no crash)", async () => {
    const old = { f: process.env.FFMPEG_PATH, p: process.env.FFPROBE_PATH };
    process.env.FFMPEG_PATH = "/nonexistent/ffmpeg"; process.env.FFPROBE_PATH = "/nonexistent/ffprobe";
    v.resetFfmpegCache();
    try {
      expect(await v.ffmpegAvailable()).toBe(false);
      await expect(v.requireFfmpeg()).rejects.toMatchObject({ status: 503, code: "video_unavailable" });
      await expect(v.probeVideo(mp4)).rejects.toMatchObject({ status: 503, code: "video_unavailable" });
    } finally {
      if (old.f === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = old.f;
      if (old.p === undefined) delete process.env.FFPROBE_PATH; else process.env.FFPROBE_PATH = old.p;
      v.resetFfmpegCache();
    }
  });
});
