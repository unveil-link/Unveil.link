import crypto from "node:crypto";
import { query, queryOne } from "../db";
import { HttpError } from "../errors";
import { findProvider } from "./registry";
import { TX_COLS, type TxRow } from "./ledger";

/**
 * Ask the processor to refund (all or part of) a sale. The ledger/transaction do NOT change here: they move only when
 * the processor's verified `refunded` webhook arrives (so the processor stays the source of truth and a refund that the
 * processor rejects never touches the books). `amountCents` omitted = everything still refundable.
 * `requestId` makes the call idempotent at the processor; reuse it when retrying the same refund.
 */
export async function requestRefund(transactionId: string, opts: { amountCents?: number; requestId?: string; reason?: string } = {}) {
  const tx = await queryOne<TxRow>(`SELECT ${TX_COLS} FROM transactions WHERE id = $1`, [transactionId]);
  if (!tx) throw new HttpError(404, "Transaction not found", "not_found");
  if (tx.status !== "succeeded" || !tx.processor_ref) throw new HttpError(409, `Cannot refund a ${tx.status} transaction`, "not_refundable");
  const remaining = tx.amount_cents - tx.reversed_cents;
  const amount = opts.amountCents ?? remaining;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) {
    throw new HttpError(400, `Refund must be between 1 and ${remaining} cents`, "over_refund");
  }
  const provider = findProvider(tx.provider);
  if (!provider) throw new HttpError(503, "Provider not available", "payments_unavailable");
  const avail = provider.availability();
  if (!avail.ok) throw new HttpError(503, "Provider not available", "payments_unavailable");
  const requestId = opts.requestId ?? crypto.randomUUID();
  const res = await provider.issueRefund({
    providerTransactionId: tx.processor_ref,
    transactionId: tx.id,
    amountCents: amount,
    currency: tx.currency.trim(),
    idempotencyKey: `${tx.id}:${requestId}`,
    reason: opts.reason,
  });
  return { transactionId: tx.id, amountCents: amount, providerRefundId: res.providerRefundId, status: res.status, provider: tx.provider };
}

export const listTransactionLedger = (transactionId: string) =>
  query<{ entry_type: string; component: string; amount_cents: number; created_at: string }>(
    `SELECT entry_type, component, amount_cents, created_at FROM ledger_entries WHERE transaction_id = $1 ORDER BY id`, [transactionId]);

/**
 * Void a charge that the processor confirmed but we must not honour (seller no longer verified, drop pulled/flagged, session
 * far past expiry): asks the provider for a FULL refund through the normal interface. No ledger entries exist for such a
 * transaction (it was never credited); the processor's `refunded` webhook is only recorded (void_refund_confirmed).
 * Idempotent: the provider idempotency key is stable per transaction and refund_requested_at is set once.
 */
export async function voidCharge(transactionId: string): Promise<boolean> {
  const tx = await queryOne<TxRow>(`SELECT ${TX_COLS} FROM transactions WHERE id = $1`, [transactionId]);
  if (!tx || !tx.review_reason || tx.refund_requested_at || !tx.processor_ref) return false;
  const provider = findProvider(tx.provider);
  if (!provider || !provider.availability().ok) throw new Error(`provider ${tx.provider} unavailable for void refund`);
  await provider.issueRefund({
    providerTransactionId: tx.processor_ref,
    transactionId: tx.id,
    amountCents: tx.amount_cents,
    currency: tx.currency.trim(),
    idempotencyKey: `void:${tx.id}`,
    reason: `void:${tx.review_reason}`,
  });
  await query(`UPDATE transactions SET refund_requested_at = now(), updated_at = now() WHERE id = $1 AND refund_requested_at IS NULL`, [tx.id]);
  return true;
}

/** Ops/cron hook: re-ask for void refunds whose first attempt failed (provider outage). Returns how many were requested. */
export async function retryVoidRefunds(): Promise<number> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM transactions WHERE review_reason IS NOT NULL AND refund_requested_at IS NULL AND processor_ref IS NOT NULL ORDER BY created_at LIMIT 100`);
  let n = 0;
  for (const r of rows) {
    try { if (await voidCharge(r.id)) n++; } catch (e) { console.error("retryVoidRefunds", (e as Error).message); }
  }
  return n;
}
