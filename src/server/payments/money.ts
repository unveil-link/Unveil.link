/**
 * All money math for the payments layer. PURE (no I/O), integer cents only, no floats in the money path.
 *
 * ROUNDING RULE (the only one in the codebase): every percentage-of-amount is computed on integers as
 *     round_half_up(cents * bps / 10000)  =  floor((cents * bps + 5000) / 10000)
 * where `bps` is the percent in hundredths of a percent (12 % = 1200, 7.5 % = 750, 14.5 % = 1450; the DB stores
 * percentages as numeric(5,2), so 2 decimals is exactly the precision that exists). Half a cent rounds UP.
 *
 * Sale split of a gross amount G:
 *     processing_fee = pct(G, processing_bps)
 *     platform_fee   = min(pct(G, platform_bps), G - processing_fee)   // the cap only bites if the two rates sum to > 100 %
 *     seller_net     = G - platform_fee - processing_fee                // remainder, so G == net + platform + processing ALWAYS
 * Both fees are taken on the gross (spec example: $20.00 -> processing $2.40, platform $2.00, seller $15.60).
 *
 * Refunds are tracked CUMULATIVELY so partial-refund sequences never drift: after R of G cents are refunded the seller
 * has given back
 *     net_cum  = round_half_up(net * R / G)
 *     fees_cum = R - net_cum                      (the fee share returned to the seller, in total)
 *     proc_cum = round_half_up(processing * fees_cum / fees)    platform_cum = fees_cum - proc_cum
 * Each refund posts the DIFFERENCE between cumulative(after) and cumulative(before). All of these are non-decreasing
 * in R and equal the original components at R == G, so any sequence of refunds that sums to G reverses exactly the
 * original postings (not one cent created or lost), and R can never exceed G (callers get `over_refund`).
 */

export const BPS_SCALE = 10_000;

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

/** Parses "12", "7.5", "14.50", 10 -> basis points (1200, 750, 1450, 1000). Throws on >2 decimals, negatives, >100. */
export function percentToBps(p: string | number): number {
  const s = typeof p === "number" ? String(p) : p.trim();
  const m = s.match(/^(\d{1,3})(?:\.(\d{1,2})0*)?$/);
  if (!m) throw new Error(`invalid percent: ${JSON.stringify(p)}`);
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  if (bps > BPS_SCALE) throw new Error(`percent out of range: ${JSON.stringify(p)}`);
  return bps;
}

/** round_half_up(num / den) for non-negative integers. */
export function divRoundHalfUp(num: number, den: number): number {
  if (!isInt(num) || !isInt(den) || num < 0 || den <= 0) throw new Error("divRoundHalfUp: bad operands");
  return Math.floor((2 * num + den) / (2 * den));
}

/** round_half_up(cents * bps / 10000). */
export function pctOf(cents: number, bps: number): number {
  if (!isInt(cents) || cents < 0) throw new Error("cents must be a non-negative integer");
  if (!isInt(bps) || bps < 0 || bps > BPS_SCALE) throw new Error("bps out of range");
  return divRoundHalfUp(cents * bps, BPS_SCALE);
}

export interface SaleSplit {
  grossCents: number;
  platformFeeCents: number;
  processingFeeCents: number;
  sellerNetCents: number;
}

export function computeSplit(grossCents: number, platformBps: number, processingBps: number): SaleSplit {
  if (!isInt(grossCents) || grossCents <= 0) throw new Error("gross must be a positive integer number of cents");
  const processingFeeCents = pctOf(grossCents, processingBps);
  const platformFeeCents = Math.min(pctOf(grossCents, platformBps), grossCents - processingFeeCents);
  return {
    grossCents,
    platformFeeCents,
    processingFeeCents,
    sellerNetCents: grossCents - platformFeeCents - processingFeeCents,
  };
}

export interface Reversal {
  /** Gross cents handed back to the buyer (= the refunded/charged-back amount). Posted as a debit to the seller. */
  grossCents: number;
  /** Platform fee given back to the seller (credit). */
  platformFeeCents: number;
  /** Processing fee given back to the seller (credit). */
  processingFeeCents: number;
  /** Net effect on the seller's balance = -(gross - platform - processing). */
  sellerNetReversedCents: number;
}

/** Cumulative seller-net / fee shares after `refundedCents` of the sale have been reversed. */
export function cumulativeShares(s: SaleSplit, refundedCents: number) {
  if (!isInt(refundedCents) || refundedCents < 0 || refundedCents > s.grossCents) throw new Error("refunded out of range");
  const netCum = divRoundHalfUp(s.sellerNetCents * refundedCents, s.grossCents);
  const feesCum = refundedCents - netCum;
  const fees = s.platformFeeCents + s.processingFeeCents;
  const procCum = fees > 0 ? divRoundHalfUp(s.processingFeeCents * feesCum, fees) : 0;
  return { netCum, platformCum: feesCum - procCum, processingCum: procCum };
}

export class OverRefundError extends Error {
  constructor(public remainingCents: number, public requestedCents: number) {
    super(`refund of ${requestedCents} exceeds the ${remainingCents} cents still refundable`);
  }
}

/** The reversal to post for refunding `amountCents` more, given `alreadyRefundedCents` so far. Throws OverRefundError. */
export function reversalFor(s: SaleSplit, alreadyRefundedCents: number, amountCents: number): Reversal {
  if (!isInt(amountCents) || amountCents <= 0) throw new Error("refund amount must be a positive integer number of cents");
  if (!isInt(alreadyRefundedCents) || alreadyRefundedCents < 0) throw new Error("bad alreadyRefundedCents");
  const remaining = s.grossCents - alreadyRefundedCents;
  if (amountCents > remaining) throw new OverRefundError(remaining, amountCents);
  const before = cumulativeShares(s, alreadyRefundedCents);
  const after = cumulativeShares(s, alreadyRefundedCents + amountCents);
  const platformFeeCents = after.platformCum - before.platformCum;
  const processingFeeCents = after.processingCum - before.processingCum;
  return {
    grossCents: amountCents,
    platformFeeCents,
    processingFeeCents,
    sellerNetReversedCents: amountCents - platformFeeCents - processingFeeCents,
  };
}

export const formatUsd = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
