import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, dbReachable } from "./helpers";

const SECRET = "db-test-webhook-secret-db-test-webhook-secret-123";
const available = await dbReachable();
let dropDb: (() => Promise<void>) | null = null;

// Lazily imported after env is set (config reads env on access, the pg Pool is created on first query).
type Mods = {
  db: typeof import("../../src/server/db");
  wh: typeof import("../../src/server/payments/webhooks");
  ev: typeof import("../../src/server/payments/mock/events");
  co: typeof import("../../src/server/payments/checkout");
  ledger: typeof import("../../src/server/payments/ledger");
  earn: typeof import("../../src/server/payments/earnings");
  payouts: typeof import("../../src/server/payments/payouts");
  refunds: typeof import("../../src/server/payments/refunds");
  sim: typeof import("../../src/server/payments/dev/simulator");
};
let m!: Mods;

beforeAll(async () => {
  if (!available) return;
  const t = await createTestDb("payments");
  dropDb = t.drop;
  Object.assign(process.env, {
    DATABASE_URL: t.url, APP_URL: "http://localhost:3000", PAYMENT_WEBHOOK_SECRET: SECRET, PAYMENT_PROVIDER: "mock",
    RATE_LIMIT_ENABLED: "0", SESSION_SECRET: "x".repeat(40), SIGNED_URL_SECRET: "y".repeat(40),
  });
  delete process.env.MOCK_PROCESSING_FEE_PERCENT;
  m = {
    db: await import("../../src/server/db"),
    wh: await import("../../src/server/payments/webhooks"),
    ev: await import("../../src/server/payments/mock/events"),
    co: await import("../../src/server/payments/checkout"),
    ledger: await import("../../src/server/payments/ledger"),
    earn: await import("../../src/server/payments/earnings"),
    payouts: await import("../../src/server/payments/payouts"),
    refunds: await import("../../src/server/payments/refunds"),
    sim: await import("../../src/server/payments/dev/simulator"),
  };
});
afterAll(async () => {
  if (!available) return;
  await m.db.pool().end();
  await dropDb?.();
});

let counter = 0;
async function seed(opts: { price?: number; verified?: boolean; status?: string } = {}) {
  const n = ++counter;
  const [seller] = await m.db.query<{ id: string }>(
    `INSERT INTO sellers (email, password_hash, display_name, verification_status) VALUES ($1,'x','Seller',$2) RETURNING id`,
    [`s${n}-${Date.now()}@example.test`, opts.verified === false ? "pending" : "verified"]);
  const [drop] = await m.db.query<{ id: string; public_link_id: string }>(
    `INSERT INTO drops (seller_id, public_link_id, title, price_cents, status) VALUES ($1,$2,'Test drop',$3,$4) RETURNING id, public_link_id`,
    [seller.id, `T${String(n).padStart(11, "0")}`, opts.price ?? 2000, opts.status ?? "published"]);
  return { sellerId: seller.id, dropId: drop.id, linkId: drop.public_link_id };
}
const checkout = (s: { dropId: string }, over: Partial<{ email: string; confirmOver18: boolean }> = {}) =>
  m.co.createCheckout({ dropId: s.dropId, email: "Buyer@Example.test", confirmOver18: true, ...over });
const deliver = (event: Record<string, unknown> | import("../../src/server/payments/mock/events").MockWireEvent, opts: { secret?: string; nowSec?: number } = {}) => {
  const signed = m.ev.signMockEvent(event, opts.secret ?? SECRET, { nowSec: opts.nowSec });
  return m.wh.handleWebhook({ providerName: "mock", rawBody: signed.rawBody, headers: new Headers(signed.headers) });
};
const sale = (txId: string, amount: number, eventId?: string) => m.ev.mockEvents.saleSucceeded({ transactionId: txId, amountCents: amount, eventId });
const ledgerOf = (txId: string) =>
  m.db.query<{ entry_type: string; component: string; amount_cents: number }>(`SELECT entry_type, component, amount_cents FROM ledger_entries WHERE transaction_id=$1 ORDER BY id`, [txId]);
