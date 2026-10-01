import { describe, expect, it } from "vitest";
import {
  computeSplit, cumulativeShares, divRoundHalfUp, OverRefundError, pctOf, percentToBps, reversalFor, type SaleSplit,
} from "../src/server/payments/money";

const PCTS = ["0", "7.5", "10", "12", "14.5", "100", "33.33", "0.01"];

function* amounts() {
  for (let c = 100; c <= 50_000; c += c < 2_000 ? 1 : 137) yield c; // every cent up to $20, then a stride, incl. odd values
  yield 50_000; yield 49_999; yield 100; yield 101; yield 1999; yield 2000;
}

describe("percentToBps / rounding primitives", () => {
  it("parses percents with up to 2 decimals", () => {
    expect(percentToBps("10")).toBe(1000);
    expect(percentToBps("7.5")).toBe(750);
    expect(percentToBps("14.50")).toBe(1450);
    expect(percentToBps(12)).toBe(1200);
    expect(percentToBps("100")).toBe(10_000);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("0.01")).toBe(1);
  });
  it("rejects garbage, negatives, > 100 and > 2 decimals", () => {
    for (const bad of ["", "-1", "100.01", "101", "1.234", "abc", "1e2", " "]) expect(() => percentToBps(bad)).toThrow();
  });
  it("round-half-up at exact half-cent boundaries", () => {
    // 1 cent * 50% = 0.5 -> 1 ; 3 cents * 50% = 1.5 -> 2 ; 1 cent * 49.99% -> 0 ; 1 cent * 50.01% -> 1
    expect(pctOf(1, 5000)).toBe(1);
    expect(pctOf(3, 5000)).toBe(2);
    expect(pctOf(1, 4999)).toBe(0);
    expect(pctOf(1, 5001)).toBe(1);
    // 7.5% of $0.10 = 0.75c -> 1 ; 7.5% of $0.06 = 0.45c -> 0 ; 10% of 5c = 0.5c -> 1 ; 10% of 4c = 0.4 -> 0
    expect(pctOf(10, 750)).toBe(1);
    expect(pctOf(6, 750)).toBe(0);
    expect(pctOf(5, 1000)).toBe(1);
    expect(pctOf(4, 1000)).toBe(0);
    // 14.5% of 1999 = 289.855 -> 290 ; 12% of 1999 = 239.88 -> 240 ; 12% of 1996 = 239.52 -> 240; 12% of 1995 = 239.4 -> 239
    expect(pctOf(1999, 1450)).toBe(290);
    expect(pctOf(1995, 1200)).toBe(239);
  });
  it("divRoundHalfUp is exact for halves", () => {
    expect(divRoundHalfUp(1, 2)).toBe(1);
    expect(divRoundHalfUp(5, 10)).toBe(1);
    expect(divRoundHalfUp(4, 10)).toBe(0);
    expect(divRoundHalfUp(15, 10)).toBe(2);
    expect(divRoundHalfUp(0, 7)).toBe(0);
  });
  it("is exact on the largest amount (no float drift): 50000c * 100% and 33.33%", () => {
    expect(pctOf(50_000, 10_000)).toBe(50_000);
    expect(pctOf(50_000, 3333)).toBe(16_665); // 16665.0
  });
});

describe("the spec's worked example: $20.00 sale at 10% platform / 12% processing", () => {
  it("-> processing $2.40, platform $2.00, seller $15.60", () => {
    const s = computeSplit(2000, percentToBps("10"), percentToBps("12"));
    expect(s).toEqual({ grossCents: 2000, platformFeeCents: 200, processingFeeCents: 240, sellerNetCents: 1560 });
  });
});

