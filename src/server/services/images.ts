import crypto from "node:crypto";
import sharp from "sharp";
import { queryOne, withTx } from "../db";
import { HttpError } from "../errors";
import { isUuid } from "../input";
import { storage } from "../storage";
import { getSettings, type PlatformSettings } from "./settings";
import { getOwnedDrop } from "./drops";

const FORMAT_TO_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_PIXELS = 100_000_000; // decompression-bomb guard

/**
 * Strongly obscured preview: EXIF-orient, downscale to <=320px, heavy gaussian blur,
 * low-quality JPEG, all metadata stripped (sharp drops EXIF/ICC/XMP unless withMetadata is used).
 * The downscale + blur is irreversible enough that the subject is not recognisable.
 */
export async function makeBlurredPreview(input: Buffer): Promise<Buffer> {
  return sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" })
    .rotate() // apply EXIF orientation before the metadata is discarded
    .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
    .blur(18)
    .modulate({ saturation: 0.9 })
    .jpeg({ quality: 55, mozjpeg: true })
    .toBuffer();
}

/**
 * Per-drop quota accounting (pure, unit-tested): at most `max_files_per_drop` files and
 * `max_total_bytes_per_drop` total bytes (originals) including the incoming file.
 */
export function assertDropQuota(
  current: { count: number; totalBytes: number },
  incomingBytes: number,
  limits: Pick<PlatformSettings, "max_files_per_drop" | "max_total_bytes_per_drop">,
): void {
  if (current.count + 1 > limits.max_files_per_drop) {
    throw new HttpError(400, `A drop can have at most ${limits.max_files_per_drop} files`, "too_many_files");
  }
  if (current.totalBytes + incomingBytes > limits.max_total_bytes_per_drop) {
    const gb = (limits.max_total_bytes_per_drop / 1024 ** 3).toFixed(2).replace(/\.?0+$/, "");
    throw new HttpError(
      413,
      `A drop can hold at most ${limits.max_total_bytes_per_drop >= 1024 ** 2 ? gb + " GB" : limits.max_total_bytes_per_drop + " bytes"} in total`,
      "drop_too_large",
    );
  }
}

export async function addImageToDrop(
  sellerId: string,
  dropId: string,
  file: { name: string; data: Buffer; declaredMime: string },
) {
  const drop = await getOwnedDrop(sellerId, dropId);
  const s = await getSettings();

  if (file.data.length === 0) throw new HttpError(400, "Empty file", "empty_file");
  if (file.data.length > s.max_image_size_bytes) {
    throw new HttpError(413, `File exceeds limit of ${s.max_image_size_bytes} bytes`, "file_too_large");
  }

  // Trust the decoded format, not the client-declared MIME / extension.
  let format: string | undefined;
  try {
    format = (await sharp(file.data, { limitInputPixels: MAX_PIXELS }).metadata()).format;
  } catch {
    throw new HttpError(415, "Not a valid image", "invalid_image");
  }
  const mime = format ? FORMAT_TO_MIME[format] : undefined;
  if (!mime || !s.allowed_image_mimes.includes(mime)) {
    throw new HttpError(415, "Only JPG, PNG and WebP images are allowed", "unsupported_type");
  }

  // Cheap early reject (not authoritative: the locked re-check inside the insert transaction below is).
  const pre = await queryOne<{ n: number; total: number }>(
    "SELECT count(*)::int AS n, COALESCE(sum(size_bytes),0)::float8 AS total FROM drop_files WHERE drop_id=$1",
    [drop.id],
  );
  assertDropQuota({ count: pre?.n ?? 0, totalBytes: pre?.total ?? 0 }, file.data.length, s);

  let preview: Buffer;
  try {
    preview = await makeBlurredPreview(file.data);
  } catch {
    throw new HttpError(415, "Could not process image", "invalid_image");
  }

  // Random, non-derivable keys. Originals and previews live under separate prefixes.
  const id = crypto.randomUUID();
  const storageKey = `originals/${drop.id}/${id}.${EXT[mime]}`;
  const previewKey = `previews/${drop.id}/${id}.jpg`;
  const st = storage();
  await st.put(storageKey, file.data, mime);
  await st.put(previewKey, preview, "image/jpeg");

  const safeName = safeFilename(file.name, EXT[mime]);
  try {
    await insertFileLocked({ id, dropId: drop.id, storageKey, previewKey, filename: safeName, mime, sizeBytes: file.data.length });
    return { id, filename: safeName, mime, sizeBytes: file.data.length };
  } catch (e) {
    await st.delete(storageKey);
    await st.delete(previewKey);
    throw e;
  }
}

export function safeFilename(name: string, ext: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || `upload.${ext}`;
}

/**
 * Serialise per drop: the row lock makes count + size check + insert atomic, so parallel uploads (images AND videos share this
 * path) cannot overshoot the limits. NOTE: nothing in here may use the pool (only `c`), otherwise concurrent uploads could exhaust
 * the pool while holding locks. If the drop was deleted meanwhile, the caller's storage cleanup runs and the client gets a 404.
 */
export async function insertFileLocked(f: {
  id: string; dropId: string; storageKey: string; previewKey: string; filename: string; mime: string; sizeBytes: number;
}): Promise<void> {
  await withTx(async (c) => {
    const locked = await c.query("SELECT id FROM drops WHERE id = $1 FOR UPDATE", [f.dropId]);
    if (locked.rowCount === 0) throw new HttpError(404, "Drop not found");
    const cur = (
      await c.query<{ n: number; total: number }>(
        "SELECT count(*)::int AS n, COALESCE(sum(size_bytes),0)::float8 AS total FROM drop_files WHERE drop_id=$1",
        [f.dropId],
      )
    ).rows[0];
    const live = (
      await c.query<Pick<PlatformSettings, "max_files_per_drop" | "max_total_bytes_per_drop">>(
        "SELECT max_files_per_drop, max_total_bytes_per_drop::float8 AS max_total_bytes_per_drop FROM platform_settings WHERE id = 1",
      )
    ).rows[0];
    assertDropQuota({ count: cur.n, totalBytes: cur.total }, f.sizeBytes, live);
    await c.query(
      `INSERT INTO drop_files (id, drop_id, storage_key, filename, mime, size_bytes, blurred_preview_key, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE((SELECT max(sort_order)+1 FROM drop_files WHERE drop_id=$2),0))`,
      [f.id, f.dropId, f.storageKey, f.filename, f.mime, f.sizeBytes, f.previewKey],
    );
  });
}

export async function getFileRow(fileId: string) {
  if (!isUuid(fileId)) return null;
  return queryOne<{
    id: string;
    drop_id: string;
    storage_key: string;
    mime: string;
    filename: string;
    blurred_preview_key: string | null;
    seller_id: string;
    drop_status: string;
    public_link_id: string;
  }>(
    `SELECT f.id, f.drop_id, f.storage_key, f.mime, f.filename, f.blurred_preview_key,
            d.seller_id, d.status AS drop_status, d.public_link_id
       FROM drop_files f JOIN drops d ON d.id = f.drop_id WHERE f.id = $1`,
    [fileId],
  );
}
