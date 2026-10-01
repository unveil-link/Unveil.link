import { withTx, queryOne } from "../db";
import { HttpError } from "../errors";
import { getSettings } from "../services/settings";
import { getBalance, postPayoutDebit, postPayoutReversal } from "./ledger";
import { activeProvider } from "./registry";

/**
 * RECORD-ONLY payouts: no money moves. Flow  requested -> approved -> paid | failed  (requested/approved -> failed also allowed).
 *  - requestPayout reserves the money immediately with a payout_debit ledger entry, so a seller can't double-spend balance.
 *  - A failed payout posts a payout_reversal that returns the reserved amount.
 * Only AVAILABLE balance (past the hold period) can be paid out, and only >= platform_settings.min_payout_cents ($25 default).
 */
export interface PayoutRow {
  id: string; seller_id: string; amount_cents: number; status: "requested" | "approved" | "paid" | "failed" | "pending" | "processing";
  provider: string | null; provider_ref: string | null; requested_at: string; approved_at: string | null; paid_at: string | null;
  failed_at: string | null; failure_reason: string | null;
}
const COLS = "id, seller_id, amount_cents, status, provider, provider_ref, requested_at, approved_at, paid_at, failed_at, failure_reason";

export async function requestPayout(sellerId: string, amountCents?: number): Promise<PayoutRow> {
  const settings = await getSettings();
  return withTx(async (c) => {
    // Serialise payout requests per seller so two concurrent requests can't both spend the same balance.
    const s = await c.query(`SELECT id FROM sellers WHERE id = $1 FOR UPDATE`, [sellerId]);
    if (!s.rowCount) throw new HttpError(404, "Seller not found", "not_found");
    const bal = await getBalance(c, sellerId);
    const amount = amountCents ?? bal.availableCents;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, "Nothing available to pay out", "nothing_available");
    if (amount < settings.min_payout_cents) {
      throw new HttpError(400, `Minimum payout is ${settings.min_payout_cents} cents`, "below_minimum_payout");
    }
    if (amount > bal.availableCents) throw new HttpError(400, "Amount exceeds available balance", "insufficient_available_balance");
    const r = await c.query<PayoutRow>(
      `INSERT INTO payouts (seller_id, amount_cents, status) VALUES ($1,$2,'requested') RETURNING ${COLS}`, [sellerId, amount]);
    await postPayoutDebit(c, sellerId, r.rows[0].id, amount);
    return r.rows[0];
  });
}

async function lockPayout(c: import("pg").PoolClient, id: string): Promise<PayoutRow> {
  const r = await c.query<PayoutRow>(`SELECT ${COLS} FROM payouts WHERE id = $1 FOR UPDATE`, [id]);
  if (!r.rows[0]) throw new HttpError(404, "Payout not found", "not_found");
  return r.rows[0];
}

/** requested -> approved; records the payout with the active provider (record-only) and stores its reference. */
export async function approvePayout(payoutId: string): Promise<PayoutRow> {
  const provider = activeProvider();
  return withTx(async (c) => {
    const p = await lockPayout(c, payoutId);
    if (p.status !== "requested") throw new HttpError(409, `Payout is ${p.status}`, "bad_payout_state");
    const rec = await provider.recordPayout({
      payoutId: p.id, sellerId: p.seller_id, amountCents: p.amount_cents, currency: "USD", idempotencyKey: `payout:${p.id}`,
    });
    const r = await c.query<PayoutRow>(
      `UPDATE payouts SET status='approved', provider=$2, provider_ref=$3, approved_at=now(), updated_at=now() WHERE id=$1 RETURNING ${COLS}`,
      [p.id, provider.name, rec.providerRef]);
    return r.rows[0];
  });
}

export async function markPayoutPaid(payoutId: string): Promise<PayoutRow> {
  return withTx(async (c) => {
    const p = await lockPayout(c, payoutId);
    if (p.status !== "approved") throw new HttpError(409, `Payout is ${p.status}`, "bad_payout_state");
    const r = await c.query<PayoutRow>(`UPDATE payouts SET status='paid', paid_at=now(), updated_at=now() WHERE id=$1 RETURNING ${COLS}`, [p.id]);
    return r.rows[0];
  });
}

export async function markPayoutFailed(payoutId: string, reason: string): Promise<PayoutRow> {
  return withTx(async (c) => {
    const p = await lockPayout(c, payoutId);
    if (p.status !== "requested" && p.status !== "approved") throw new HttpError(409, `Payout is ${p.status}`, "bad_payout_state");
    const r = await c.query<PayoutRow>(
      `UPDATE payouts SET status='failed', failed_at=now(), failure_reason=$2, updated_at=now() WHERE id=$1 RETURNING ${COLS}`, [p.id, reason.slice(0, 300)]);
    await postPayoutReversal(c, p.seller_id, p.id, p.amount_cents);
    return r.rows[0];
  });
}

export const getPayout = (id: string) => queryOne<PayoutRow>(`SELECT ${COLS} FROM payouts WHERE id = $1`, [id]);
