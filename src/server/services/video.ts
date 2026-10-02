import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { queryOne } from "../db";
import { HttpError } from "../errors";
import { storage } from "../storage";
import { getOwnedDrop } from "./drops";
import { assertDropQuota, insertFileLocked, makeBlurredPreview, safeFilename } from "./images";
import { getSettings } from "./settings";

/** The ONLY video type accepted. (No QuickTime/3GP/M4A/HEIC even though they share the ISO-BMFF container.) */
export const VIDEO_MIME = "video/mp4";
export const ALLOWED_VIDEO_MIMES = [VIDEO_MIME] as const;

/** ftyp major brands that mean "MP4 video file" (ISO/IEC 14496-12/14). */
const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9", "mp41", "mp42", "avc1", "dash", "msdh"]);

/** Bytes we need to see to decide "this is an MP4" (box size, 'ftyp', major brand). */
export const SNIFF_BYTES = 12;

/**
 * Magic-byte check: the file must START with an ISO-BMFF `ftyp` box whose major brand is an MP4 video brand.
 * Pure + unit-tested. This is only the cheap first gate (it decides the streaming size cap); ffprobe is the authoritative one.
 */
export function isMp4Header(head: Uint8Array | Buffer): boolean {
  if (head.length < SNIFF_BYTES) return false;
  const b = Buffer.from(head.buffer, head.byteOffset, head.length);
  const size = b.readUInt32BE(0);
  if (b.toString("latin1", 4, 8) !== "ftyp") return false;
  if (size !== 1 && (size < 16 || size > 4096)) return false; // 1 = 64-bit largesize; a real ftyp box is tiny
  return MP4_BRANDS.has(b.toString("latin1", 8, 12));
}

// ---- ffmpeg / ffprobe ---------------------------------------------------------------------------------------------------------------

const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";
const ffprobeBin = () => process.env.FFPROBE_PATH || "ffprobe";
const TIMEOUT_MS = () => (Number(process.env.FFMPEG_TIMEOUT_MS) > 0 ? Number(process.env.FFMPEG_TIMEOUT_MS) : 60_000);

interface RunResult { code: number | null; stdout: Buffer; stderr: string; timedOut: boolean; spawnError?: string }

function run(bin: string, args: string[], maxStdout = 64 * 1024 * 1024): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let outLen = 0, err = "", timedOut = false, settled = false;
    const finish = (r: Omit<RunResult, "stdout" | "stderr" | "timedOut"> & Partial<RunResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(out), stderr: err, timedOut, ...r });
    };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, TIMEOUT_MS());
    child.stdout.on("data", (d: Buffer) => {
      outLen += d.length;
      if (outLen > maxStdout) { child.kill("SIGKILL"); return; }
      out.push(d);
    });
    child.stderr.on("data", (d: Buffer) => { if (err.length < 8192) err += d.toString("utf8"); });
    child.on("error", (e) => finish({ code: null, spawnError: (e as NodeJS.ErrnoException).code ?? e.message }));
    child.on("close", (code) => finish({ code }));
  });
}

const availability = new Map<string, Promise<boolean>>();
/** True when both ffmpeg and ffprobe run. Cached per binary path (reset with resetFfmpegCache in tests). */
export function ffmpegAvailable(): Promise<boolean> {
  const key = `${ffmpegBin()}\n${ffprobeBin()}`;
  let p = availability.get(key);
  if (!p) {
    p = Promise.all([run(ffmpegBin(), ["-version"]), run(ffprobeBin(), ["-version"])]).then(
      ([a, b]) => a.code === 0 && b.code === 0,
    );
    availability.set(key, p);
  }
  return p;
}
export const resetFfmpegCache = () => availability.clear();

export async function requireFfmpeg(): Promise<void> {
  if (!(await ffmpegAvailable())) {
    console.error("video upload refused: ffmpeg/ffprobe not found (install ffmpeg or set FFMPEG_PATH / FFPROBE_PATH)");
    throw new HttpError(503, "Video uploads are temporarily unavailable on this server (video tooling missing)", "video_unavailable");
  }
}

export interface VideoInfo { durationSec: number; width: number; height: number }
const MAX_PIXELS = 100_000_000;

/** Pure parser/validator for `ffprobe -print_format json -show_format -show_streams` output (unit-tested). */
export function validateProbe(json: unknown): VideoInfo {
  const bad = () => new HttpError(415, "Not a valid MP4 video", "invalid_video");
  const j = json as { format?: { format_name?: string; duration?: string }; streams?: Array<Record<string, unknown>> };
  const names = String(j?.format?.format_name ?? "").split(",");
  if (!names.includes("mp4")) throw bad(); // the mov demuxer reports "mov,mp4,m4a,3gp,3g2,mj2" for the whole family
  const v = (j.streams ?? []).find(
    (s) => s.codec_type === "video" && !(s.disposition as { attached_pic?: number } | undefined)?.attached_pic,
  );
  if (!v) throw bad();
  const width = Number(v.width), height = Number(v.height);
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS) throw bad();
  const durationSec = Number(j.format?.duration ?? v.duration ?? 0);
  return { durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0, width, height };
}