describe("computeSplit: every cent accounted for (property-style, $1.00 – $500.00)", () => {
  it("gross == seller_net + platform_fee + processing_fee, no negatives, for all amounts x all percent pairs", () => {
    let n = 0;
    const bad: string[] = []; // plain checks (not expect() per case) keep a 100k+ case sweep fast
    for (const g of amounts()) {
      for (const plat of PCTS) {
        for (const proc of PCTS) {
          const s = computeSplit(g, percentToBps(plat), percentToBps(proc));
          const ok =
            s.sellerNetCents + s.platformFeeCents + s.processingFeeCents === g &&
            s.platformFeeCents >= 0 && s.processingFeeCents >= 0 && s.sellerNetCents >= 0 && // fees are capped so net never goes negative
            Object.values(s).every(Number.isInteger);
          if (!ok) bad.push(`${g} ${plat}% ${proc}% -> ${JSON.stringify(s)}`);
          n++;
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(n).toBeGreaterThan(100_000);
  });
  it("0% fees -> seller keeps everything; 100% platform -> seller nets 0 (when processing is 0)", () => {
    expect(computeSplit(12_345, 0, 0)).toMatchObject({ platformFeeCents: 0, processingFeeCents: 0, sellerNetCents: 12_345 });
    expect(computeSplit(12_345, 10_000, 0)).toMatchObject({ platformFeeCents: 12_345, sellerNetCents: 0 });
  });
  it("rates summing past 100% are capped: platform fee is clipped, net is 0, never negative", () => {
    const s = computeSplit(1001, percentToBps("100"), percentToBps("12"));
    expect(s.processingFeeCents).toBe(120);
    expect(s.platformFeeCents).toBe(881);
    expect(s.sellerNetCents).toBe(0);
  });
  it("rounding error is bounded: seller_net is within 1 cent of the ideal unrounded net, each fee within half a cent of ideal", () => {
    // NB: net is NOT strictly monotonic in the price (each fee rounds on its own, so net can dip 1c between adjacent prices);
    // what the rule guarantees is this bound.
    for (let g = 100; g <= 50_000; g += 7) {
      for (const [pl, pr] of [["10", "12"], ["7.5", "14.5"], ["33.33", "0.01"]]) {
        const s = computeSplit(g, percentToBps(pl), percentToBps(pr));
        expect(Math.abs(s.processingFeeCents - (g * Number(pr)) / 100)).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(s.platformFeeCents - (g * Number(pl)) / 100)).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(s.sellerNetCents - (g * (100 - Number(pl) - Number(pr))) / 100)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
  it("rejects non-positive / non-integer gross", () => {
    for (const bad of [0, -1, 1.5, NaN]) expect(() => computeSplit(bad, 1000, 1200)).toThrow();
  });
});

function sumReversals(s: SaleSplit, parts: number[]) {
  let done = 0;
  const tot = { gross: 0, platform: 0, processing: 0, net: 0 };
  for (const p of parts) {
    const r = reversalFor(s, done, p);
    expect(r.grossCents).toBe(p);
    expect(r.platformFeeCents).toBeGreaterThanOrEqual(0);
    expect(r.processingFeeCents).toBeGreaterThanOrEqual(0);
    expect(r.grossCents - r.platformFeeCents - r.processingFeeCents).toBe(r.sellerNetReversedCents);
    expect(r.sellerNetReversedCents).toBeGreaterThanOrEqual(0);
    tot.gross += r.grossCents; tot.platform += r.platformFeeCents; tot.processing += r.processingFeeCents; tot.net += r.sellerNetReversedCents;
    done += p;
  }
  return tot;
}

describe("refund / chargeback reversals", () => {
  it("full refund reverses exactly the original postings", () => {
    const s = computeSplit(2000, 1000, 1200);
    const r = reversalFor(s, 0, 2000);
    expect(r).toEqual({ grossCents: 2000, platformFeeCents: 200, processingFeeCents: 240, sellerNetReversedCents: 1560 });
  });
  it("50% partial refund of the $20 example", () => {
    const s = computeSplit(2000, 1000, 1200);
    expect(reversalFor(s, 0, 1000)).toEqual({ grossCents: 1000, platformFeeCents: 100, processingFeeCents: 120, sellerNetReversedCents: 780 });
  });
  it("any split of a sale into refunds sums to EXACTLY the original postings (random sequences, many sales)", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 4000; i++) {
      const g = 100 + Math.floor(rnd() * 49_901);
      const plat = PCTS[Math.floor(rnd() * PCTS.length)], proc = PCTS[Math.floor(rnd() * PCTS.length)];
      const s = computeSplit(g, percentToBps(plat), percentToBps(proc));
      const parts: number[] = [];
      let left = g;
      while (left > 0) {
        const p = rnd() < 0.2 ? left : 1 + Math.floor(rnd() * left);
        parts.push(p);
        left -= p;
      }
      const t = sumReversals(s, parts);
      expect(t).toEqual({ gross: g, platform: s.platformFeeCents, processing: s.processingFeeCents, net: s.sellerNetCents });
    }
  });
  it("one-cent-at-a-time refunds of small sales also total exactly the original", () => {
    for (const g of [100, 101, 333, 999, 1000]) {
      const s = computeSplit(g, 1450, 750);
      const t = sumReversals(s, Array(g).fill(1));
      expect(t).toEqual({ gross: g, platform: s.platformFeeCents, processing: s.processingFeeCents, net: s.sellerNetCents });
    }
  });
  it("cumulative shares are non-decreasing in the refunded amount (so each refund's fee share is >= 0)", () => {
    const s = computeSplit(1999, 1000, 1200);
    let p = cumulativeShares(s, 0);
    expect(p).toEqual({ netCum: 0, platformCum: 0, processingCum: 0 });
    for (let r = 1; r <= s.grossCents; r++) {
      const c = cumulativeShares(s, r);
      expect(c.netCum).toBeGreaterThanOrEqual(p.netCum);
      expect(c.platformCum).toBeGreaterThanOrEqual(p.platformCum);
      expect(c.processingCum).toBeGreaterThanOrEqual(p.processingCum);
      p = c;
    }
    expect(p).toEqual({ netCum: s.sellerNetCents, platformCum: s.platformFeeCents, processingCum: s.processingFeeCents });
  });
  it("never over-refunds: exceeding the remainder throws OverRefundError with the remainder; exact remainder is fine", () => {
    const s = computeSplit(1000, 1000, 1200);
    expect(() => reversalFor(s, 0, 1001)).toThrow(OverRefundError);
    expect(() => reversalFor(s, 600, 401)).toThrow(OverRefundError);
    expect(reversalFor(s, 600, 400).grossCents).toBe(400);
    expect(() => reversalFor(s, 1000, 1)).toThrow(OverRefundError);
    try { reversalFor(s, 600, 401); } catch (e) { expect((e as OverRefundError).remainingCents).toBe(400); }
  });
  it("rejects non-positive and fractional amounts", () => {
    const s = computeSplit(1000, 1000, 1200);
    for (const bad of [0, -5, 0.5]) expect(() => reversalFor(s, 0, bad)).toThrow();
  });
  it("0% fee sale: refunds reverse gross only", () => {
    const s = computeSplit(2500, 0, 0);
    expect(reversalFor(s, 0, 1234)).toEqual({ grossCents: 1234, platformFeeCents: 0, processingFeeCents: 0, sellerNetReversedCents: 1234 });
  });
  it("a sale whose net is 0 (fees == gross) reverses to fees only", () => {
    const s = computeSplit(777, 10_000, 0);
    const t = sumReversals(s, [100, 200, 477]);
    expect(t).toEqual({ gross: 777, platform: 777, processing: 0, net: 0 });
  });
});
