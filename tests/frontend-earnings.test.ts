import { describe, expect, it } from "vitest";
import { breakdownLine, owedLabel, reversalsLabel, toEarningsView, type EarningsSummaryLike } from "../lib/earnings";
import { formatDuration, formatDurationLong, usd } from "../lib/format";

/**
 * lib/earnings.ts has NO money rules, only a mapping of payments' EarningsSummary (GET /api/earnings) to the UI + display maths.
 * The summaries below are what the ledger produces for the demo sellers (see scripts/seed-demo.ts); the numbers were checked by hand:
 * ledger total = SUM(all entries); net = total + paid + open payouts (payouts only move money out of the balance).
 */
const base = { minPayoutCents: 2500, holdDays: 7, payoutEligible: true };

// 30 sales: gross 43100, platform 4310, processing 2155; payouts: 15000 paid + 6000 requested. All sales past the hold.
const clean: EarningsSummaryLike = {
  ...base,
  balance: { pendingCents: 0, availableCents: 36635 - 21000, totalCents: 36635 - 21000 },
  lifetime: { salesCount: 30, grossCents: 43100, platformFeeCents: 4310, processingFeeCents: 2155, refundedCents: 0, chargebackCents: 0, paidOutCents: 15000, requestedPayoutCents: 6000 },
};

describe("toEarningsView: field mapping", () => {
  it("maps ledger figures one-to-one and derives net from the ledger total", () => {
    const v = toEarningsView(clean);
    expect(v).toMatchObject({
      salesCount: 30, grossCents: 43100, platformFeeCents: 4310, processingFeeCents: 2155, refundedCents: 0, chargebackCents: 0,
      availableCents: 15635, pendingCents: 0, inPayoutCents: 6000, paidOutCents: 15000, holdDays: 7, minPayoutCents: 2500, payoutEligible: true,
    });
    expect(v.netCents).toBe(36635); // 43100 - 4310 - 2155
    expect(usd(v.netCents)).toBe("$366.35");
    expect(v.chargebackFeesCents).toBe(0);
  });
  it("keeps platform fee and processing fees separate, with real percentages (no hard-coded 90 %)", () => {
    const v = toEarningsView(clean);
    expect(v.platformFeePct).toBe(10);
    expect(v.processingFeePct).toBe(5);
    expect(v.keepPct).toBe(85);
    expect(breakdownLine(v)).toBe("$431.00 gross − $43.10 platform fee − $21.55 processing fees = $366.35");
  });
  it("available + pending + in payout + paid out = net (nothing is lost or counted twice)", () => {
    const v = toEarningsView(clean);
    expect(v.availableCents + v.pendingCents + v.inPayoutCents + v.paidOutCents).toBe(v.netCents);
  });
});