// `-f mov` pins the demuxer: an attacker cannot make ffmpeg treat the upload as a playlist/concat/other format (SSRF / local file reads),
// and `-protocol_whitelist file` blocks any network or other protocol access from inside the container.
const INPUT_ARGS = ["-nostdin", "-protocol_whitelist", "file", "-f", "mov"];

export async function probeVideo(filePath: string): Promise<VideoInfo> {
  const r = await run(ffprobeBin(), [
    "-v", "error", "-protocol_whitelist", "file", "-f", "mov", "-print_format", "json", "-show_format", "-show_streams", "-i", filePath,
  ], 4 * 1024 * 1024);
  if (r.spawnError) throw new HttpError(503, "Video uploads are temporarily unavailable on this server (video tooling missing)", "video_unavailable");
  if (r.timedOut) throw new HttpError(415, "Video could not be analysed in time", "invalid_video");
  if (r.code !== 0) throw new HttpError(415, "Not a valid MP4 video", "invalid_video");
  let json: unknown;
  try { json = JSON.parse(r.stdout.toString("utf8")); } catch { throw new HttpError(415, "Not a valid MP4 video", "invalid_video"); }
  return validateProbe(json);
}

/** One decoded frame (PNG, scaled to <=1280px wide, auto-rotated by ffmpeg) at ~1 s in (or the middle of a short clip). */
export async function extractFrame(filePath: string, durationSec: number): Promise<Buffer> {
  const at = durationSec > 2 ? 1 : durationSec / 2;
  for (const t of [at, 0]) {
    const r = await run(ffmpegBin(), [
      "-v", "error", ...INPUT_ARGS, "-ss", t.toFixed(3), "-i", filePath,
      "-frames:v", "1", "-an", "-sn", "-vf", "scale='min(1280,iw)':-2", "-f", "image2pipe", "-vcodec", "png", "pipe:1",
    ]);
    if (r.spawnError) throw new HttpError(503, "Video uploads are temporarily unavailable on this server (video tooling missing)", "video_unavailable");
    if (r.code === 0 && r.stdout.length > 0) return r.stdout;
  }
  throw new HttpError(415, "Could not read a frame from this video", "invalid_video");
}

/** Blurred preview for a video: frame -> the SAME blur/downscale/metadata-strip pipeline as images (makeBlurredPreview). */
export async function makeVideoPreview(filePath: string, durationSec: number): Promise<Buffer> {
  const frame = await extractFrame(filePath, durationSec);
  try {
    return await makeBlurredPreview(frame);
  } catch {
    throw new HttpError(415, "Could not process video", "invalid_video");
  }
}

// ---- service --------------------------------------------------------------------------------------------------------------------------

/**
 * Adds an already-received (temp file on disk, never buffered in memory) MP4 to a drop. Same ownership, quota (atomic, row-locked)
 * and storage-cleanup rules as images; the original goes to private storage via the streaming adapter API.
 */
export async function addVideoToDrop(
  sellerId: string,
  dropId: string,
  file: { name: string; path: string; size: number; declaredMime: string },
) {
  const drop = await getOwnedDrop(sellerId, dropId);
  const s = await getSettings();
  if (file.size === 0) throw new HttpError(400, "Empty file", "empty_file");
  if (file.size > s.max_video_size_bytes) {
    throw new HttpError(413, `File exceeds limit of ${s.max_video_size_bytes} bytes`, "file_too_large");
  }
  await requireFfmpeg();

  // Never trust the client MIME/extension: re-check the magic bytes on what actually landed on disk, then ffprobe it.
  const fh = await fs.open(file.path, "r");
  let head: Buffer;
  try {
    head = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fh.read(head, 0, SNIFF_BYTES, 0);
    head = head.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
  if (!isMp4Header(head)) throw new HttpError(415, "Only MP4 videos are allowed", "unsupported_type");

  const pre = await queryOne<{ n: number; total: number }>(
    "SELECT count(*)::int AS n, COALESCE(sum(size_bytes),0)::float8 AS total FROM drop_files WHERE drop_id=$1",
    [drop.id],
  );
  assertDropQuota({ count: pre?.n ?? 0, totalBytes: pre?.total ?? 0 }, file.size, s);

  const info = await probeVideo(file.path);
  const preview = await makeVideoPreview(file.path, info.durationSec);

  const id = crypto.randomUUID();
  const storageKey = `originals/${drop.id}/${id}.mp4`;
  const previewKey = `previews/${drop.id}/${id}.jpg`;
  const st = storage();
  try {
    await st.putFile(storageKey, file.path, VIDEO_MIME);
    await st.put(previewKey, preview, "image/jpeg");
    const safeName = safeFilename(file.name, "mp4");
    await insertFileLocked({ id, dropId: drop.id, storageKey, previewKey, filename: safeName, mime: VIDEO_MIME, sizeBytes: file.size });
    return { id, filename: safeName, mime: VIDEO_MIME, sizeBytes: file.size, durationSec: info.durationSec };
  } catch (e) {
    await st.delete(storageKey).catch(() => {});
    await st.delete(previewKey).catch(() => {});
    throw e;
  }
}
