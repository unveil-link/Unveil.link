import crypto from "node:crypto";
import { query, queryOne } from "../db";
import { HttpError } from "../errors";
import { getSettings } from "./settings";
import { getSellerById } from "./sellers";

export interface Drop {
  id: string;
  seller_id: string;
  public_link_id: string;
  title: string;
  description: string | null;
  price_cents: number;
  cover_url: string | null;
  status: "draft" | "published" | "unpublished" | "flagged";
  created_at: string;
}
export interface DropFile {
  id: string;
  drop_id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  sort_order: number;
  has_preview: boolean;
}

const DROP_COLS =
  "id, seller_id, public_link_id, title, description, price_cents, cover_url, status, created_at";

/** 12 chars of base64url from 9 CSPRNG bytes = 72 bits of entropy. */
export function newPublicLinkId(): string {
  return crypto.randomBytes(9).toString("base64url");
}

export async function createDrop(
  sellerId: string,
  input: { title: string; description?: string; priceCents: number },
): Promise<Drop> {
  const s = await getSettings();
  if (input.priceCents < s.price_min_cents || input.priceCents > s.price_max_cents) {
    throw new HttpError(
      400,
      `Price must be between ${s.price_min_cents} and ${s.price_max_cents} cents`,
      "price_out_of_range",
    );
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const rows = await query<Drop>(
        `INSERT INTO drops (seller_id, public_link_id, title, description, price_cents)
         VALUES ($1,$2,$3,$4,$5) RETURNING ${DROP_COLS}`,
        [sellerId, newPublicLinkId(), input.title.trim(), input.description?.trim() || null, input.priceCents],
      );
      return rows[0];
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (err.code === "23505" && err.constraint?.includes("public_link_id")) continue;
      throw e;
    }
  }
  throw new Error("could not allocate public_link_id");
}

export const listDropsForSeller = (sellerId: string) =>
  query<Drop & { file_count: number }>(
    `SELECT ${DROP_COLS.split(", ").map((c) => "d." + c).join(", ")},
            (SELECT count(*)::int FROM drop_files f WHERE f.drop_id = d.id) AS file_count
       FROM drops d WHERE d.seller_id = $1 ORDER BY d.created_at DESC`,
    [sellerId],
  );

/** Loads a drop and asserts ownership (404 rather than 403 so ids don't leak). */
export async function getOwnedDrop(sellerId: string, dropId: string): Promise<Drop> {
  if (!/^[0-9a-f-]{36}$/i.test(dropId)) throw new HttpError(404, "Drop not found");
  const d = await queryOne<Drop>(`SELECT ${DROP_COLS} FROM drops WHERE id = $1 AND seller_id = $2`, [
    dropId,
    sellerId,
  ]);
  if (!d) throw new HttpError(404, "Drop not found");
  return d;
}

export const listFiles = (dropId: string) =>
  query<DropFile>(
    `SELECT id, drop_id, filename, mime, size_bytes::float8 AS size_bytes, sort_order,
            (blurred_preview_key IS NOT NULL) AS has_preview
       FROM drop_files WHERE drop_id = $1 ORDER BY sort_order, created_at`,
    [dropId],
  );

export async function getDropByPublicLink(linkId: string): Promise<Drop | null> {
  if (!/^[A-Za-z0-9_-]{12}$/.test(linkId)) return null;
  return queryOne<Drop>(`SELECT ${DROP_COLS} FROM drops WHERE public_link_id = $1`, [linkId]);
}

export interface Attestation {
  over18: boolean;
  ownsRights: boolean;
  consentOfSubjects: boolean;
}

/** Only verified sellers may publish. Drafting/uploading is allowed for any seller. */
export async function publishDrop(sellerId: string, dropId: string, attestation: Attestation): Promise<Drop> {
  const drop = await getOwnedDrop(sellerId, dropId);
  const seller = await getSellerById(sellerId);
  if (!seller) throw new HttpError(401, "Not authenticated");
  if (seller.verification_status !== "verified") {
    throw new HttpError(
      403,
      `Identity verification required to publish (status: ${seller.verification_status})`,
      "verification_required",
    );
  }
  if (drop.status === "flagged") throw new HttpError(403, "Drop is flagged and under review", "flagged");
  if (!attestation.over18 || !attestation.ownsRights || !attestation.consentOfSubjects) {
    throw new HttpError(400, "All attestations must be confirmed", "attestation_required");
  }
  const files = await listFiles(dropId);
  if (files.length === 0) throw new HttpError(400, "Add at least one file before publishing", "no_files");
  // First publish: attested_at / attestation are written once and never overwritten.
  // Any later publish (re-publish after unpublish, or a repeat call) is appended to attestation_history
  // and stamps last_republished_at; the original attestation timestamp is preserved.
  const at = new Date().toISOString();
  const entry = JSON.stringify({ ...attestation, at });
  const rows = await query<Drop>(
    `UPDATE drops SET
            status = 'published', published_at = now(), updated_at = now(),
            attestation = CASE WHEN attested_at IS NULL THEN $2::jsonb ELSE attestation END,
            attestation_history = CASE WHEN attested_at IS NULL THEN attestation_history
                                       ELSE attestation_history || jsonb_build_array($2::jsonb) END,
            last_republished_at = CASE WHEN attested_at IS NULL THEN last_republished_at ELSE now() END,
            attested_at = COALESCE(attested_at, $3::timestamptz)
      WHERE id = $1 RETURNING ${DROP_COLS}`,
    [dropId, entry, at],
  );
  return rows[0];
}

/** Public path for a link id (spec: unveil.link/u/<12 chars>). */
export const publicPath = (linkId: string) => `/u/${linkId}`;

export interface PublicSummary {
  fileCount: number;
  imageCount: number;
  videoCount: number;
  otherCount: number;
  /** e.g. "3 files: 2 images, 1 video" */
  label: string;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Summarise file kinds from MIME types (pure; unit-tested). */
export function summarizeFiles(files: { mime: string }[]): PublicSummary {
  const imageCount = files.filter((f) => f.mime.startsWith("image/")).length;
  const videoCount = files.filter((f) => f.mime.startsWith("video/")).length;
  const otherCount = files.length - imageCount - videoCount;
  const parts = [
    imageCount && plural(imageCount, "image"),
    videoCount && plural(videoCount, "video"),
    otherCount && plural(otherCount, "other file"),
  ].filter(Boolean);
  const label = files.length === 0 ? "0 files" : `${plural(files.length, "file")}: ${parts.join(", ")}`;
  return { fileCount: files.length, imageCount, videoCount, otherCount, label };
}

export async function unpublishDrop(sellerId: string, dropId: string): Promise<Drop> {
  const drop = await getOwnedDrop(sellerId, dropId);
  if (drop.status === "flagged") throw new HttpError(403, "Drop is flagged", "flagged");
  const rows = await query<Drop>(
    `UPDATE drops SET status='unpublished', updated_at = now() WHERE id = $1 RETURNING ${DROP_COLS}`,
    [dropId],
  );
  return rows[0];
}