describe("toEarningsView: cases that used to diverge from the ledger (FE-07)", () => {
  it("money inside the hold shows as pending, not available; open payouts are 'in payout'", () => {
    // net 68.00 in total: $8.00 still inside the 7-day hold, $10.00 available, $50.00 already reserved by a requested payout
    const v = toEarningsView({
      ...base, payoutEligible: false,
      balance: { pendingCents: 800, availableCents: 1000, totalCents: 1800 },
      lifetime: { salesCount: 4, grossCents: 8000, platformFeeCents: 800, processingFeeCents: 400, refundedCents: 0, chargebackCents: 0, paidOutCents: 0, requestedPayoutCents: 5000 },
    });
    expect(v.pendingCents).toBe(800);
    expect(v.availableCents).toBe(1000);
    expect(v.inPayoutCents).toBe(5000);
    expect(v.netCents).toBe(6800); // 8000 - 800 - 400 = 6800
    expect(v.availableCents + v.pendingCents + v.inPayoutCents + v.paidOutCents).toBe(v.netCents);
  });
  it("a PARTIAL refund subtracts the refunded gross once and returns the fee shares (fee totals are already net of them)", () => {
    // $50 sale (fees 5.00 + 2.50, net 42.50), $20 refunded: fee shares returned 2.00 + 1.00 -> fees left 3.00 + 1.50; net left 25.50
    const v = toEarningsView({
      ...base, payoutEligible: true,
      balance: { pendingCents: 0, availableCents: 2550, totalCents: 2550 },
      lifetime: { salesCount: 1, grossCents: 5000, platformFeeCents: 300, processingFeeCents: 150, refundedCents: 2000, chargebackCents: 0, paidOutCents: 0, requestedPayoutCents: 0 },
    });
    expect(v.netCents).toBe(2550);
    expect(v.keptGrossCents).toBe(3000);
    expect(v.chargebackFeesCents).toBe(0);
    expect(breakdownLine(v)).toBe("$50.00 gross − $3.00 platform fee − $1.50 processing fees − $20.00 refunded = $25.50");
    expect(reversalsLabel(v)).toBe("$20.00 refunded");
  });
  it("chargeback fees come out of net and are shown as their own term", () => {
    // $25 sale (fees 2.50 + 1.25), charged back in full, $15 chargeback fee: net = -15.00
    const v = toEarningsView({
      ...base, payoutEligible: false,
      balance: { pendingCents: 0, availableCents: -1500, totalCents: -1500 },
      lifetime: { salesCount: 1, grossCents: 2500, platformFeeCents: 0, processingFeeCents: 0, refundedCents: 0, chargebackCents: 2500, paidOutCents: 0, requestedPayoutCents: 0 },
    });
    expect(v.chargebackFeesCents).toBe(1500);
    expect(v.netCents).toBe(-1500);
    expect(breakdownLine(v)).toBe("$25.00 gross − $0.00 platform fee − $0.00 processing fees − $25.00 charged back − $15.00 chargeback fees = -$15.00");
    expect(reversalsLabel(v)).toBe("$25.00 charged back");
  });
  it("refunds and chargebacks are labelled separately", () => {
    expect(reversalsLabel({ refundedCents: 5000, chargebackCents: 2500 })).toBe("$50.00 refunded · $25.00 charged back");
    expect(reversalsLabel({ refundedCents: 0, chargebackCents: 0 })).toBeNull();
  });
});

describe("negative balance (FE-08)", () => {
  // $60 sale (net 51.00), $51 paid out, then the sale was refunded: available = -51.00
  const owed = toEarningsView({
    ...base, payoutEligible: false,
    balance: { pendingCents: 0, availableCents: -5100, totalCents: -5100 },
    lifetime: { salesCount: 1, grossCents: 6000, platformFeeCents: 0, processingFeeCents: 0, refundedCents: 6000, chargebackCents: 0, paidOutCents: 5100, requestedPayoutCents: 0 },
  });
  it("is passed through unclamped", () => {
    expect(owed.availableCents).toBe(-5100);
    expect(usd(owed.availableCents)).toBe("-$51.00");
    expect(owed.netCents).toBe(0);
  });
  it("has an honest label", () => {
    expect(owedLabel(owed.availableCents)).toBe("You owe $51.00");
    expect(owedLabel(0)).toBeNull();
    expect(owedLabel(100)).toBeNull();
  });
});

describe("empty account", () => {
  it("is all zeros with no percentages", () => {
    const v = toEarningsView({
      ...base, payoutEligible: false, balance: { pendingCents: 0, availableCents: 0, totalCents: 0 },
      lifetime: { salesCount: 0, grossCents: 0, platformFeeCents: 0, processingFeeCents: 0, refundedCents: 0, chargebackCents: 0, paidOutCents: 0, requestedPayoutCents: 0 },
    });
    expect(v).toMatchObject({ netCents: 0, availableCents: 0, chargebackFeesCents: 0, platformFeePct: null, processingFeePct: null, keepPct: null });
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
    expect(formatDuration(3481)).toBe("59 min");
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
  it("long form for screen readers and sentences (also used by the dashboard upload 429 message)", () => {
    expect(formatDurationLong(1)).toBe("1 second");
    expect(formatDurationLong(45)).toBe("45 seconds");
    expect(formatDurationLong(3500)).toBe("59 minutes");
    expect(formatDurationLong(3480)).toBe("58 minutes");
    expect(formatDurationLong(4320)).toBe("1 hour 12 minutes");
    expect(formatDurationLong(7200)).toBe("2 hours");
  });
});
