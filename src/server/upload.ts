import busboy from "busboy";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { HttpError } from "./errors";
import { isMp4Header, SNIFF_BYTES } from "./services/video";

export type ReceivedUpload =
  | { kind: "image"; name: string; declaredMime: string; data: Buffer; cleanup: () => Promise<void> }
  | { kind: "video"; name: string; declaredMime: string; path: string; size: number; cleanup: () => Promise<void> };

export const uploadTmpDir = () => process.env.UPLOAD_TMP_DIR || path.join(os.tmpdir(), "unveil-uploads");

/**
 * Streams a multipart/form-data request (single `file` field) WITHOUT buffering the whole body:
 *  - the first bytes decide the path: an MP4 `ftyp` header -> spooled to a 0600 temp file on disk (cap `maxVideoBytes`);
 *    anything else -> collected in memory (cap `maxImageBytes`, the existing image path, validated by sharp later).
 *  - a file that CLAIMS to be a video (client MIME video/* or .mp4/.mov... extension) but lacks the MP4 magic bytes is rejected here
 *    (415 unsupported_type), so it never reaches an image decoder and the client gets a precise error.
 * The caller MUST call `cleanup()` (removes the temp file) in a finally block.
 */
export async function receiveUpload(
  req: Request,
  limits: { maxImageBytes: number; maxVideoBytes: number },
): Promise<ReceivedUpload> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !req.body) {
    throw new HttpError(400, "Expected multipart/form-data", "bad_form");
  }
  const hardCap = Math.max(limits.maxImageBytes, limits.maxVideoBytes);
  let bb: busboy.Busboy;
  try {
    bb = busboy({
      headers: { "content-type": contentType },
      defParamCharset: "utf8",
      limits: { files: 1, fields: 8, fieldSize: 16 * 1024, parts: 12, fileSize: hardCap },
    });
  } catch {
    throw new HttpError(400, "Expected multipart/form-data", "bad_form");
  }

  const tmpPath = path.join(uploadTmpDir(), `${crypto.randomUUID()}.part`);
  let tmpCreated = false;
  const cleanup = async () => { if (tmpCreated) await fsp.rm(tmpPath, { force: true }).catch(() => {}); };

  const body = Readable.fromWeb(req.body as import("node:stream/web").ReadableStream<Uint8Array>);

  try {
    return await new Promise<ReceivedUpload>((resolve, reject) => {
      let settled = false;
      let gotFile = false;
      let result: ReceivedUpload | null = null;
      let fileDone: Promise<void> | null = null;
      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        // Stop parsing and discard the rest of the body (don't destroy the socket: the client must still receive our 4xx).
        body.unpipe(bb);
        body.resume();
        reject(e);
      };
      // Hold the result until the WHOLE multipart body parsed fine (bb 'close'), so a 2nd file / malformed tail is still rejected.
      const done = (u: ReceivedUpload) => { result = u; };

      bb.on("filesLimit", () => fail(new HttpError(400, "Only one file per request", "too_many_parts")));
      bb.on("partsLimit", () => fail(new HttpError(400, "Too many form parts", "bad_form")));
      bb.on("error", () => fail(new HttpError(400, "Malformed multipart body", "bad_form")));

      bb.on("file", (field, stream, info) => {
        if (field !== "file") { stream.resume(); return; }
        gotFile = true;
        const name = info.filename ?? "upload";
        const declaredMime = info.mimeType ?? "";
        const claimsVideo = /^video\//i.test(declaredMime) || /\.(mp4|m4v|mov|3gp|webm|mkv|avi)$/i.test(name);
        fileDone = (async () => {
          const it = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
          const chunks: Buffer[] = [];
          let headLen = 0;
          let ended = false;
          // 1. collect the first SNIFF_BYTES to choose a path
          while (headLen < SNIFF_BYTES) {
            const n = await it.next();
            if (n.done) { ended = true; break; }
            chunks.push(n.value);
            headLen += n.value.length;
          }
          const head = Buffer.concat(chunks);
          const isVideo = isMp4Header(head);
          if (!isVideo && claimsVideo) throw new HttpError(415, "Only MP4 videos are allowed (file is not a valid MP4)", "unsupported_type");
          const cap = isVideo ? limits.maxVideoBytes : limits.maxImageBytes;
          const tooLarge = () => new HttpError(413, `File exceeds limit of ${cap} bytes`, "file_too_large");
          let size = head.length;
          if (size > cap) throw tooLarge();

          if (isVideo) {
            await fsp.mkdir(uploadTmpDir(), { recursive: true, mode: 0o700 });
            tmpCreated = true;
            const ws = fs.createWriteStream(tmpPath, { mode: 0o600 });
            const write = (b: Buffer) => new Promise<void>((res, rej) => { ws.write(b, (e) => (e ? rej(e) : res())); });
            try {
              await write(head);
              while (!ended) {
                const n = await it.next();
                if (n.done) break;
                size += n.value.length;
                if (size > cap) throw tooLarge();
                if (!ws.write(n.value)) await new Promise<void>((res) => ws.once("drain", () => res()));
              }
              if ((stream as unknown as { truncated?: boolean }).truncated) throw tooLarge();
            } finally {
              await new Promise<void>((res) => ws.end(() => res()));
            }
            return done({ kind: "video", name, declaredMime, path: tmpPath, size, cleanup });
          }

          while (!ended) {
            const n = await it.next();
            if (n.done) break;
            size += n.value.length;
            if (size > cap) throw tooLarge();
            chunks.push(n.value);
          }
          if ((stream as unknown as { truncated?: boolean }).truncated) throw tooLarge();
          return done({ kind: "image", name, declaredMime, data: Buffer.concat(chunks), cleanup });
        })().catch(fail);
      });

      bb.on("close", () => {
        // `close` = the whole multipart body parsed. Wait for the file handler (it may still be flushing the temp file) before resolving.
        void (async () => {
          if (settled) return;
          if (!gotFile) return fail(new HttpError(400, "Missing 'file' field", "missing_file"));
          await fileDone;
          if (settled) return;
          if (result) { settled = true; resolve(result); }
          else fail(new HttpError(400, "Malformed multipart body", "bad_form"));
        })();
      });
      body.on("error", () => fail(new HttpError(400, "Upload interrupted", "bad_form")));
      body.pipe(bb);
    });
  } catch (e) {
    await cleanup();
    throw e;
  }
}
