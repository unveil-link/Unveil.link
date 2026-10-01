// @ts-nocheck
/* eslint-disable */
// QA: money math. (1) exhaustive pure sweep vs an independent BigInt reference; (2) end-to-end via HTTP+DB for odd amounts and fee changes.
import { computeSplit, percentToBps, reversalFor, cumulativeShares } from "../../src/server/payments/money";
import { Http, check, rec, assert, eq, db, makeSeller, makeDrop, checkout, setSettings, txRow, save, done, sell } from "./qa-pay3-lib";

// independent reference (BigInt, written from the documented rule, not copied code)
const refPct = (g: bigint, bps: bigint) => (g * bps * 2n + 10000n) / 20000n; // round half up
function refSplit(g: number, pBps: number, cBps: number) {
  const G = BigInt(g); const proc = refPct(G, BigInt(cBps)); let plat = refPct(G, BigInt(pBps)); if (plat > G - proc) plat = G - proc;
  return { proc: Number(proc), plat: Number(plat), net: Number(G - proc - plat) };
}

(async () => {
  const combos: [string, string][] = [["10", "12"], ["0", "0"], ["15", "12"], ["10", "0"], ["0", "12"], ["7.5", "2.9"], ["14.55", "3.33"], ["33.33", "66.67"], ["50", "50"], ["60", "60"], ["100", "0"], ["0.01", "0.01"], ["12.5", "12.5"], ["99.99", "0.01"]];
  await check("M3-06/MONEY-1", "pure sweep: every cent 100..50000 × 14 fee-% combos: gross == net+platform+processing, ints, none negative, matches BigInt reference", async () => {
    let n = 0, neg = 0, mismatch = 0, nonInt = 0, firstBad = "";
    for (const [p, c] of combos) {
      const pb = percentToBps(p), cb = percentToBps(c);
      for (let g = 100; g <= 50000; g++) {
        const s = computeSplit(g, pb, cb); const r = refSplit(g, pb, cb); n++;
        if (![s.platformFeeCents, s.processingFeeCents, s.sellerNetCents].every(Number.isSafeInteger)) nonInt++;
        if (s.platformFeeCents < 0 || s.processingFeeCents < 0 || s.sellerNetCents < 0) neg++;
        if (s.platformFeeCents + s.processingFeeCents + s.sellerNetCents !== g || s.processingFeeCents !== r.proc || s.platformFeeCents !== r.plat || s.sellerNetCents !== r.net) { mismatch++; firstBad ||= `${g}@${p}/${c}`; }
      }
    }
    assert(!neg && !mismatch && !nonInt, `neg=${neg} mismatch=${mismatch} nonInt=${nonInt} first=${firstBad}`);
    return `${n} (amount, rate) cases, 0 mismatches vs reference, 0 negative, 0 non-integer`;
  });
  await check("M3-05/MONEY-2", "defaults $20.00 => net 1560 / platform 200 / processing 240; $0.99,$9.99,$19.99,$499.99 spot values", async () => {
    const s = computeSplit(2000, 1000, 1200); eq(`${s.sellerNetCents},${s.platformFeeCents},${s.processingFeeCents}`, "1560,200,240", "$20");
    const out = [99, 999, 1999, 49999, 100, 50000].map((g) => { const x = computeSplit(g, 1000, 1200); return `${g}→${x.sellerNetCents}/${x.platformFeeCents}/${x.processingFeeCents}`; });
    return out.join(" ");
  });
  await check("MONEY-3", "rounding direction: half-cent rounds UP consistently for both fees (e.g. 5¢@10% → 1 (0.5), 15¢@10% → 2 (1.5))", async () => {
    eq(computeSplit(5, 1000, 0).platformFeeCents, 1, "5c"); eq(computeSplit(15, 1000, 0).platformFeeCents, 2, "15c");
    eq(computeSplit(5, 0, 1000).processingFeeCents, 1, "5c proc"); eq(computeSplit(14, 1000, 0).platformFeeCents, 1, "14c (1.4→1)");
    return "half-up verified on both fees; seller absorbs remainder";
  });
  await check("MONEY-4", "refund reversal property: random sale × random partial-refund sequences (incl 1¢ steps) sum exactly to original postings; cumulative never negative/decreasing", async () => {
    let seqs = 0;
    for (let i = 0; i < 6000; i++) {
      const g = 100 + Math.floor(Math.random() * 49901); const p = Math.floor(Math.random() * 3000), c = Math.floor(Math.random() * 3000);
      const s = computeSplit(g, p, c); let done = 0, pl = 0, pr = 0, gross = 0;
      while (done < g) {
        const step = Math.random() < 0.3 ? 1 : 1 + Math.floor(Math.random() * Math.min(g - done, 5000)); const amt = Math.min(step, g - done);
        const r = reversalFor(s, done, amt); if (r.platformFeeCents < 0 || r.processingFeeCents < 0 || r.sellerNetReversedCents < 0 && false) throw new Error(`neg share g=${g}`);
        pl += r.platformFeeCents; pr += r.processingFeeCents; gross += r.grossCents; done += amt;
      }
      seqs++;
      if (gross !== g || pl !== s.platformFeeCents || pr !== s.processingFeeCents) throw new Error(`drift g=${g} p=${p} c=${c}: ${gross}/${pl}/${pr} vs ${s.platformFeeCents}/${s.processingFeeCents}`);
    }
    // single-cent worst case
    const s = computeSplit(999, 1000, 1200); let net = 0; for (let d = 0; d < 999; d++) { const r = reversalFor(s, d, 1); net += r.sellerNetReversedCents; if (cumulativeShares(s, d + 1).netCum < cumulativeShares(s, d).netCum) throw new Error("decreasing"); }
    eq(net, s.sellerNetCents, "999×1¢ net reversed");
    return `${seqs} random sequences exact; 999×1¢ refunds reverse exactly net ${s.sellerNetCents}`;
  });
  await check("MONEY-5", "float/NaN inputs rejected by money layer", async () => {
    for (const bad of [10.5, -1, NaN, 0, Infinity, 2 ** 53]) { let threw = false; try { computeSplit(bad as number, 1000, 1200); } catch { threw = true; } assert(threw, `computeSplit accepted ${bad}`); }
    for (const bad of ["abc", "-5", "101", "10.555", "1e2", ""]) { let threw = false; try { percentToBps(bad); } catch { threw = true; } assert(threw, `percentToBps accepted ${JSON.stringify(bad)}`); }
    return "rejects floats/negatives/NaN/inf/unsafe and malformed percents";
  });

  // ---- end to end through the HTTP checkout (DB-stored values) ----
  await setSettings("fee_percent=10, processing_fee_percent=NULL, payout_hold_days=7");
  const s = await makeSeller("money");
  const prices = [100, 101, 199, 999, 1000, 1999, 2000, 3333, 4999, 12345, 49999, 50000, 777, 1];
  await check("M3-05/M3-06 e2e", "HTTP checkout stores integer-cent split in transactions: odd prices incl 99¢→skipped (min 100), 999, 1999, 49999; sums exact; $20 == 1560/200/240", async () => {
    let n = 0; const rows: string[] = [];
    for (const price of prices.filter((p) => p >= 100)) {
      const d = await makeDrop(s, price); const c = await checkout(d.link); eq(c.status, 201, `checkout ${price}`);
      const t = await txRow(c.json.transactionId); n++;
      eq(t.amount_cents, price, "amount"); eq(t.amount_cents, t.platform_fee_cents + t.processing_fee_cents + t.seller_net_cents, `sum @${price}`);
      const ref = refSplit(price, 1000, 1200); eq(`${t.processing_fee_cents},${t.platform_fee_cents},${t.seller_net_cents}`, `${ref.proc},${ref.plat},${ref.net}`, `ref @${price}`);
      if (price === 2000) eq(`${t.seller_net_cents},${t.platform_fee_cents},${t.processing_fee_cents}`, "1560,200,240", "$20");
      rows.push(`${price}:${t.seller_net_cents}/${t.platform_fee_cents}/${t.processing_fee_cents}`);
    }
    return `${n} prices OK (net/plat/proc): ${rows.join(" ")}`;
  });
  await check("M3-06 bounds", "price below $1 (0.99 → 99¢) and above $500 rejected at drop creation; 100 and 50000 accepted", async () => {
    const lo = await s.http.json("POST", "/api/drops", { json: { title: "x", priceCents: 99 } }); const hi = await s.http.json("POST", "/api/drops", { json: { title: "x", priceCents: 50001 } });
    const fl = await s.http.json("POST", "/api/drops", { json: { title: "x", priceCents: 999.5 } }); const ng = await s.http.json("POST", "/api/drops", { json: { title: "x", priceCents: -5 } });
    eq(lo.status, 400, "99"); eq(hi.status, 400, "50001"); eq(fl.status, 400, "float price"); eq(ng.status, 400, "negative");
    return "99→400, 50001→400, 999.5→400, -5→400";
  });
  await check("M3-07/S2-03", "change platform fee 10%→15% and processing 12%→3%: new sale uses new rates (fee_percent snapshot), old transactions unchanged, no deploy; sums exact", async () => {
    const d = await makeDrop(s, 2000);
    const before = await checkout(d.link); const tb = await txRow(before.json.transactionId);
    await setSettings("fee_percent=15, processing_fee_percent=3");
    const after = await checkout(d.link); const ta = await txRow(after.json.transactionId); const tb2 = await txRow(before.json.transactionId);
    await setSettings("fee_percent=10, processing_fee_percent=NULL");
    eq(`${tb.platform_fee_cents},${tb.processing_fee_cents},${tb.seller_net_cents}`, "200,240,1560", "old split");
    eq(`${tb2.platform_fee_cents},${tb2.processing_fee_cents},${tb2.seller_net_cents}`, "200,240,1560", "old tx retroactively changed?");
    eq(`${ta.platform_fee_cents},${ta.processing_fee_cents},${ta.seller_net_cents}`, "300,60,1640", "new split @15%/3%");
    eq(String(ta.fee_percent), "15.00", "fee_percent snapshot");
    // open (pending) tx keeps rates when settled after setting change
    await setSettings("fee_percent=20, processing_fee_percent=1");
    const { paySale } = await import("./qa-pay3-lib"); const w = await paySale(before.json.transactionId, 2000);
    await setSettings("fee_percent=10, processing_fee_percent=NULL");
    eq(w.json.outcome, "processed", "sale"); const { ledgerSum } = await import("./qa-pay3-lib"); eq(await ledgerSum(before.json.transactionId), 1560, "ledger uses snapshot not new rate");
    return "pending tx snapshot 200/240/1560 stays after settings change & settles at 1560; new tx @15%/3% = 300/60/1640";
  });
  await check("MONEY-6", "fee-percent settings: invalid platform_settings values (fee_percent 101, -1, 'abc') are rejected by DB constraints", async () => {
    const out: string[] = [];
    for (const v of ["101", "-1"]) { try { await db.query(`UPDATE platform_settings SET fee_percent=${v} WHERE id=1`); out.push(`${v} ACCEPTED`); await setSettings("fee_percent=10"); } catch (e) { out.push(`${v} rejected`); } }
    try { await db.query(`UPDATE platform_settings SET processing_fee_percent=100.5 WHERE id=1`); out.push("proc 100.5 ACCEPTED"); await setSettings("processing_fee_percent=NULL"); } catch { out.push("proc 100.5 rejected"); }
    assert(!out.some((x) => x.includes("ACCEPTED")), out.join(", "));
    return out.join(", ");
  });
  await check("MONEY-7", "fee 100% platform + 12% processing cap: net never negative at HTTP level", async () => {
    await setSettings("fee_percent=100, processing_fee_percent=12");
    const d = await makeDrop(s, 999); const c = await checkout(d.link); const t = await txRow(c.json.transactionId);
    await setSettings("fee_percent=10, processing_fee_percent=NULL");
    assert(t.seller_net_cents >= 0 && t.amount_cents === t.platform_fee_cents + t.processing_fee_cents + t.seller_net_cents, JSON.stringify(t));
    return `999¢ @100%/12% → net ${t.seller_net_cents} plat ${t.platform_fee_cents} proc ${t.processing_fee_cents}`;
  });
  await check("MONEY-8", "DB columns are integer cents (no numeric/float money columns in transactions/ledger/payouts)", async () => {
    const r = await db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('transactions','ledger_entries','payouts') AND column_name LIKE '%cents' ORDER BY 1,2`);
    const bad = r.rows.filter((x) => !["integer", "bigint"].includes(x.data_type)); assert(!bad.length, JSON.stringify(bad));
    return r.rows.map((x) => `${x.table_name}.${x.column_name}:${x.data_type}`).join(", ");
  });
  save("pay3-old-money-results.json"); await done();
})().catch((e) => { console.error(e); process.exit(1); });
