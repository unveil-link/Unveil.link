import crypto from "node:crypto";
import sharp from "sharp";
import { query, queryOne } from "../db";
import { HttpError } from "../errors";
import { storage } from "../storage";
import { getSettings } from "./settings";
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

  const count = await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM drop_files WHERE drop_id=$1", [drop.id]);
  if ((count?.n ?? 0) >= s.max_files_per_drop) {
    throw new HttpError(400, `A drop can have at most ${s.max_files_per_drop} files`, "too_many_files");
  }

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

  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || `upload.${EXT[mime]}`;
  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO drop_files (id, drop_id, storage_key, filename, mime, size_bytes, blurred_preview_key, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE((SELECT max(sort_order)+1 FROM drop_files WHERE drop_id=$2),0))
       RETURNING id`,
      [id, drop.id, storageKey, safeName, mime, file.data.length, previewKey],
    );
    return { id: rows[0].id, filename: safeName, mime, sizeBytes: file.data.length };
  } catch (e) {
    await st.delete(storageKey);
    await st.delete(previewKey);
    throw e;
  }
}

export async function getFileRow(fileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
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
