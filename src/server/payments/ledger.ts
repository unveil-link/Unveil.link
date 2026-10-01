import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { reversalFor, type SaleSplit } from "./money";

/**
 * Append-only seller ledger (table ledger_entries; UPDATE/DELETE/TRUNCATE are blocked by triggers).
 * Amounts are signed integer cents from the SELLER's point of view:
 *   sale:        +gross  -platform_fee  -processing_fee            (sums to seller_net)
 *   refund:      -gross  +platform_fee_share  +processing_fee_share (sums to -seller_net_share)
 *   chargeback:  same as refund, plus an optional negative chargeback_fee
 *   payout:      payout_debit (negative) when requested; payout_reversal (positive) if it fails
 * balance = SUM(amount_cents). "Pending" = entries whose available_at is still in the future (the hold period).
 */
export interface TxRow {
  id: string;
  drop_id: string;
  seller_id: string;
  buyer_email: string;
  amount_cents: number;
  platform_fee_cents: number;
  processing_fee_cents: number;
  seller_net_cents: number;
  processor_ref: string | null;
  status: "pending" | "succeeded" | "failed" | "refunded" | "charged_back";
  provider: string;
  currency: string;
  reversed_cents: number;
}
export const TX_COLS =
  "id, drop_id, seller_id, buyer_email, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents, processor_ref, status, provider, currency, reversed_cents";

export const splitOf = (tx: TxRow): SaleSplit => ({
  grossCents: tx.amount_cents,
  platformFeeCents: tx.platform_fee_cents,
  processingFeeCents: tx.processing_fee_cents,
  sellerNetCents: tx.seller_net_cents,
});

interface Line { type: string; component: string; amount: number }

async function insertLines(
  c: PoolClient,
  base: { sellerId: string; transactionId: string | null; payoutId: string | null; webhookEventId: string | null; memo: string | null },
  lines: Line[],
  availableAtSql: string, // trusted SQL fragment built in this file only
  availableAtParam?: unknown,
) {
  const lines0 = lines.filter((l) => l.amount !== 0);
  if (!lines0.length) return;
  await c.query(
    `INSERT INTO ledger_entries (posting_id, seller_id, transaction_id, payout_id, webhook_event_id, entry_type, component, amount_cents, available_at, memo)
     SELECT $1, $2, $3, $4, $5, t.entry_type, t.component, t.amount, ${availableAtSql}, $9
       FROM unnest($6::text[], $7::text[], $8::int[]) AS t(entry_type, component, amount)`,
    [
      crypto.randomUUID(), base.sellerId, base.transactionId, base.payoutId, base.webhookEventId,
      lines0.map((l) => l.type), lines0.map((l) => l.component), lines0.map((l) => l.amount), base.memo,
      ...(availableAtParam === undefined ? [] : [availableAtParam]), // $10, only referenced by the hold-days fragment
    ],
  );
}

/** Post the three sale lines for a succeeded transaction. Funds become available `holdDays` after now (DB clock). */
export async function postSale(c: PoolClient, tx: TxRow, webhookEventId: string | null, holdDays: number): Promise<void> {
  await insertLines(
    c,
    { sellerId: tx.seller_id, transactionId: tx.id, payoutId: null, webhookEventId, memo: null },
    [
      { type: "sale_credit", component: "gross", amount: tx.amount_cents },
      { type: "platform_fee", component: "platform_fee", amount: -tx.platform_fee_cents },
      { type: "processing_fee", component: "processing_fee", amount: -tx.processing_fee_cents },
    ],
    "now() + make_interval(days => $10::int)",
    holdDays,
  );
}

export interface ReversalPosting {
  kind: "refund" | "chargeback";
  amountCents: number;
  chargebackFeeCents: number;
}

/**
 * Post a (partial or full) refund/chargeback reversal. Throws OverRefundError if it would exceed the sale.
 * Reversal lines inherit the sale's available_at so a refund inside the hold window reduces PENDING, not available.
 */
export async function postReversal(c: PoolClient, tx: TxRow, p: ReversalPosting, webhookEventId: string | null) {
  const r = reversalFor(splitOf(tx), tx.reversed_cents, p.amountCents);
  const type = p.kind === "refund" ? "refund_reversal" : "chargeback_reversal";
  const base = { sellerId: tx.seller_id, transactionId: tx.id, payoutId: null, webhookEventId, memo: null };
  await insertLines(
    c, base,
    [
      { type, component: "gross", amount: -r.grossCents },
      { type, component: "platform_fee", amount: r.platformFeeCents },
      { type, component: "processing_fee", amount: r.processingFeeCents },
    ],
    "(SELECT available_at FROM ledger_entries WHERE transaction_id = $3 AND entry_type = 'sale_credit' LIMIT 1)",
  );
  if (p.kind === "chargeback" && p.chargebackFeeCents > 0) {
    await insertLines(c, base, [{ type: "chargeback_fee", component: "chargeback_fee", amount: -p.chargebackFeeCents }], "now()");
  }
  return r;
}

export async function postPayoutDebit(c: PoolClient, sellerId: string, payoutId: string, amountCents: number) {
  await insertLines(c, { sellerId, transactionId: null, payoutId, webhookEventId: null, memo: null },
    [{ type: "payout_debit", component: "payout", amount: -amountCents }], "now()");
}
export async function postPayoutReversal(c: PoolClient, sellerId: string, payoutId: string, amountCents: number) {
  await insertLines(c, { sellerId, transactionId: null, payoutId, webhookEventId: null, memo: "payout failed" },
    [{ type: "payout_reversal", component: "payout", amount: amountCents }], "now()");
}

export interface Balance { pendingCents: number; availableCents: number; totalCents: number }

/** Seller balance computed from the ledger (works inside or outside a tx). Available may be NEGATIVE (refund/chargeback after payout). */
export async function getBalance(q: Pick<PoolClient, "query">, sellerId: string): Promise<Balance> {
  // clock_timestamp(), not now(): now() is the START of the current transaction, so an "immediate" entry committed by a
  // concurrent transaction that started later (available_at = its now()) would wrongly look pending to this one.
  const r = await q.query<{ pending: number; available: number }>(
    `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE available_at >  clock_timestamp()), 0)::float8 AS pending,
            COALESCE(SUM(amount_cents) FILTER (WHERE available_at <= clock_timestamp()), 0)::float8 AS available
       FROM ledger_entries WHERE seller_id = $1`,
    [sellerId],
  );
  const pendingCents = Number(r.rows[0].pending), availableCents = Number(r.rows[0].available);
  return { pendingCents, availableCents, totalCents: pendingCents + availableCents };
}
