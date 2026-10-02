import { usd } from "./format";

/**
 * Display layer for the seller's earnings. NO money rules live here: every figure comes from the payments layer
 * (`GET /api/earnings` = `getEarningsSummary()`: ledger balance incl. the payout hold, lifetime ledger sums, payouts).
 * This file only (a) maps that summary to the names the UI uses and (b) derives the few "how do these add up" figures
 * that exist purely for display (percentages, the reconciliation line, a residual for chargeback fees).
 *
 * Field mapping (EarningsSummary -> EarningsView):
 *   lifetime.grossCents          -> grossCents          (sum of sale_credit; refunded/charged-back sales still counted here)
 *   lifetime.platformFeeCents    -> platformFeeCents    (ledger platform_fee, NET of fee shares returned on refunds/chargebacks)
 *   lifetime.processingFeeCents  -> processingFeeCents  (same, processing)
 *   lifetime.refundedCents       -> refundedCents       (gross handed back by refunds, partial refunds included)
 *   lifetime.chargebackCents     -> chargebackCents     (gross handed back by chargebacks)
 *   lifetime.salesCount          -> salesCount
 *   lifetime.paidOutCents        -> paidOutCents        (payouts with status paid)
 *   lifetime.requestedPayoutCents-> inPayoutCents       (payouts requested/approved, funds already reserved)
 *   balance.availableCents       -> availableCents      (ledger entries past the hold; MAY BE NEGATIVE)
 *   balance.pendingCents         -> pendingCents        (ledger entries still inside the hold period)
 *   balance.totalCents           -> (used for netCents below)
 *   holdDays / minPayoutCents / payoutEligible -> same names
 * Derived for display only:
 *   netCents          = balance.totalCents + paidOutCents + inPayoutCents   (everything ever credited net of fees, reversals and
 *                       chargeback fees, before payouts; payouts only move money out of the balance, so we add them back)
 *   chargebackFeesCents = gross − refunded − chargebacks − platform − processing − net   (the ledger's chargeback_fee lines,
 *                       which the summary does not list separately; 0 when there are none)
 */
export type EarningsSummaryLike = {
  balance: { pendingCents: number; availableCents: number; totalCents: number };
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
};

export type EarningsView = {
  salesCount: number;
  grossCents: number;
  platformFeeCents: number;
  processingFeeCents: number;
  refundedCents: number;
  chargebackCents: number;
  chargebackFeesCents: number;
  netCents: number;
  availableCents: number;
  pendingCents: number;
  inPayoutCents: number;
  paidOutCents: number;
  holdDays: number;
  minPayoutCents: number;
  payoutEligible: boolean;
  /** Gross of sales that were not (fully) given back; the base for the percentages. */
  keptGrossCents: number;
  platformFeePct: number | null;
  processingFeePct: number | null;
  keepPct: number | null;
};

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export function toEarningsView(s: EarningsSummaryLike): EarningsView {
  const l = s.lifetime;
  const netCents = s.balance.totalCents + l.paidOutCents + l.requestedPayoutCents;
  const keptGrossCents = l.grossCents - l.refundedCents - l.chargebackCents;
  return {
    salesCount: l.salesCount,
    grossCents: l.grossCents,
    platformFeeCents: l.platformFeeCents,
    processingFeeCents: l.processingFeeCents,
    refundedCents: l.refundedCents,
    chargebackCents: l.chargebackCents,
    chargebackFeesCents: keptGrossCents - l.platformFeeCents - l.processingFeeCents - netCents,
    netCents,
    availableCents: s.balance.availableCents,
    pendingCents: s.balance.pendingCents,
    inPayoutCents: l.requestedPayoutCents,
    paidOutCents: l.paidOutCents,
    holdDays: s.holdDays,
    minPayoutCents: s.minPayoutCents,
    payoutEligible: s.payoutEligible,
    keptGrossCents,
    platformFeePct: pct(l.platformFeeCents, keptGrossCents),
    processingFeePct: pct(l.processingFeeCents, keptGrossCents),
    keepPct: pct(netCents, keptGrossCents),
  };
}

/** "$431.00 gross − $43.10 platform fee − $21.56 processing fees = $366.34" (refund / chargeback / chargeback-fee terms only when non-zero). */
export function breakdownLine(b: EarningsView): string {
  const parts = [`${usd(b.grossCents)} gross`, `− ${usd(b.platformFeeCents)} platform fee`, `− ${usd(b.processingFeeCents)} processing fees`];
  if (b.refundedCents) parts.push(`− ${usd(b.refundedCents)} refunded`);
  if (b.chargebackCents) parts.push(`− ${usd(b.chargebackCents)} charged back`);
  if (b.chargebackFeesCents) parts.push(`− ${usd(b.chargebackFeesCents)} chargeback fees`);
  return `${parts.join(" ")} = ${usd(b.netCents)}`;
}

/** Status line for reversed sales; refunds and chargebacks are always named separately. */
export function reversalsLabel(b: Pick<EarningsView, "refundedCents" | "chargebackCents">): string | null {
  const parts = [b.refundedCents && `${usd(b.refundedCents)} refunded`, b.chargebackCents && `${usd(b.chargebackCents)} charged back`].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Honest wording for a balance below zero (refund / chargeback / fee after the money was paid out). */
export function owedLabel(availableCents: number): string | null {
  return availableCents < 0 ? `You owe ${usd(-availableCents)}` : null;
}