const sum = async (txId: string) => (await ledgerOf(txId)).reduce((a, r) => a + r.amount_cents, 0);
const txRow = (id: string) => m.db.queryOne<{ status: string; reversed_cents: number; processor_ref: string | null; failure_code: string | null; amount_cents: number; platform_fee_cents: number; processing_fee_cents: number; seller_net_cents: number }>(`SELECT * FROM transactions WHERE id=$1`, [id]);
const logRows = (txId?: string) => m.db.query<{ outcome: string; outcome_detail: string | null; signature_valid: boolean; event_type: string | null }>(
  txId ? `SELECT * FROM webhook_events WHERE transaction_id=$1 ORDER BY received_at, id` : `SELECT * FROM webhook_events ORDER BY received_at, id`, txId ? [txId] : []);
const countAll = async (t: string) => Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) AS n FROM ${t}`))!.n);

describe.skipIf(!available)("checkout (DB)", () => {
  it("creates a PENDING transaction priced from the DB with fee snapshot ($20: 2.40 / 2.00 / 15.60)", async () => {
    const s = await seed({ price: 2000 });
    const out = await checkout(s);
    expect(out).toMatchObject({ provider: "mock", amountCents: 2000, currency: "USD" });
    expect(out.checkoutUrl).toMatch(/^http:\/\/localhost:3000\/pay\/mock\/mocksess_[0-9a-f]{32}$/);
    const t = await txRow(out.transactionId);
    expect(t).toMatchObject({ status: "pending", amount_cents: 2000, platform_fee_cents: 200, processing_fee_cents: 240, seller_net_cents: 1560 });
    expect(await ledgerOf(out.transactionId)).toEqual([]); // nothing on the ledger until a verified webhook
    const row = await m.db.queryOne<{ buyer_email: string; fee_percent: string; processing_fee_percent: string; buyer_confirmed_18_at: string }>(`SELECT * FROM transactions WHERE id=$1`, [out.transactionId]);
    expect(row).toMatchObject({ buyer_email: "buyer@example.test", fee_percent: "10.00", processing_fee_percent: "12.00" });
    expect(row!.buyer_confirmed_18_at).toBeTruthy();
  });
  it("platform fee percent comes from platform_settings (not hardcoded); processing fee override too", async () => {
    const s = await seed({ price: 1999 });
    await m.db.query(`UPDATE platform_settings SET fee_percent = 7.5, processing_fee_percent = 14.5 WHERE id=1`);
    try {
      const out = await checkout(s);
      const t = await txRow(out.transactionId);
      expect(t).toMatchObject({ platform_fee_cents: 150, processing_fee_cents: 290, seller_net_cents: 1559 }); // 149.925->150, 289.855->290
      expect(t!.platform_fee_cents + t!.processing_fee_cents + t!.seller_net_cents).toBe(1999);
    } finally {
      await m.db.query(`UPDATE platform_settings SET fee_percent = 10, processing_fee_percent = NULL WHERE id=1`);
    }
  });
  it("rejects: unpublished drop, unverified seller, missing 18+ confirmation, unknown drop", async () => {
    await expect(checkout(await seed({ status: "draft" }))).rejects.toMatchObject({ status: 404 });
    await expect(checkout(await seed({ verified: false }))).rejects.toMatchObject({ status: 409, code: "seller_not_verified" });
    await expect(checkout(await seed(), { confirmOver18: false })).rejects.toMatchObject({ status: 400, code: "age_confirmation_required" });
    await expect(m.co.createCheckout({ dropId: "00000000-0000-4000-8000-000000000000", email: "a@b.co", confirmOver18: true })).rejects.toMatchObject({ status: 404 });
    await expect(m.co.createCheckout({ linkId: "nope", email: "a@b.co", confirmOver18: true })).rejects.toMatchObject({ status: 404 });
  });
  it("works via public link id too", async () => {
    const s = await seed({ price: 500 });
    const out = await m.co.createCheckout({ linkId: s.linkId, email: "a@b.co", confirmOver18: true });
    expect(out.amountCents).toBe(500);
  });
});

describe.skipIf(!available)("webhook: happy path, idempotency, signatures (DB)", () => {
  it("signed sale webhook -> succeeded + exactly one 3-line ledger posting that sums to seller_net", async () => {
    const s = await seed({ price: 2000 });
    const { transactionId: id } = await checkout(s);
    const r = await deliver(sale(id, 2000));
    expect(r).toMatchObject({ status: 200, body: { received: true, outcome: "processed" } });
    const t = await txRow(id);
    expect(t).toMatchObject({ status: "succeeded", processor_ref: m.ev.mockSaleId(id) });
    expect(await ledgerOf(id)).toEqual([
      { entry_type: "sale_credit", component: "gross", amount_cents: 2000 },
      { entry_type: "platform_fee", component: "platform_fee", amount_cents: -200 },
      { entry_type: "processing_fee", component: "processing_fee", amount_cents: -240 },
    ]);
    expect(await sum(id)).toBe(1560);
    const log = await logRows(id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ outcome: "processed", signature_valid: true, event_type: "sale_succeeded" });
  });

  it("same event delivered twice = one charge, one ledger posting; 2nd answers 200/duplicate; both are logged", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    const ev = sale(id, 2000, "evt_dupe_1");
    const a = await deliver(ev), b = await deliver(ev);
    expect(a.body.outcome).toBe("processed");
    expect(b).toMatchObject({ status: 200, body: { received: true, outcome: "duplicate" } });
    expect((await ledgerOf(id)).length).toBe(3);
    expect(await sum(id)).toBe(1560);
    const all = await m.db.query<{ outcome: string }>(`SELECT outcome FROM webhook_events WHERE provider_event_id='evt_dupe_1' ORDER BY received_at, id`);
    expect(all.map((x) => x.outcome)).toEqual(["processed", "duplicate"]);
  });

  it("the same processor transaction + type under a NEW event id is also a duplicate (processors without event ids)", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    expect((await deliver(sale(id, 2000, "evt_a"))).body.outcome).toBe("processed");
    expect((await deliver(sale(id, 2000, "evt_b"))).body.outcome).toBe("duplicate");
    expect((await ledgerOf(id)).length).toBe(3);
  });

  it("CONCURRENT delivery of one event (12 parallel) -> exactly one processed, rest duplicate, one ledger posting", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    const ev = sale(id, 2000, "evt_concurrent");
    const rs = await Promise.all(Array.from({ length: 12 }, () => deliver(ev)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const outcomes = rs.map((r) => r.body.outcome);
    expect(outcomes.filter((o) => o === "processed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(11);
    expect((await ledgerOf(id)).length).toBe(3);
    expect(await sum(id)).toBe(1560);
    expect((await txRow(id))!.status).toBe("succeeded");
  });

  it("CONCURRENT distinct event ids for the same sale (replay under new ids) still post once", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => deliver(sale(id, 2000, `evt_cc_${i}`))));
    expect(rs.filter((r) => r.body.outcome === "processed")).toHaveLength(1);
    expect((await ledgerOf(id)).length).toBe(3);
  });

  it("bad signature: 401, NO state change (tx still pending, no ledger), logged as rejected with signature_valid=false", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    const before = await countAll("ledger_entries");
    const r = await deliver(sale(id, 2000), { secret: "totally-wrong-secret-totally-wrong-secret" });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("invalid_signature");
    expect((await txRow(id))!.status).toBe("pending");
    expect(await countAll("ledger_entries")).toBe(before);
    const rej = await m.db.query<{ outcome: string; signature_valid: boolean; payload_sha256: string }>(`SELECT * FROM webhook_events WHERE outcome='rejected' ORDER BY received_at DESC LIMIT 1`);
    expect(rej[0]).toMatchObject({ outcome: "rejected", signature_valid: false });
    expect(rej[0].payload_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tampered body (valid MAC for a different body) -> 401, no state change", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    const signed = m.ev.signMockEvent(sale(id, 100), SECRET);
    const tampered = signed.rawBody.replace('"amount_cents":100', '"amount_cents":2000');
    expect(tampered).not.toBe(signed.rawBody);
    const r = await m.wh.handleWebhook({ providerName: "mock", rawBody: tampered, headers: new Headers(signed.headers) });
    expect(r.status).toBe(401);
    expect((await txRow(id))!.status).toBe("pending");
  });

  it("stale timestamp (replayed old capture) -> 401, no state change", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    const r = await deliver(sale(id, 2000), { nowSec: Math.floor(Date.now() / 1000) - 3600 });
    expect(r.status).toBe(401);
    expect((await txRow(id))!.status).toBe("pending");
  });

  it("authentic but malformed payload -> 400, logged rejected, no state change", async () => {
    const r = await deliver({ nope: true });
    expect(r.status).toBe(400);
    const last = await m.db.queryOne<{ outcome: string; signature_valid: boolean }>(`SELECT * FROM webhook_events ORDER BY received_at DESC, id DESC LIMIT 1`);
    expect(last).toMatchObject({ outcome: "rejected", signature_valid: true });
  });

  it("unknown provider -> 404; no rows", async () => {
    const before = await countAll("webhook_events");
    const r = await m.wh.handleWebhook({ providerName: "segpay", rawBody: "{}", headers: new Headers() });
    expect(r.status).toBe(404);
    expect(await countAll("webhook_events")).toBe(before);
  });

  it("amount mismatch (event amount != DB price) -> rejected, tx stays pending, no ledger", async () => {
    const s = await seed({ price: 2000 });
    const { transactionId: id } = await checkout(s);
    const r = await deliver(sale(id, 100));
    expect(r.body).toMatchObject({ outcome: "rejected", detail: "amount_mismatch" });
    expect((await txRow(id))!.status).toBe("pending");
    expect(await ledgerOf(id)).toEqual([]);
  });

  it("unknown transaction (valid signature, no such reference) -> 200 ignored, nothing created", async () => {
    const before = await countAll("ledger_entries");
    const r = await deliver(sale("99999999-9999-4999-8999-999999999999", 2000));
    expect(r).toMatchObject({ status: 200, body: { outcome: "ignored", detail: "unknown_transaction" } });
    expect(await countAll("ledger_entries")).toBe(before);
    const r2 = await deliver(m.ev.mockEvents.saleSucceeded({ transactionId: "x", amountCents: 100, reference: "not-a-uuid" }));
    expect(r2.body.outcome).toBe("ignored");
  });

  it("declined card: sale_failed -> failed with failure_code, no ledger entries; a later duplicate is harmless", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    const ev = m.ev.mockEvents.saleFailed({ transactionId: id, amountCents: 2000, failureCode: "card_declined", eventId: "evt_decl" });
    expect((await deliver(ev)).body.outcome).toBe("processed");
    expect(await txRow(id)).toMatchObject({ status: "failed", failure_code: "card_declined" });
    expect(await ledgerOf(id)).toEqual([]);
    expect((await deliver(ev)).body.outcome).toBe("duplicate");
  });

  it("a failed delivery attempt (DB error) leaves no dedupe claim: the processor's retry is processed", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    // make the first attempt blow up inside the transaction
    await m.db.query(`ALTER TABLE ledger_entries ADD CONSTRAINT tmp_break CHECK (false) NOT VALID`);
    const bad = await deliver(sale(id, 2000, "evt_retry"));
    await m.db.query(`ALTER TABLE ledger_entries DROP CONSTRAINT tmp_break`);
    expect(bad.status).toBe(500);
    expect((await txRow(id))!.status).toBe("pending");
    expect(await ledgerOf(id)).toEqual([]);
    const claims = await m.db.query(`SELECT 1 FROM webhook_events WHERE provider_event_id='evt_retry' AND dedupe_claim`);
    expect(claims).toHaveLength(0);
    const errLog = await m.db.query(`SELECT 1 FROM webhook_events WHERE provider_event_id='evt_retry' AND outcome='error'`);
    expect(errLog).toHaveLength(1);
    expect((await deliver(sale(id, 2000, "evt_retry"))).body.outcome).toBe("processed");
    expect((await ledgerOf(id)).length).toBe(3);
  });
});

describe.skipIf(!available)("refunds, chargebacks, ordering (DB)", () => {
  async function paid(price = 2000) {
    const s = await seed({ price });
    const { transactionId: id } = await checkout(s);
    await deliver(sale(id, price));
    return { ...s, id };
  }
  const refund = (id: string, amount: number | null, refundId = `mockrf_${Math.random()}`) =>
    deliver(m.ev.mockEvents.refund({ transactionId: id, refundId, amountCents: amount }));

  it("full refund reverses the ledger exactly: net 0, status refunded, reversed_cents = amount", async () => {
    const p = await paid(2000);
    const r = await refund(p.id, 2000);
    expect(r.body.outcome).toBe("processed");
    expect(await txRow(p.id)).toMatchObject({ status: "refunded", reversed_cents: 2000 });
    expect(await sum(p.id)).toBe(0);
    const rows = await ledgerOf(p.id);
    expect(rows.filter((x) => x.entry_type === "refund_reversal").map((x) => x.amount_cents).sort((a, b) => a - b)).toEqual([-2000, 200, 240]);
  });

  it("partial refunds in sequence (incl. 1-cent steps) total exactly the original; over-refund rejected; ledger never off by a cent", async () => {
    const p = await paid(1999);
    const t0 = (await txRow(p.id))!;
    for (const amt of [333, 1, 1, 700]) expect((await refund(p.id, amt)).body.outcome).toBe("processed");
    expect((await txRow(p.id))!.status).toBe("succeeded");
    expect((await txRow(p.id))!.reversed_cents).toBe(1035);
    const over = await refund(p.id, 964);
    expect(over.body.outcome).toBe("processed"); // exactly the remainder is fine
    expect((await txRow(p.id))!.status).toBe("refunded");
    expect(await sum(p.id)).toBe(0);
    const tooMuch = await refund(p.id, 1);
    expect(tooMuch.body).toMatchObject({ outcome: "rejected", detail: "over_refund" });
    expect(await sum(p.id)).toBe(0);
    expect(t0.seller_net_cents).toBe(1999 - t0.platform_fee_cents - t0.processing_fee_cents);
  });

  it("refund exceeding what remains after a partial -> rejected, ledger unchanged", async () => {
    const p = await paid(1000);
    await refund(p.id, 600);
    const before = await sum(p.id);
    expect((await refund(p.id, 401)).body).toMatchObject({ outcome: "rejected", detail: "over_refund" });
    expect(await sum(p.id)).toBe(before);
    expect((await txRow(p.id))!.reversed_cents).toBe(600);
  });

  it("refund with unspecified amount = everything still refundable", async () => {
    const p = await paid(1000);
    await refund(p.id, 250);
    await refund(p.id, null);
    expect(await txRow(p.id)).toMatchObject({ status: "refunded", reversed_cents: 1000 });
    expect(await sum(p.id)).toBe(0);
  });

  it("duplicate refund event (same id) refunds once", async () => {
    const p = await paid(1000);
    const ev = m.ev.mockEvents.refund({ transactionId: p.id, refundId: "mockrf_same", amountCents: 400, eventId: "evt_rf_dupe" });
    expect((await deliver(ev)).body.outcome).toBe("processed");
    expect((await deliver(ev)).body.outcome).toBe("duplicate");
    // same processor refund id under a new event id: also a duplicate
    expect((await deliver({ ...ev, id: "evt_rf_dupe2" })).body.outcome).toBe("duplicate");
    expect((await txRow(p.id))!.reversed_cents).toBe(400);
  });

  it("OUT OF ORDER: refund before sale is parked (200), then applied automatically when the sale lands -> net 0, refunded", async () => {
    const s = await seed({ price: 2000 });
    const { transactionId: id } = await checkout(s);
    const r = await refund(id, 2000, "mockrf_early");
    expect(r).toMatchObject({ status: 200, body: { outcome: "parked", detail: "sale_not_seen_yet" } });
    expect(await ledgerOf(id)).toEqual([]);
    expect((await txRow(id))!.status).toBe("pending");
    const sale1 = await deliver(sale(id, 2000));
    expect(sale1.body.outcome).toBe("processed");
    expect(await txRow(id)).toMatchObject({ status: "refunded", reversed_cents: 2000 });
    expect(await sum(id)).toBe(0);
    const log = await m.db.query<{ outcome: string; outcome_detail: string | null; event_type: string }>(`SELECT * FROM webhook_events WHERE transaction_id=$1 ORDER BY received_at, id`, [id]);
    expect(log.map((l) => `${l.event_type}:${l.outcome}`).sort()).toEqual(["refunded:processed", "sale_succeeded:processed"]);
    expect(log.find((l) => l.event_type === "refunded")!.outcome_detail).toBe("applied_after_sale");
    // redelivering the early refund is now a duplicate, not a second refund
    expect((await refund(id, 2000, "mockrf_early")).body.outcome).not.toBe("processed");
    expect(await sum(id)).toBe(0);
  });

  it("OUT OF ORDER with only the processor-side sale id (no reference): parked, then applied when the sale arrives", async () => {
    const s = await seed({ price: 1500 });
    const { transactionId: id } = await checkout(s);
    const ev = m.ev.mockEvents.refund({ transactionId: id, refundId: "mockrf_noref", amountCents: 500 });
    (ev.data as { reference: string | null }).reference = null;
    expect((await deliver(ev)).body).toMatchObject({ outcome: "parked" });
    await deliver(sale(id, 1500));
    expect(await txRow(id)).toMatchObject({ status: "succeeded", reversed_cents: 500 });
    expect(await sum(id)).toBe((await txRow(id))!.seller_net_cents - Math.round(((await txRow(id))!.seller_net_cents * 500) / 1500));
  });

  it("chargeback: status charged_back, full reversal, optional chargeback fee from settings", async () => {
    const p = await paid(2000);
    await m.db.query(`UPDATE platform_settings SET chargeback_fee_cents = 1500 WHERE id=1`);
    try {
      const r = await deliver(m.ev.mockEvents.chargeback({ transactionId: p.id, amountCents: null }));
      expect(r.body.outcome).toBe("processed");
    } finally {
      await m.db.query(`UPDATE platform_settings SET chargeback_fee_cents = 0 WHERE id=1`);
    }
    expect(await txRow(p.id)).toMatchObject({ status: "charged_back", reversed_cents: 2000 });
    const rows = await ledgerOf(p.id);
    expect(rows.filter((x) => x.entry_type === "chargeback_reversal")).toHaveLength(3);
    expect(rows.find((x) => x.entry_type === "chargeback_fee")!.amount_cents).toBe(-1500);
    expect(await sum(p.id)).toBe(-1500); // sale fully reversed; only the dispute fee remains
  });

  it("refund after a chargeback cannot reverse more than the sale", async () => {
    const p = await paid(1000);
    await deliver(m.ev.mockEvents.chargeback({ transactionId: p.id, amountCents: null }));
    expect((await refund(p.id, 100)).body).toMatchObject({ outcome: "rejected", detail: "over_refund" });
  });

  it("refund/chargeback for a failed sale or unknown sale are ignored, not applied", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    await deliver(m.ev.mockEvents.saleFailed({ transactionId: id, amountCents: 2000, failureCode: "card_declined" }));
    expect((await refund(id, 100)).body).toMatchObject({ outcome: "ignored", detail: "reversal_of_failed_sale" });
    expect((await refund("99999999-9999-4999-8999-999999999999", 100)).body).toMatchObject({ outcome: "ignored" });
    expect(await ledgerOf(id)).toEqual([]);
  });

  it("requestRefund (provider call) validates but does not move the ledger; the webhook does", async () => {
    const p = await paid(2000);
    const before = await sum(p.id);
    const r = await m.refunds.requestRefund(p.id, { amountCents: 500 });
    expect(r).toMatchObject({ amountCents: 500, status: "accepted" });
    expect(await sum(p.id)).toBe(before);
    await expect(m.refunds.requestRefund(p.id, { amountCents: 2001 })).rejects.toMatchObject({ code: "over_refund" });
    const sim = await m.sim.simulateRefund(p.id, 500);
    expect(sim.webhook.outcome).toBe("processed");
    expect((await txRow(p.id))!.reversed_cents).toBe(500);
  });

  it("ledger_entries is append-only (UPDATE/DELETE/TRUNCATE are blocked)", async () => {
    const p = await paid(1000);
    await expect(m.db.query(`UPDATE ledger_entries SET amount_cents = amount_cents + 1 WHERE transaction_id=$1`, [p.id])).rejects.toThrow(/append-only/);
    await expect(m.db.query(`DELETE FROM ledger_entries WHERE transaction_id=$1`, [p.id])).rejects.toThrow(/append-only/);
    await expect(m.db.query(`TRUNCATE ledger_entries`)).rejects.toThrow(/append-only/);
  });

  it("DB refuses a second sale posting for the same transaction even if the app tried", async () => {
    const p = await paid(1000);
    await expect(m.db.withTx(async (c) => {
      const tx = (await c.query(`SELECT ${m.ledger.TX_COLS} FROM transactions WHERE id=$1`, [p.id])).rows[0];
      await m.ledger.postSale(c, tx, null, 7);
    })).rejects.toThrow(/duplicate key/);
  });
});

describe.skipIf(!available)("balances, hold period, payouts, earnings (DB)", () => {
  async function paidFor(sellerId: string, dropId: string, price: number) {
    const out = await m.co.createCheckout({ dropId, email: "b@example.test", confirmOver18: true });
    await deliver(sale(out.transactionId, price));
    return out.transactionId;
  }

  it("pending vs available follows the hold period; balance = sum of ledger", async () => {
    const s = await seed({ price: 2000 });
    const id = await paidFor(s.sellerId, s.dropId, 2000);
    let b = await m.ledger.getBalance(m.db.pool(), s.sellerId);
    expect(b).toEqual({ pendingCents: 1560, availableCents: 0, totalCents: 1560 });
    // move the hold into the past (ledger rows are append-only, so use a hold of 0 for a second sale instead)
    await m.db.query(`UPDATE platform_settings SET payout_hold_days = 0 WHERE id=1`);
    try { await paidFor(s.sellerId, s.dropId, 2000); } finally { await m.db.query(`UPDATE platform_settings SET payout_hold_days = 7 WHERE id=1`); }
    b = await m.ledger.getBalance(m.db.pool(), s.sellerId);
    expect(b).toEqual({ pendingCents: 1560, availableCents: 1560, totalCents: 3120 });
    // default hold is 7 days
    const row = await m.db.queryOne<{ days: number }>(`SELECT round(extract(epoch FROM (available_at - created_at))/86400)::int AS days FROM ledger_entries WHERE transaction_id=$1 AND entry_type='sale_credit'`, [id]);
    expect(row!.days).toBe(7);
  });

  it("refund inside the hold window reduces PENDING, not available", async () => {
    const s = await seed({ price: 2000 });
    const id = await paidFor(s.sellerId, s.dropId, 2000);
    await deliver(m.ev.mockEvents.refund({ transactionId: id, refundId: "mockrf_hold", amountCents: 2000 }));
    expect(await m.ledger.getBalance(m.db.pool(), s.sellerId)).toEqual({ pendingCents: 0, availableCents: 0, totalCents: 0 });
  });

  it("payouts: minimum enforced, only available balance, record-only flow requested->approved->paid, failure returns the funds", async () => {
    const s = await seed({ price: 5000 });
    await m.db.query(`UPDATE platform_settings SET payout_hold_days = 0 WHERE id=1`);
    try { await paidFor(s.sellerId, s.dropId, 5000); } finally { await m.db.query(`UPDATE platform_settings SET payout_hold_days = 7 WHERE id=1`); }
    const avail = (await m.ledger.getBalance(m.db.pool(), s.sellerId)).availableCents;
    expect(avail).toBe(3900); // 5000 - 500 - 600
    await expect(m.payouts.requestPayout(s.sellerId, 2499)).rejects.toMatchObject({ code: "below_minimum_payout" });
    await expect(m.payouts.requestPayout(s.sellerId, avail + 1)).rejects.toMatchObject({ code: "insufficient_available_balance" });
    const p1 = await m.payouts.requestPayout(s.sellerId, 2500);
    expect(p1.status).toBe("requested");
    expect((await m.ledger.getBalance(m.db.pool(), s.sellerId)).availableCents).toBe(1400); // funds reserved at request time
    await expect(m.payouts.markPayoutPaid(p1.id)).rejects.toMatchObject({ code: "bad_payout_state" }); // not approved yet
    const ap = await m.payouts.approvePayout(p1.id);
    expect(ap).toMatchObject({ status: "approved", provider: "mock" });
    expect(ap.provider_ref).toMatch(/^mockpo_/);
    expect((await m.payouts.markPayoutPaid(p1.id)).status).toBe("paid");
    await expect(m.payouts.markPayoutFailed(p1.id, "x")).rejects.toMatchObject({ code: "bad_payout_state" });
    // below the minimum remaining -> can't request 1400
    await expect(m.payouts.requestPayout(s.sellerId)).rejects.toMatchObject({ code: "below_minimum_payout" });
    // failed payout returns funds
    await m.db.query(`UPDATE platform_settings SET min_payout_cents = 100 WHERE id=1`);
    try {
      const p2 = await m.payouts.requestPayout(s.sellerId, 1000);
      expect((await m.ledger.getBalance(m.db.pool(), s.sellerId)).availableCents).toBe(400);
      expect((await m.payouts.markPayoutFailed(p2.id, "bank rejected")).status).toBe("failed");
      expect((await m.ledger.getBalance(m.db.pool(), s.sellerId)).availableCents).toBe(1400);
    } finally { await m.db.query(`UPDATE platform_settings SET min_payout_cents = 2500 WHERE id=1`); }
  });

  it("concurrent payout requests cannot spend the same balance twice", async () => {
    const s = await seed({ price: 5000 });
    await m.db.query(`UPDATE platform_settings SET payout_hold_days = 0 WHERE id=1`);
    try { await paidFor(s.sellerId, s.dropId, 5000); } finally { await m.db.query(`UPDATE platform_settings SET payout_hold_days = 7 WHERE id=1`); }
    const rs = await Promise.allSettled(Array.from({ length: 5 }, () => m.payouts.requestPayout(s.sellerId, 3900)));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await m.ledger.getBalance(m.db.pool(), s.sellerId)).availableCents).toBe(0);
  });

  it("negative balance is allowed after a refund/chargeback post-payout and is deducted from future earnings", async () => {
    const s = await seed({ price: 5000 });
    await m.db.query(`UPDATE platform_settings SET payout_hold_days = 0 WHERE id=1`);
    let id1 = "";
    try { id1 = await paidFor(s.sellerId, s.dropId, 5000); } finally { await m.db.query(`UPDATE platform_settings SET payout_hold_days = 7 WHERE id=1`); }
    const p = await m.payouts.requestPayout(s.sellerId, 3900); // pays out everything
    await m.payouts.approvePayout(p.id); await m.payouts.markPayoutPaid(p.id);
    await deliver(m.ev.mockEvents.refund({ transactionId: id1, refundId: "mockrf_neg", amountCents: 5000 }));
    expect(await m.ledger.getBalance(m.db.pool(), s.sellerId)).toEqual({ pendingCents: 0, availableCents: -3900, totalCents: -3900 });
    await expect(m.payouts.requestPayout(s.sellerId)).rejects.toMatchObject({ status: 400 });
    // a new sale lands (pending) -> total improves; once available it offsets the deficit
    await paidFor(s.sellerId, s.dropId, 5000);
    const b = await m.ledger.getBalance(m.db.pool(), s.sellerId);
    expect(b.totalCents).toBe(0);
    const e = await m.earn.getEarningsSummary(s.sellerId);
    expect(e.payoutEligible).toBe(false);
  });

  it("earnings summary: lifetime totals reconcile with the ledger; no buyer emails leak", async () => {
    const s = await seed({ price: 2000 });
    await m.db.query(`UPDATE platform_settings SET payout_hold_days = 0 WHERE id=1`);
    let a = "", b2 = "";
    try { a = await paidFor(s.sellerId, s.dropId, 2000); b2 = await paidFor(s.sellerId, s.dropId, 2000); } finally { await m.db.query(`UPDATE platform_settings SET payout_hold_days = 7 WHERE id=1`); }
    await deliver(m.ev.mockEvents.refund({ transactionId: a, refundId: "mockrf_e1", amountCents: 500 }));
    void b2;
    const e = await m.earn.getEarningsSummary(s.sellerId);
    expect(e.lifetime).toMatchObject({ salesCount: 2, grossCents: 4000, refundedCents: 500, chargebackCents: 0 });
    const feesNet = e.lifetime.platformFeeCents + e.lifetime.processingFeeCents;
    expect(feesNet).toBe(2 * (200 + 240) - (50 + 60)); // net of the fee share handed back by the $5 refund
    expect(e.balance.totalCents).toBe(e.lifetime.grossCents - e.lifetime.refundedCents - feesNet);
    expect(e.balance.totalCents).toBe(await sumSeller(s.sellerId));
    expect(JSON.stringify(e)).not.toContain("@example.test");
    expect(e.recent).toHaveLength(2);
  });
});

async function sumSeller(sellerId: string) {
  return Number((await m.db.queryOne<{ s: string }>(`SELECT COALESCE(SUM(amount_cents),0) AS s FROM ledger_entries WHERE seller_id=$1`, [sellerId]))!.s);
}

describe.skipIf(!available)("reconciliation log", () => {
  it("records every received delivery with provider, event id, type, signature_valid, outcome, tx link and payload hash", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    const ev = sale(id, 2000, "evt_recon");
    await deliver(ev); await deliver(ev);
    await deliver(sale(id, 2000, "evt_recon_bad"), { secret: "wrong-wrong-wrong-wrong-wrong-wrong-wrong" });
    const rows = await m.db.query<{ provider: string; provider_event_id: string | null; event_type: string | null; signature_valid: boolean; outcome: string; transaction_id: string | null; payload_sha256: string; received_at: string; payload: string | null }>(
      `SELECT * FROM webhook_events WHERE provider_event_id='evt_recon' OR payload LIKE '%evt_recon_bad%' ORDER BY received_at, id`);
    expect(rows.map((r) => r.outcome)).toEqual(["processed", "duplicate", "rejected"]);
    expect(rows.map((r) => r.signature_valid)).toEqual([true, true, false]);
    expect(rows[0]).toMatchObject({ provider: "mock", provider_event_id: "evt_recon", event_type: "sale_succeeded", transaction_id: id });
    expect(rows[1].transaction_id).toBe(id);
    expect(rows[0].payload_sha256).toBe(rows[1].payload_sha256);
    expect(rows.every((r) => r.received_at)).toBe(true);
    expect(rows[0].payload).toContain("evt_recon");
  });
});
