import { query, queryOne, withTx } from "../db";
import { HttpError } from "../errors";
import { isUuid } from "../input";

export interface FlaggedSeller {
  id: string; displayName: string; email: string; verificationStatus: string;
  flaggedAt: string; flagReason: string | null;
  chargebacks: number; refunds: number; totalSales: number;
}

/** Sellers with risk_flagged_at set (oldest flag first). Aggregates come from transactions/ledger; never selects password_hash or payout details. */
export async function listFlaggedSellers(): Promise<FlaggedSeller[]> {
  const rows = await query<{ id: string; display_name: string; email: string; verification_status: string; risk_flagged_at: string; risk_flag_reason: string | null; chargebacks: string; refunds: string; total_sales: string }>(
    `SELECT s.id, s.display_name, s.email, s.verification_status, s.risk_flagged_at, s.risk_flag_reason,
            (SELECT count(*) FROM transactions t WHERE t.seller_id = s.id AND t.status = 'charged_back') AS chargebacks,
            (SELECT count(DISTINCT l.transaction_id) FROM ledger_entries l WHERE l.seller_id = s.id AND l.entry_type = 'refund_reversal' AND l.component = 'gross') AS refunds,
            (SELECT count(*) FROM transactions t WHERE t.seller_id = s.id AND t.status IN ('succeeded','refunded','charged_back')) AS total_sales
       FROM sellers s WHERE s.risk_flagged_at IS NOT NULL ORDER BY s.risk_flagged_at ASC, s.id LIMIT 500`);
  return rows.map((r) => ({
    id: r.id, displayName: r.display_name, email: r.email, verificationStatus: r.verification_status, flaggedAt: r.risk_flagged_at, flagReason: r.risk_flag_reason,
    chargebacks: Number(r.chargebacks), refunds: Number(r.refunds), totalSales: Number(r.total_sales),
  }));
}

export interface ReviewTransaction {
  id: string; sellerId: string; sellerEmail: string; dropTitle: string; amountCents: number; status: string; failureCode: string | null;
  reviewReason: string | null; createdAt: string; refundRequestedAt: string | null;
  /** requested | pending_retry | failed (attempts exhausted) | not_applicable */
  refundState: "requested" | "pending_retry" | "failed" | "not_applicable";
  refundAttempts: number; refundLastError: string | null; refundNextAttemptAt: string | null;
}

/** Transactions that need a human: a confirmed charge we did not honour (review_reason set / failed invalid_at_capture), newest first. */
export async function listReviewTransactions(): Promise<ReviewTransaction[]> {
  const rows = await query<{
    id: string; seller_id: string; email: string; title: string; amount_cents: number; status: string; failure_code: string | null; review_reason: string | null;
    created_at: string; refund_requested_at: string | null; void_refund_attempts: number; void_refund_last_error: string | null; void_refund_next_attempt_at: string | null; max_attempts: number;
  }>(
    `SELECT t.id, t.seller_id, s.email, d.title, t.amount_cents, t.status, t.failure_code, t.review_reason, t.created_at, t.refund_requested_at,
            t.void_refund_attempts, t.void_refund_last_error, t.void_refund_next_attempt_at,
            (SELECT void_refund_max_attempts FROM platform_settings WHERE id = 1) AS max_attempts
       FROM transactions t JOIN sellers s ON s.id = t.seller_id JOIN drops d ON d.id = t.drop_id
      WHERE t.review_reason IS NOT NULL OR (t.status = 'failed' AND t.failure_code = 'invalid_at_capture')
      ORDER BY t.created_at DESC, t.id LIMIT 500`);
  return rows.map((r) => ({
    id: r.id, sellerId: r.seller_id, sellerEmail: r.email, dropTitle: r.title, amountCents: r.amount_cents, status: r.status, failureCode: r.failure_code,
    reviewReason: r.review_reason, createdAt: r.created_at, refundRequestedAt: r.refund_requested_at,
    refundState: r.refund_requested_at ? "requested" : r.void_refund_attempts >= r.max_attempts ? "failed" : r.review_reason ? "pending_retry" : "not_applicable",
    refundAttempts: r.void_refund_attempts, refundLastError: r.void_refund_last_error, refundNextAttemptAt: r.void_refund_next_attempt_at,
  }));
}

