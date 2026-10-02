import crypto from "node:crypto";
import { z } from "zod";
import { query, queryOne, withTx } from "../db";
import { writeAudit } from "../admin/audit";
import { storage } from "../storage";
import { HttpError } from "../errors";
import { isUuid } from "../input";
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

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;

/** Validates a price against the tunable platform bounds (shared by create + edit). */
export function assertPriceInRange(priceCents: number, s: { price_min_cents: number; price_max_cents: number }): void {
  if (!Number.isInteger(priceCents) || priceCents < s.price_min_cents || priceCents > s.price_max_cents) {
    throw new HttpError(400, `Price must be between ${s.price_min_cents} and ${s.price_max_cents} cents`, "price_out_of_range");
  }
}

export async function createDrop(
  sellerId: string,
  input: { title: string; description?: string; priceCents: number },
): Promise<Drop> {
  const s = await getSettings();
  assertPriceInRange(input.priceCents, s);
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
  if (!isUuid(dropId)) throw new HttpError(404, "Drop not found");
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

// Whitelist: .strict() rejects every other key (status, seller_id, attestation, public_link_id ...) with 400 instead of silently ignoring.
// The price is in cents as `priceCents` or `price_cents` (same meaning); sending both is an error.
export const dropPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(TITLE_MAX).optional(),
    description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
    priceCents: z.number().int().optional(),
    price_cents: z.number().int().optional(),
  })
  .strict()
  .refine((b) => !(b.priceCents !== undefined && b.price_cents !== undefined), { message: "send either priceCents or price_cents, not both" });

export interface DropPatch {
  title?: string;
  /** null clears the description */
  description?: string | null;
  priceCents?: number;
}

/**
 * Edits title / description / price of the caller's own drop. ONLY those columns are written: status, attestation,
 * attested_at, attestation_history, published_at etc. are never touched (editing a published drop keeps its attestation data).
 * Flagged drops are frozen (under review). A price change on a published drop supersedes stale pending checkouts at checkout time
 * (see payments/checkout.ts), and the price is always read from this row, so buyers never pay a stale price.
 */
export async function updateDrop(sellerId: string, dropId: string, patch: DropPatch): Promise<Drop> {
  const drop = await getOwnedDrop(sellerId, dropId);
  if (drop.status === "flagged") throw new HttpError(403, "Drop is flagged and under review", "flagged");
  const sets: string[] = [];
  const params: unknown[] = [dropId];
  const changed: Record<string, [unknown, unknown]> = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (t.length < 1 || t.length > TITLE_MAX) throw new HttpError(400, `Title must be 1-${TITLE_MAX} characters`, "invalid_input");
    params.push(t); sets.push(`title = $${params.length}`); changed.title = [drop.title, t];
  }
  if (patch.description !== undefined) {
    const d = patch.description === null ? null : patch.description.trim() || null;
    if (d !== null && d.length > DESCRIPTION_MAX) throw new HttpError(400, `Description must be at most ${DESCRIPTION_MAX} characters`, "invalid_input");
    params.push(d); sets.push(`description = $${params.length}`); changed.description = [drop.description, d];
  }
  if (patch.priceCents !== undefined) {
    assertPriceInRange(patch.priceCents, await getSettings());
    params.push(patch.priceCents); sets.push(`price_cents = $${params.length}`); changed.price_cents = [drop.price_cents, patch.priceCents];
  }
  if (sets.length === 0) throw new HttpError(400, "Nothing to update", "empty_patch");
  return withTx(async (c) => {
    const locked = await c.query<{ status: string }>("SELECT status FROM drops WHERE id = $1 AND seller_id = $2 FOR UPDATE", [dropId, sellerId]);
    if (locked.rowCount === 0) throw new HttpError(404, "Drop not found");
    if (locked.rows[0].status === "flagged") throw new HttpError(403, "Drop is flagged and under review", "flagged");
    const r = await c.query<Drop>(
      `UPDATE drops SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING ${DROP_COLS}`,
      params,
    );
    const summary = Object.entries(changed).map(([k, [a, b]]) => (k === "price_cents" ? `${k}: ${a} -> ${b}` : `${k} changed${k === "title" ? ` (${String(a).length}->${String(b).length} chars)` : ""}`)).join("; ");
    await writeAudit(c, { action: "drop_edited", target: `drop:${dropId} seller:${sellerId} status:${drop.status} ${summary}` });
    return r.rows[0];
  });
}

/**
 * Deletes the caller's own drop: the drops row, its drop_files rows (FK ON DELETE CASCADE) and open/closed abuse reports (CASCADE),
 * then the stored originals AND blurred previews from private storage.
 * Refused (409) while money records reference the drop (transactions.drop_id is RESTRICT: sales history must survive) or while an
 * abuse report is open/under review (evidence); refused (403) for flagged drops. Unpublish instead in those cases.
 * Order: DB first (atomic, audited, returns the keys), storage second (best effort; failures are logged + audited as orphans
 * rather than resurrecting a deleted drop). NOTE: nothing here revokes already-issued signed URLs - see README "Deleting drops".
 */
export async function deleteDrop(sellerId: string, dropId: string): Promise<{ deletedFiles: number; storageErrors: number }> {
  await getOwnedDrop(sellerId, dropId);
  const { keys, fileCount } = await withTx(async (c) => {
    const d = await c.query<{ status: string; title: string }>("SELECT status, title FROM drops WHERE id = $1 AND seller_id = $2 FOR UPDATE", [dropId, sellerId]);
    if (d.rowCount === 0) throw new HttpError(404, "Drop not found");
    if (d.rows[0].status === "flagged") throw new HttpError(403, "Drop is flagged and under review", "flagged");
    const tx = await c.query("SELECT 1 FROM transactions WHERE drop_id = $1 LIMIT 1", [dropId]);
    if (tx.rowCount) {
      throw new HttpError(409, "This drop has sales and cannot be deleted. Unpublish it instead.", "drop_has_sales");
    }
    const rep = await c.query("SELECT 1 FROM reports WHERE drop_id = $1 AND status IN ('open','reviewing') LIMIT 1", [dropId]);
    if (rep.rowCount) throw new HttpError(409, "This drop has an open report and cannot be deleted right now.", "drop_has_open_report");
    const files = await c.query<{ storage_key: string; blurred_preview_key: string | null }>(
      "SELECT storage_key, blurred_preview_key FROM drop_files WHERE drop_id = $1",
      [dropId],
    );
    await c.query("DELETE FROM drops WHERE id = $1", [dropId]); // cascades drop_files (+ reports)
    await writeAudit(c, { action: "drop_deleted", target: `drop:${dropId} seller:${sellerId} status:${d.rows[0].status} files:${files.rowCount}` });
    return { fileCount: files.rowCount ?? 0, keys: files.rows.flatMap((f) => [f.storage_key, f.blurred_preview_key].filter((k): k is string => !!k)) };
  });
  const st = storage();
  const failed: string[] = [];
  for (const k of keys) {
    try { await st.delete(k); } catch (e) { failed.push(k); console.error("drop delete: storage cleanup failed", k, (e as Error).message); }
  }
  if (failed.length) {
    await writeAudit(null, { action: "drop_storage_orphans", target: `drop:${dropId} undeleted keys: ${failed.join(",")}` }).catch(() => {});
  }
  return { deletedFiles: fileCount, storageErrors: failed.length };
}
