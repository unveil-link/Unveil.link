import { describe, expect, it } from "vitest";
import { breakdownLine, earningsBreakdown, reversalsLabel, type EarningsTotals } from "../lib/earnings";
import { formatDuration, formatDurationLong, usd } from "../lib/format";

// Seed data (scripts/seed-demo.ts, seller "maya"): 30 sales, gross 43100, platform 4310, processing 2156; payouts paid 15000, pending 6000.
const seed: EarningsTotals = {
  grossCents: 43100, platformFeeCents: 4310, processingFeeCents: 2156, refundedCents: 0, chargebackCents: 0, paidOutCents: 15000, pendingPayoutCents: 6000,
};

describe("earningsBreakdown", () => {
  it("reconciles with the seed data (gross − platform − processing = net; net − paid − pending = available)", () => {
    const b = earningsBreakdown(seed);
    expect(b.netCents).toBe(36634);
    expect(b.availableCents).toBe(15634);
    expect(usd(b.netCents)).toBe("$366.34");
    expect(usd(b.availableCents)).toBe("$156.34");
  });
  it("shows the real shares instead of a hard-coded 90 %", () => {
    const b = earningsBreakdown(seed);
    expect(b.platformFeePct).toBe(10);
    expect(b.keepPct).toBe(85);
    expect(b.processingFeePct).toBe(5);
  });
  it("platform fee and processing fees stay separate figures", () => {
    const b = earningsBreakdown(seed);
    expect(b.platformFeeCents).toBe(4310);
    expect(b.processingFeeCents).toBe(2156);
    expect(breakdownLine(b)).toBe("$431.00 gross − $43.10 platform fee − $21.56 processing fees = $366.34");
  });
  it("takes a refund / chargeback off once, from gross (fee totals are already net of the fee shares returned)", () => {
    // Same 30 sales plus a $50 refunded and a $50 charged-back sale. Their fees were returned, so the fee totals are unchanged.
    const b = earningsBreakdown({ ...seed, grossCents: 43100 + 10000, refundedCents: 5000, chargebackCents: 5000 });
    expect(b.netCents).toBe(36634);
    expect(b.availableCents).toBe(15634);
    expect(b.keptGrossCents).toBe(43100);
    expect(b.keepPct).toBe(85); // rates are measured on completed sales, so reversals don't distort them
    expect(breakdownLine(b)).toBe("$531.00 gross − $43.10 platform fee − $21.56 processing fees − $50.00 refunded − $50.00 charged back = $366.34");
  });
  it("labels refunds and chargebacks separately, never lumped", () => {
    expect(reversalsLabel({ refundedCents: 5000, chargebackCents: 0 })).toBe("$50.00 refunded");
    expect(reversalsLabel({ refundedCents: 0, chargebackCents: 2500 })).toBe("$25.00 charged back");
    expect(reversalsLabel({ refundedCents: 5000, chargebackCents: 2500 })).toBe("$50.00 refunded · $25.00 charged back");
    expect(reversalsLabel({ refundedCents: 0, chargebackCents: 0 })).toBeNull();
  });
  it("handles an empty account and a negative balance (reversal after payout)", () => {
    const z = earningsBreakdown({ grossCents: 0, platformFeeCents: 0, processingFeeCents: 0, refundedCents: 0, chargebackCents: 0, paidOutCents: 0, pendingPayoutCents: 0 });
    expect(z).toMatchObject({ netCents: 0, availableCents: 0, platformFeePct: null, keepPct: null });
    expect(earningsBreakdown({ ...seed, paidOutCents: 40000 }).availableCents).toBe(36634 - 40000 - 6000);
  });
});

describe("formatDuration", () => {
  it("keeps short waits in seconds", () => {
    expect(formatDuration(1)).toBe("1s");
    expect(formatDuration(8)).toBe("8s");
    expect(formatDuration(60)).toBe("60s");
    expect(formatDuration(120)).toBe("120s");
  });
  it("switches to minutes, rounding up", () => {
    expect(formatDuration(121)).toBe("3 min");
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(3481)).toBe("59 min"); // the 58-min wait QA saw, 3481 s = 58.02 min -> never understated
    expect(formatDuration(3480)).toBe("58 min");
    expect(formatDuration(3540)).toBe("59 min");
  });
  it("switches to hours + minutes", () => {
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(3601)).toBe("1 h 1 min");
    expect(formatDuration(4320)).toBe("1 h 12 min");
    expect(formatDuration(7200)).toBe("2 h");
  });
  it("never goes negative / shows fractional input sensibly", () => {
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(0.2)).toBe("1s");
  });
  it("long form for screen readers", () => {
    expect(formatDurationLong(1)).toBe("1 second");
    expect(formatDurationLong(45)).toBe("45 seconds");
    expect(formatDurationLong(3480)).toBe("58 minutes");
    expect(formatDurationLong(4320)).toBe("1 hour 12 minutes");
    expect(formatDurationLong(7200)).toBe("2 hours");
  });
});
