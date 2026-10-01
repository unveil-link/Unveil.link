import { pool, query, queryOne } from "../db";
import { getSettings } from "../services/settings";
import { getBalance, type Balance } from "./ledger";

export interface EarningsSummary {
  currency: "USD";
  balance: Balance;
  /** Funds can be paid out when availableCents >= minPayoutCents. A negative available balance is deducted from future earnings. */
  minPayoutCents: number;
  holdDays: number;
  payoutEligible: boolean;
  lifetime: {
    salesCount: number;
    grossCents: number;
    platformFeeCents: number;
    processingFeeCents: number;
    refundedCents: number;
    chargebackCents: number;
    paidOutCents: number;
    requestedPayoutCents: number;
  };
  recent: { id: string; dropId: string; dropTitle: string; status: string; amountCents: number; sellerNetCents: number; reversedCents: number; createdAt: string }[];
}

/** Everything is derived from ledger_entries / transactions; cents everywhere. Buyer emails are never included. */
export async function getEarningsSummary(sellerId: string): Promise<EarningsSummary> {
  const [settings, balance] = await Promise.all([getSettings(), getBalance(pool(), sellerId)]);
  const l = await queryOne<Record<string, string>>(
    `SELECT
       COALESCE(SUM(amount_cents) FILTER (WHERE entry_type='sale_credit'), 0)                         AS gross,
       COALESCE(-SUM(amount_cents) FILTER (WHERE component='platform_fee'), 0)                         AS platform,
       COALESCE(-SUM(amount_cents) FILTER (WHERE component='processing_fee'), 0)                       AS processing,
       COALESCE(-SUM(amount_cents) FILTER (WHERE entry_type='refund_reversal' AND component='gross'), 0)     AS refunded,
       COALESCE(-SUM(amount_cents) FILTER (WHERE entry_type='chargeback_reversal' AND component='gross'), 0) AS chargebacks,
       COUNT(*) FILTER (WHERE entry_type='sale_credit')                                                 AS sales
     FROM ledger_entries WHERE seller_id = $1`, [sellerId]);
  const po = await queryOne<Record<string, string>>(
    `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='paid'), 0) AS paid,
            COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('requested','approved')), 0) AS open
       FROM payouts WHERE seller_id = $1`, [sellerId]);
  const recent = await query<{ id: string; drop_id: string; title: string; status: string; amount_cents: number; seller_net_cents: number; reversed_cents: number; created_at: string }>(
    `SELECT t.id, t.drop_id, d.title, t.status, t.amount_cents, t.seller_net_cents, t.reversed_cents, t.created_at
       FROM transactions t JOIN drops d ON d.id = t.drop_id
      WHERE t.seller_id = $1 AND t.status <> 'pending' ORDER BY t.created_at DESC LIMIT 20`, [sellerId]);
  const n = (v: string | undefined) => Number(v ?? 0);
  return {
    currency: "USD",
    balance,
    minPayoutCents: settings.min_payout_cents,
    holdDays: settings.payout_hold_days,
    payoutEligible: balance.availableCents >= settings.min_payout_cents && balance.availableCents > 0,
    lifetime: {
      salesCount: n(l?.sales), grossCents: n(l?.gross), platformFeeCents: n(l?.platform), processingFeeCents: n(l?.processing),
      refundedCents: n(l?.refunded), chargebackCents: n(l?.chargebacks), paidOutCents: n(po?.paid), requestedPayoutCents: n(po?.open),
    },
    recent: recent.map((r) => ({
      id: r.id, dropId: r.drop_id, dropTitle: r.title, status: r.status, amountCents: r.amount_cents,
      sellerNetCents: r.seller_net_cents, reversedCents: r.reversed_cents, createdAt: r.created_at,
    })),
  };
}
