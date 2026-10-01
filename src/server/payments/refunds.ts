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
