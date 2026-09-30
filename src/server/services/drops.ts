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
  const rows = await query<Drop>(
    `UPDATE drops SET status='published', published_at = now(), updated_at = now(),
            attestation = $2::jsonb
      WHERE id = $1 RETURNING ${DROP_COLS}`,
    [dropId, JSON.stringify({ ...attestation, at: new Date().toISOString() })],
  );
  return rows[0];
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
