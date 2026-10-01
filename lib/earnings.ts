import { usd } from "./format";

/** Lifetime figures, in cents. Same names/semantics as `lifetime` in GET /api/earnings (payments layer):
 *  fee totals are NET of the fee shares handed back on refunds / chargebacks, refunded and chargeback amounts are the
 *  gross handed back to buyers, kept apart. Because of that, refunds are subtracted exactly once (from gross) and never
 *  again from the fees. */
export type EarningsTotals = {
  grossCents: number;
  platformFeeCents: number;
  processingFeeCents: number;
  refundedCents: number;
  chargebackCents: number;
  paidOutCents: number;
  /** Payouts requested / approved but not yet paid. */
  pendingPayoutCents: number;
};

export type EarningsBreakdown = EarningsTotals & {
  /** gross − refunded − charged back − platform fee − processing fees */
  netCents: number;
  /** net − paid out − pending payouts (can be < 0 if a reversal lands after a payout). */
  availableCents: number;
  /** Gross of the sales that were not refunded / charged back (fees are only kept on these). */
  keptGrossCents: number;
  /** Platform fee as a % of keptGross (1 decimal), null when there is nothing kept. */
  platformFeePct: number | null;
  /** Processing fees as a % of keptGross (1 decimal). */
  processingFeePct: number | null;
  /** Share of keptGross the seller keeps (1 decimal). */
  keepPct: number | null;
};

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export function earningsBreakdown(t: EarningsTotals): EarningsBreakdown {
  const netCents = t.grossCents - t.refundedCents - t.chargebackCents - t.platformFeeCents - t.processingFeeCents;
  const keptGrossCents = t.grossCents - t.refundedCents - t.chargebackCents;
  return {
    ...t,
    netCents,
    availableCents: netCents - t.paidOutCents - t.pendingPayoutCents,
    keptGrossCents,
    platformFeePct: pct(t.platformFeeCents, keptGrossCents),
    processingFeePct: pct(t.processingFeeCents, keptGrossCents),
    keepPct: pct(netCents, keptGrossCents),
  };
}

/** "$431.00 gross − $43.10 platform fee − $21.56 processing fees = $366.34" (refund / chargeback terms only when non-zero). */
export function breakdownLine(b: EarningsBreakdown): string {
  const parts = [`${usd(b.grossCents)} gross`, `− ${usd(b.platformFeeCents)} platform fee`, `− ${usd(b.processingFeeCents)} processing fees`];
  if (b.refundedCents) parts.push(`− ${usd(b.refundedCents)} refunded`);
  if (b.chargebackCents) parts.push(`− ${usd(b.chargebackCents)} charged back`);
  return `${parts.join(" ")} = ${usd(b.netCents)}`;
}

/** Status line for reversed sales; refunds and chargebacks are always named separately. */
export function reversalsLabel(b: Pick<EarningsBreakdown, "refundedCents" | "chargebackCents">): string | null {
  const parts = [b.refundedCents && `${usd(b.refundedCents)} refunded`, b.chargebackCents && `${usd(b.chargebackCents)} charged back`].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