export interface SellerTransactionRow { id: string; dropTitle: string; status: string; amountCents: number; reversedCents: number; failureCode: string | null; reviewReason: string | null; createdAt: string }

/** A seller's most recent transactions (no buyer emails: the admin brick doesn't need that PII). */
export async function listSellerTransactions(sellerId: string): Promise<{ seller: { id: string; displayName: string; email: string } | null; rows: SellerTransactionRow[] }> {
  if (!isUuid(sellerId)) return { seller: null, rows: [] };
  const seller = await queryOne<{ id: string; display_name: string; email: string }>(`SELECT id, display_name, email FROM sellers WHERE id = $1`, [sellerId]);
  if (!seller) return { seller: null, rows: [] };
  const rows = await query<{ id: string; title: string; status: string; amount_cents: number; reversed_cents: number; failure_code: string | null; review_reason: string | null; created_at: string }>(
    `SELECT t.id, d.title, t.status, t.amount_cents, t.reversed_cents, t.failure_code, t.review_reason, t.created_at
       FROM transactions t JOIN drops d ON d.id = t.drop_id WHERE t.seller_id = $1 ORDER BY t.created_at DESC, t.id LIMIT 200`, [sellerId]);
  return {
    seller: { id: seller.id, displayName: seller.display_name, email: seller.email },
    rows: rows.map((r) => ({ id: r.id, dropTitle: r.title, status: r.status, amountCents: r.amount_cents, reversedCents: r.reversed_cents, failureCode: r.failure_code, reviewReason: r.review_reason, createdAt: r.created_at })),
  };
}

/**
 * The one admin action of this brick: mark a flagged seller as reviewed. Clears risk_flagged_at/reason, records reviewer + note, and
 * writes audit_log (admin id + time) IN THE SAME TRANSACTION, so there is never an unaudited change. Only chargebacks after the review
 * count towards a re-flag (see webhooks.ts). Nothing else about the seller changes (no ban, no verification change).
 */
export async function clearSellerFlag(adminId: string, sellerId: string, note: string): Promise<{ sellerId: string; reviewedAt: string }> {
  const n = note.trim();
  if (n.length < 3 || n.length > 500) throw new HttpError(400, "A review note of 3-500 characters is required", "note_required");
  if (!isUuid(sellerId)) throw new HttpError(404, "Seller not found", "not_found");
  return withTx(async (c) => {
    const s = await c.query<{ risk_flagged_at: string | null; risk_flag_reason: string | null }>(`SELECT risk_flagged_at, risk_flag_reason FROM sellers WHERE id = $1 FOR UPDATE`, [sellerId]);
    if (!s.rows[0]) throw new HttpError(404, "Seller not found", "not_found");
    if (!s.rows[0].risk_flagged_at) throw new HttpError(409, "Seller is not flagged", "not_flagged");
    const up = await c.query<{ risk_reviewed_at: string }>(
      `UPDATE sellers SET risk_flagged_at = NULL, risk_flag_reason = NULL, risk_reviewed_at = now(), risk_reviewed_by = $2, risk_review_note = $3
        WHERE id = $1 RETURNING risk_reviewed_at`, [sellerId, adminId, n]);
    await c.query(`INSERT INTO audit_log (admin_id, action, target) VALUES ($1, 'seller_flag_cleared', $2)`,
      [adminId, `seller:${sellerId} previous_reason: ${s.rows[0].risk_flag_reason ?? "-"} | note: ${n}`]);
    return { sellerId, reviewedAt: up.rows[0].risk_reviewed_at };
  });
}
