import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, dbReachable } from "./helpers";

const SECRET = "db-test-webhook-secret-db-test-webhook-secret-123";
const available = await dbReachable();

// Test seam for the NEW-4 race tests: lets a test park a login AFTER its (real) bcrypt comparison and BEFORE the session insert. Inert unless a gate is set.
const gate: { hold: (() => Promise<void>) | null } = { hold: null };
vi.mock("../../src/server/auth/password", async (orig) => {
  const a = await orig<typeof import("../../src/server/auth/password")>();
  return { ...a, verifyPassword: async (pw: string, hash: string | null) => { const r = await a.verifyPassword(pw, hash); if (gate.hold) await gate.hold(); return r; } };
});
let dropDb: (() => Promise<void>) | null = null;

// Lazily imported after env is set (config reads env on access, the pg Pool is created on first query).
type Mods = {
  adm: typeof import("../../src/server/admin/auth");
  admq: typeof import("../../src/server/admin/queries");
  sess: typeof import("../../src/server/auth/session");
  jan: typeof import("../../src/server/payments/janitor");
  db: typeof import("../../src/server/db");
  wh: typeof import("../../src/server/payments/webhooks");
  ev: typeof import("../../src/server/payments/mock/events");
  co: typeof import("../../src/server/payments/checkout");
  ledger: typeof import("../../src/server/payments/ledger");
  earn: typeof import("../../src/server/payments/earnings");
  payouts: typeof import("../../src/server/payments/payouts");
  refunds: typeof import("../../src/server/payments/refunds");
  sim: typeof import("../../src/server/payments/dev/simulator");
  auditMod: typeof import("../../src/server/admin/audit");
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
    adm: await import("../../src/server/admin/auth"),
    admq: await import("../../src/server/admin/queries"),
    sess: await import("../../src/server/auth/session"),
    jan: await import("../../src/server/payments/janitor"),
    db: await import("../../src/server/db"),
    wh: await import("../../src/server/payments/webhooks"),
    ev: await import("../../src/server/payments/mock/events"),
    co: await import("../../src/server/payments/checkout"),
    ledger: await import("../../src/server/payments/ledger"),
    earn: await import("../../src/server/payments/earnings"),
    payouts: await import("../../src/server/payments/payouts"),
    refunds: await import("../../src/server/payments/refunds"),
    sim: await import("../../src/server/payments/dev/simulator"),
    auditMod: await import("../../src/server/admin/audit"),
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

// =====================================================================================================================
// QA round 1 fixes
// =====================================================================================================================
const idemCo = (s: { dropId: string }, key?: string | null, email = "buyer@example.test", buyerToken?: string | null) =>
  m.co.createCheckout({ dropId: s.dropId, email, confirmOver18: true, idempotencyKey: key, buyerToken });
const TOKEN_A = "A".repeat(43), TOKEN_B = "B".repeat(43);
const pendingCount = async (dropId: string) => Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) AS n FROM transactions WHERE drop_id=$1 AND status='pending'`, [dropId]))!.n);
const setSetting = (col: string, v: number) => m.db.query(`UPDATE platform_settings SET ${col} = $1 WHERE id=1`, [v]);

describe.skipIf(!available)("QA-1 checkout idempotency / double submit", () => {
  it("concurrent identical requests from the SAME client (20, buyer token, no key) -> exactly ONE pending transaction and one session", async () => {
    const s = await seed();
    const rs = await Promise.all(Array.from({ length: 20 }, () => idemCo(s, null, "buyer@example.test", TOKEN_A)));
    expect(new Set(rs.map((r) => r.transactionId)).size).toBe(1);
    expect(new Set(rs.map((r) => r.checkoutUrl)).size).toBe(1);
    expect(rs.filter((r) => !r.reused)).toHaveLength(1);
    expect(await pendingCount(s.dropId)).toBe(1);
  });
  it("same Idempotency-Key concurrently or later -> same txn/session; another buyer with the same key is independent", async () => {
    const s = await seed();
    const rs = await Promise.all(Array.from({ length: 10 }, () => idemCo(s, "key-abc-123")));
    expect(new Set(rs.map((r) => r.transactionId)).size).toBe(1);
    const again = await idemCo(s, "key-abc-123");
    expect(again.transactionId).toBe(rs[0].transactionId);
    expect(again.checkoutUrl).toBe(rs[0].checkoutUrl);
    const other = await idemCo(s, "key-abc-123", "other@example.test");
    expect(other.transactionId).not.toBe(rs[0].transactionId);
  });
  it("same key but a different drop -> 409 idempotency_key_reused; malformed key -> 400", async () => {
    const a = await seed(), b = await seed();
    await idemCo(a, "key-xyz");
    await expect(idemCo(b, "key-xyz")).rejects.toMatchObject({ status: 409, code: "idempotency_key_reused" });
    await expect(idemCo(a, "bad key with spaces")).rejects.toMatchObject({ status: 400, code: "invalid_idempotency_key" });
    await expect(idemCo(a, "x".repeat(129))).rejects.toMatchObject({ status: 400 });
  });
  it("different buyers on one drop each get their own session; a PAID checkout does not block a new purchase", async () => {
    const s = await seed();
    const a = await idemCo(s, null, "a@example.test"), b = await idemCo(s, null, "b@example.test");
    expect(a.transactionId).not.toBe(b.transactionId);
    await deliver(sale(a.transactionId, 2000));
    const again = await idemCo(s, null, "a@example.test");
    expect(again.transactionId).not.toBe(a.transactionId); // buying the same drop again after success is a new purchase
  });
  it("a dead keyed checkout (failed/expired) releases the key: the retry gets a FRESH session", async () => {
    const s = await seed();
    const first = await idemCo(s, "retry-key");
    await m.db.query(`UPDATE transactions SET status='failed', failure_code='session_expired' WHERE id=$1`, [first.transactionId]);
    const second = await idemCo(s, "retry-key");
    expect(second.transactionId).not.toBe(first.transactionId);
    expect(second.reused).toBe(false);
  });
  it("DB backstop: a second pending row for the same drop+buyer+client is refused by the unique index", async () => {
    const s = await seed();
    const a = await idemCo(s, null, "buyer@example.test", TOKEN_A);
    await expect(m.db.query(
      `INSERT INTO transactions (drop_id, seller_id, buyer_email, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents, status, provider, buyer_token_hash)
       SELECT drop_id, seller_id, buyer_email, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents, 'pending', provider, buyer_token_hash FROM transactions WHERE id=$1`, [a.transactionId],
    )).rejects.toMatchObject({ code: "23505" });
  });
});

describe.skipIf(!available)("QA-2 dedupe: rejected / ignored events never block a later valid one", () => {
  it("amount_mismatch (same processor txn id) then the correct event with a NEW event id -> processed, tx succeeded", async () => {
    const s = await seed({ price: 2000 });
    const { transactionId: id } = await checkout(s);
    const bad = await deliver(sale(id, 1, "evt_mm_1"));
    expect(bad.body).toMatchObject({ outcome: "rejected", detail: "amount_mismatch" });
    const good = await deliver(sale(id, 2000, "evt_mm_2"));
    expect(good.body.outcome).toBe("processed");
    expect((await txRow(id))!.status).toBe("succeeded");
    expect(await sum(id)).toBe(1560);
    // rejected row stays in the log but no longer holds the claim
    const rej = await m.db.queryOne<{ dedupe_claim: boolean; outcome: string }>(`SELECT dedupe_claim, outcome FROM webhook_events WHERE provider_event_id='evt_mm_1'`);
    expect(rej).toEqual({ dedupe_claim: false, outcome: "rejected" });
  });
  it("the SAME event id can be re-delivered after a rejection (processor fixed + retried): processed once", async () => {
    const s = await seed({ price: 2000 });
    const { transactionId: id } = await checkout(s);
    await deliver(sale(id, 1, "evt_same_id")); // rejected
    expect((await deliver(sale(id, 2000, "evt_same_id"))).body.outcome).toBe("processed");
    expect((await deliver(sale(id, 2000, "evt_same_id"))).body.outcome).toBe("duplicate");
    expect((await ledgerOf(id)).length).toBe(3);
  });
  it("ignored/unknown_transaction event, then the real sale for the same processor txn id -> processed", async () => {
    const s = await seed({ price: 2000 });
    const { transactionId: id } = await checkout(s);
    const ghost = m.ev.mockEvents.saleSucceeded({ transactionId: id, amountCents: 2000, reference: "99999999-9999-4999-8999-999999999999", saleId: m.ev.mockSaleId(id), eventId: "evt_ghost" });
    expect((await deliver(ghost)).body).toMatchObject({ outcome: "ignored", detail: "unknown_transaction" });
    expect((await deliver(sale(id, 2000, "evt_real"))).body.outcome).toBe("processed");
    expect((await txRow(id))!.status).toBe("succeeded");
  });
  it("a genuine sale delivered again under several different event ids after success -> exactly one ledger posting", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    expect((await deliver(sale(id, 2000, "evt_g1"))).body.outcome).toBe("processed");
    for (const e of ["evt_g2", "evt_g3", "evt_g4"]) expect((await deliver(sale(id, 2000, e))).body.outcome).toBe("duplicate");
    expect((await ledgerOf(id)).length).toBe(3);
    expect(await sum(id)).toBe(1560);
  });
  it("12 concurrent good deliveries mixed with 12 concurrent bad ones: exactly one posting, tx succeeded", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    const jobs = [
      ...Array.from({ length: 12 }, (_, i) => deliver(sale(id, 1, `evt_bad_${i}`))),
      ...Array.from({ length: 12 }, (_, i) => deliver(sale(id, 2000, `evt_good_${i}`))),
    ];
    const rs = await Promise.all(jobs);
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect((await ledgerOf(id)).length).toBe(3);
    expect((await txRow(id))!.status).toBe("succeeded");
  });
  it("confirmTransaction not approved (transient) is rejected without burning the claim: the retry succeeds", async () => {
    const reg = await import("../../src/server/payments/registry");
    const prov = reg.findProvider("mock")!;
    let approved = false;
    (prov as { confirmTransaction?: unknown }).confirmTransaction = async () => ({ approved, amountCents: 2000, currency: "USD" });
    try {
      const s = await seed();
      const { transactionId: id } = await checkout(s);
      expect((await deliver(sale(id, 2000, "evt_c1"))).body).toMatchObject({ outcome: "rejected", detail: "confirmation_not_approved" });
      approved = true;
      expect((await deliver(sale(id, 2000, "evt_c2"))).body.outcome).toBe("processed");
    } finally {
      delete (prov as { confirmTransaction?: unknown }).confirmTransaction;
    }
  });
});

describe.skipIf(!available)("QA-3 hostile strings never cause a 500", () => {
  it("NUL in reference / event id / transaction id / failure code -> 400 + a rejected log row, no state change", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    const before = await countAll("webhook_events");
    const variants = [
      m.ev.mockEvents.saleSucceeded({ transactionId: id, amountCents: 2000, reference: "a\u0000b" }),
      sale(id, 2000, "e\u0000x"),
      m.ev.mockEvents.saleSucceeded({ transactionId: id, amountCents: 2000, saleId: "tx\u0000" }),
      m.ev.mockEvents.saleFailed({ transactionId: id, amountCents: 2000, failureCode: "bad\u0000code" }),
      sale(id, 2000, "e\uD800x"), // lone surrogate
      sale(id, 2000, "e".repeat(600)),
    ];
    for (const v of variants) {
      const r = await deliver(v);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("invalid_payload");
    }
    expect(await countAll("webhook_events")).toBe(before + variants.length);
    const rows = await m.db.query<{ outcome: string; signature_valid: boolean }>(`SELECT outcome, signature_valid FROM webhook_events ORDER BY received_at DESC, id DESC LIMIT ${variants.length}`);
    expect(rows.every((r) => r.outcome === "rejected" && r.signature_valid)).toBe(true);
    expect((await txRow(id))!.status).toBe("pending");
    expect(await ledgerOf(id)).toEqual([]);
    expect((await deliver(sale(id, 2000, "evt_after_nul"))).body.outcome).toBe("processed"); // processor can recover with a clean event
  });
  it("an unexpected handler error still leaves an 'error' reconciliation row (and a retry works)", async () => {
    const s = await seed();
    const { transactionId: id } = await checkout(s);
    await m.db.query(`ALTER TABLE ledger_entries ADD CONSTRAINT tmp_break2 CHECK (false) NOT VALID`);
    const bad = await deliver(sale(id, 2000, "evt_err_row"));
    await m.db.query(`ALTER TABLE ledger_entries DROP CONSTRAINT tmp_break2`);
    expect(bad.status).toBe(500);
    const err = await m.db.query(`SELECT outcome_detail FROM webhook_events WHERE provider_event_id='evt_err_row' AND outcome='error'`);
    expect(err).toHaveLength(1);
  });
});

describe.skipIf(!available)("QA-4 repeated chargebacks flag the seller for review (M5-08)", () => {
  async function chargebacks(sellerId: string, dropId: string, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const out = await m.co.createCheckout({ dropId, email: `cb${i}@example.test`, confirmOver18: true });
      await deliver(sale(out.transactionId, 2000));
      await deliver(m.ev.mockEvents.chargeback({ transactionId: out.transactionId, amountCents: null }));
      ids.push(out.transactionId);
    }
    return ids;
  }
  const flag = (id: string) => m.db.queryOne<{ risk_flagged_at: string | null; risk_flag_reason: string | null; verification_status: string }>(`SELECT risk_flagged_at, risk_flag_reason, verification_status FROM sellers WHERE id=$1`, [id]);
  const audits = async (id: string) => Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE action='seller_flagged_repeat_chargebacks' AND target LIKE $1`, [`seller:${id}%`]))!.n);

  it("below threshold (2) no flag; the 3rd chargeback flags once with reason + audit row; the 4th does not re-flag; seller is NOT banned", async () => {
    const s = await seed();
    await chargebacks(s.sellerId, s.dropId, 2);
    expect((await flag(s.sellerId))!.risk_flagged_at).toBeNull();
    await chargebacks(s.sellerId, s.dropId, 1);
    const f = (await flag(s.sellerId))!;
    expect(f.risk_flagged_at).not.toBeNull();
    expect(f.risk_flag_reason).toMatch(/3 chargebacks within 90 days/);
    expect(f.verification_status).toBe("verified"); // no auto-ban, nothing else changed
    expect(await audits(s.sellerId)).toBe(1);
    const firstAt = f.risk_flagged_at;
    await chargebacks(s.sellerId, s.dropId, 1);
    expect(String((await flag(s.sellerId))!.risk_flagged_at)).toBe(String(firstAt));
    expect(await audits(s.sellerId)).toBe(1);
    // the seller can still be bought from
    expect((await checkout(s)).transactionId).toBeTruthy();
    // the triggering webhook is annotated in the reconciliation log
    const n = await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM webhook_events w JOIN transactions t ON t.id=w.transaction_id WHERE t.seller_id=$1 AND w.outcome_detail='seller_flagged_for_review'`, [s.sellerId]);
    expect(Number(n!.n)).toBe(1);
  });
  it("threshold and window are configurable; chargebacks outside the window don't count; other sellers unaffected", async () => {
    await setSetting("chargeback_flag_threshold", 2);
    try {
      const s = await seed(), other = await seed();
      await chargebacks(other.sellerId, other.dropId, 1);
      await chargebacks(s.sellerId, s.dropId, 1);
      expect((await flag(s.sellerId))!.risk_flagged_at).toBeNull();
      expect((await flag(other.sellerId))!.risk_flagged_at).toBeNull();
      await chargebacks(s.sellerId, s.dropId, 1);
      expect((await flag(s.sellerId))!.risk_flagged_at).not.toBeNull();
      expect((await flag(other.sellerId))!.risk_flagged_at).toBeNull();
    } finally { await setSetting("chargeback_flag_threshold", 3); }
  });
  it("the settings have CHECK constraints (threshold >= 1, window 1..3650) so flagging can't be silently disabled by a bad value", async () => {
    await expect(setSetting("chargeback_flag_threshold", 0)).rejects.toThrow(/check constraint/);
    await expect(setSetting("chargeback_flag_window_days", 0)).rejects.toThrow(/check constraint/);
  });
  it("concurrent chargebacks cannot all slip under the threshold: 4 simultaneous -> flagged exactly once", async () => {
    const s = await seed();
    const outs = [];
    for (let i = 0; i < 4; i++) { const o = await m.co.createCheckout({ dropId: s.dropId, email: `par${i}@example.test`, confirmOver18: true }); await deliver(sale(o.transactionId, 2000)); outs.push(o.transactionId); }
    await Promise.all(outs.map((id) => deliver(m.ev.mockEvents.chargeback({ transactionId: id, amountCents: null }))));
    expect((await flag(s.sellerId))!.risk_flagged_at).not.toBeNull();
    expect(await audits(s.sellerId)).toBe(1);
  });
  it("refunds are not chargebacks: 5 refunds don't flag", async () => {
    const s = await seed();
    for (let i = 0; i < 5; i++) {
      const o = await m.co.createCheckout({ dropId: s.dropId, email: `rf${i}@example.test`, confirmOver18: true });
      await deliver(sale(o.transactionId, 2000));
      await deliver(m.ev.mockEvents.refund({ transactionId: o.transactionId, refundId: `mockrf_flag_${s.sellerId}_${i}`, amountCents: 2000 }));
    }
    expect((await flag(s.sellerId))!.risk_flagged_at).toBeNull();
  });
});

describe.skipIf(!available)("QA-6 session expiry and re-validation at capture", () => {
  const backdate = (id: string, minutes: number) => m.db.query(`UPDATE transactions SET created_at = now() - make_interval(mins => $2::int) WHERE id=$1`, [id, minutes]);
  const row = (id: string) => m.db.queryOne<{ status: string; failure_code: string | null; review_reason: string | null; refund_requested_at: string | null }>(`SELECT status, failure_code, review_reason, refund_requested_at FROM transactions WHERE id=$1`, [id]);
  const sessionOf = async (id: string) => (await m.db.queryOne<{ provider_session_id: string }>(`SELECT provider_session_id FROM transactions WHERE id=$1`, [id]))!.provider_session_id;

  it("pending sessions expire after the TTL (default 30 min): on status access, on the sweep, and on a new checkout; payment is refused", async () => {
    const s = await seed();
    const c1 = await checkout(s);
    await backdate(c1.transactionId, 31);
    const st = await m.co.getCheckoutStatus(c1.transactionId);
    expect(st).toMatchObject({ status: "failed", retryable: false });
    expect(st!.message).toMatch(/expired/i);
    expect((await row(c1.transactionId))!.failure_code).toBe("session_expired");
    // sweep
    const c2 = await checkout(s, { email: "second@example.test" });
    await backdate(c2.transactionId, 45);
    expect(await m.co.expirePendingCheckouts()).toBeGreaterThanOrEqual(1);
    expect((await row(c2.transactionId))!.status).toBe("failed");
    // paying an expired session is refused by the (mock) hosted page and creates no ledger
    const c3 = await checkout(s, { email: "third@example.test" });
    await backdate(c3.transactionId, 60);
    const pay = await m.sim.simulatePayment(await sessionOf(c3.transactionId), "4242424242424242");
    expect(pay).toMatchObject({ status: "failed", approved: false, failureCode: "session_expired" });
    expect(await ledgerOf(c3.transactionId)).toEqual([]);
    // a fresh checkout creates a NEW session once the old one expired
    const again = await checkout(s, { email: "third@example.test" });
    expect(again.transactionId).not.toBe(c3.transactionId);
  });
  it("TTL is a setting", async () => {
    const s = await seed();
    const c = await checkout(s);
    await backdate(c.transactionId, 10);
    expect((await m.co.getCheckoutStatus(c.transactionId))!.status).toBe("pending");
    await setSetting("checkout_session_ttl_minutes", 5);
    try { expect((await m.co.getCheckoutStatus(c.transactionId))!.status).toBe("failed"); } finally { await setSetting("checkout_session_ttl_minutes", 30); }
  });
  it.each([
    ["seller verification failed", async (s: { sellerId: string }) => { await m.db.query(`UPDATE sellers SET verification_status='failed' WHERE id=$1`, [s.sellerId]); }],
    ["seller in manual_review", async (s: { sellerId: string }) => { await m.db.query(`UPDATE sellers SET verification_status='manual_review' WHERE id=$1`, [s.sellerId]); }],
    ["drop unpublished", async (s: { dropId: string }) => { await m.db.query(`UPDATE drops SET status='unpublished' WHERE id=$1`, [s.dropId]); }],
    ["drop flagged", async (s: { dropId: string }) => { await m.db.query(`UPDATE drops SET status='flagged' WHERE id=$1`, [s.dropId]); }],
  ] as const)("%s after checkout: the mock hosted page refuses payment", async (_n, mutate) => {
    const s = await seed();
    const c = await checkout(s);
    await (mutate as (s: unknown) => Promise<void>)(s);
    const pay = await m.sim.simulatePayment(await sessionOf(c.transactionId), "4242424242424242");
    expect(pay).toMatchObject({ approved: false, status: "failed", failureCode: "unavailable" });
    expect(pay.message).toMatch(/no longer available/i);
    expect(await ledgerOf(c.transactionId)).toEqual([]);
    expect((await txRow(c.transactionId))!.status).toBe("failed");
  });
  it.each([
    ["seller verification failed", async (s: { sellerId: string }) => { await m.db.query(`UPDATE sellers SET verification_status='failed' WHERE id=$1`, [s.sellerId]); }, "seller_not_verified"],
    ["drop unpublished", async (s: { dropId: string }) => { await m.db.query(`UPDATE drops SET status='unpublished' WHERE id=$1`, [s.dropId]); }, "drop_unavailable"],
    ["drop flagged", async (s: { dropId: string }) => { await m.db.query(`UPDATE drops SET status='flagged' WHERE id=$1`, [s.dropId]); }, "drop_unavailable"],
  ] as const)("webhook success arriving after %s: NOT credited; voided (refund requested through the provider), flagged for review, logged", async (_n, mutate, reason) => {
    const s = await seed();
    const c = await checkout(s);
    await (mutate as (s: unknown) => Promise<void>)(s);
    const r = await deliver(sale(c.transactionId, 2000, `evt_void_${reason}_${Math.random()}`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: "processed", detail: `voided:${reason}` });
    const t = await row(c.transactionId);
    expect(t).toMatchObject({ status: "failed", failure_code: "invalid_at_capture", review_reason: reason });
    expect(t!.refund_requested_at).not.toBeNull();
    expect(await ledgerOf(c.transactionId)).toEqual([]);
    expect((await m.ledger.getBalance(m.db.pool(), s.sellerId)).totalCents).toBe(0);
    // the processor's refund confirmation is recorded, doesn't touch the books; a replay of the sale is ignored
    const rf = await deliver(m.ev.mockEvents.refund({ transactionId: c.transactionId, refundId: `mockrf_void_${_n.replace(/\W+/g, "_")}`, amountCents: 2000 }));
    expect(rf.body).toMatchObject({ outcome: "processed", detail: "void_refund_confirmed" });
    expect(await ledgerOf(c.transactionId)).toEqual([]);
    expect((await deliver(sale(c.transactionId, 2000, `evt_void_again_${_n.length}`))).body.outcome).toBe("duplicate"); // the voided sale was a processed event: replays collapse
    expect((await row(c.transactionId))!.status).toBe("failed");
  });
  it("LATE success: within TTL+grace of an expired session -> honoured (credited); beyond the grace -> voided + review", async () => {
    const s = await seed();
    const late = await checkout(s, { email: "late1@example.test" });
    await backdate(late.transactionId, 31); // expired, but within the 24 h grace
    await m.co.expirePendingCheckouts();
    expect((await row(late.transactionId))!.failure_code).toBe("session_expired");
    expect((await deliver(sale(late.transactionId, 2000))).body.outcome).toBe("processed");
    expect(await row(late.transactionId)).toMatchObject({ status: "succeeded", review_reason: null });
    expect(await sum(late.transactionId)).toBe(1560);

    const toolate = await checkout(s, { email: "late2@example.test" });
    await backdate(toolate.transactionId, 30 + 1440 + 5);
    const r = await deliver(sale(toolate.transactionId, 2000));
    expect(r.body).toMatchObject({ outcome: "processed", detail: "voided:session_expired" });
    expect(await row(toolate.transactionId)).toMatchObject({ status: "failed", review_reason: "session_expired" });
    expect((await row(toolate.transactionId))!.refund_requested_at).not.toBeNull();
    expect(await ledgerOf(toolate.transactionId)).toEqual([]);
  });
  it("retryVoidRefunds re-requests a void whose first provider call failed", async () => {
    const s = await seed();
    const c = await checkout(s);
    await m.db.query(`UPDATE sellers SET verification_status='failed' WHERE id=$1`, [s.sellerId]);
    const reg = await import("../../src/server/payments/registry");
    const prov = reg.findProvider("mock")!;
    const orig = prov.issueRefund;
    prov.issueRefund = async () => { throw new Error("processor down"); };
    try {
      expect((await deliver(sale(c.transactionId, 2000))).status).toBe(200); // still 200: the event is recorded, the void is retried later
    } finally { prov.issueRefund = orig; }
    expect((await row(c.transactionId))!.refund_requested_at).toBeNull();
    await m.db.query(`UPDATE transactions SET void_refund_next_attempt_at = NULL WHERE id=$1`, [c.transactionId]); // skip the backoff wait (tested separately)
    expect((await m.refunds.retryVoidRefunds()).requested).toBeGreaterThanOrEqual(1);
    expect((await row(c.transactionId))!.refund_requested_at).not.toBeNull();
  });
});

describe.skipIf(!available)("QA-7 friendly failures and clean retry", () => {
  const sessionOf = async (id: string) => (await m.db.queryOne<{ provider_session_id: string }>(`SELECT provider_session_id FROM transactions WHERE id=$1`, [id]))!.provider_session_id;
  it("decline -> friendly message (no raw code), then a good card on the SAME session succeeds and credits once", async () => {
    const s = await seed();
    const c = await checkout(s);
    const sid = await sessionOf(c.transactionId);
    const d1 = await m.sim.simulatePayment(sid, "4000000000000002");
    expect(d1).toMatchObject({ status: "failed", approved: false });
    expect(d1.message).toBe("Your card was declined. Please try a different card.");
    expect(JSON.stringify(d1.message)).not.toMatch(/card_declined|_/);
    const st = await m.co.getCheckoutStatus(c.transactionId);
    expect(st).toMatchObject({ status: "failed", retryable: true });
    expect(st!.message).not.toMatch(/card_declined/);
    // 2nd decline (a different failure) also works and shows its own message
    const d2 = await m.sim.simulatePayment(sid, "4000000000009995");
    expect(d2.message).toMatch(/insufficient funds/i);
    const ok = await m.sim.simulatePayment(sid, "4242424242424242");
    expect(ok).toMatchObject({ status: "succeeded", approved: true });
    expect(await sum(c.transactionId)).toBe(1560);
    expect((await ledgerOf(c.transactionId)).length).toBe(3);
    // paying again after success is idempotent
    expect((await m.sim.simulatePayment(sid, "4242424242424242")).status).toBe("succeeded");
    expect((await ledgerOf(c.transactionId)).length).toBe(3);
  });
  it("every failure code the mock can produce maps to a friendly sentence", async () => {
    const { friendlyFailure, GENERIC_FAILURE } = await import("../../lib/purchase-copy");
    for (const code of ["card_declined", "insufficient_funds", "expired_card", "incorrect_cvc", "invalid_card_number", "unrecognized_test_card", "session_expired", "unavailable", "invalid_at_capture", "superseded", "session_error"]) {
      const msg = friendlyFailure(code);
      expect(msg).not.toBe(GENERIC_FAILURE);
      expect(msg).not.toContain(code);
      expect(msg).toMatch(/\s/);
    }
    expect(friendlyFailure("some_new_processor_code")).toBe(GENERIC_FAILURE);
    expect(friendlyFailure(null)).toBe(GENERIC_FAILURE);
  });
  it("after a decline the buyer can also start a fresh checkout for the same drop (new session)", async () => {
    const s = await seed();
    const c = await checkout(s);
    await m.sim.simulatePayment(await sessionOf(c.transactionId), "4000000000000002");
    const again = await checkout(s);
    expect(again.transactionId).not.toBe(c.transactionId);
    expect((await m.sim.simulatePayment(await sessionOf(again.transactionId), "4242424242424242")).status).toBe("succeeded");
  });
  it("an expired / voided session is terminal for card retries (no stuck-looking retry that can never work)", async () => {
    const s = await seed();
    const c = await checkout(s);
    await m.db.query(`UPDATE transactions SET status='failed', failure_code='session_expired' WHERE id=$1`, [c.transactionId]);
    const r = await m.sim.simulatePayment(await sessionOf(c.transactionId), "4242424242424242");
    expect(r).toMatchObject({ approved: false });
    expect(r.message).toMatch(/expired/i);
    expect(await ledgerOf(c.transactionId)).toEqual([]);
  });
});

// =====================================================================================================================
// Follow-ups 1: buyer binding of pending checkouts (QA run 2 NEW-1) + stale price supersede (INFO-1)
// =====================================================================================================================
describe.skipIf(!available)("FU-1 pending checkouts are bound to the client that created them", () => {
  it("another client (no cookie/key) with the same email + drop gets a DIFFERENT session and never the victim's URL/txn id", async () => {
    const s = await seed();
    const victim = await idemCo(s, null, "victim@example.test", TOKEN_A);
    expect(victim.reused).toBe(false);
    const attacker = await idemCo(s, null, "victim@example.test", null);
    expect(attacker.reused).toBe(false);
    expect(attacker.transactionId).not.toBe(victim.transactionId);
    expect(attacker.checkoutUrl).not.toBe(victim.checkoutUrl);
    expect(JSON.stringify({ ...attacker, setBuyerToken: undefined })).not.toContain(victim.checkoutUrl.split("/").pop()!);
    expect(attacker.setBuyerToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // the new client is given its own credential
    const other = await idemCo(s, null, "victim@example.test", TOKEN_B); // a (well-formed) token we have never issued
    expect(other.transactionId).not.toBe(victim.transactionId);
    expect(await pendingCount(s.dropId)).toBe(3);
    // the victim still gets exactly their own back
    const again = await idemCo(s, null, "victim@example.test", TOKEN_A);
    expect(again).toMatchObject({ transactionId: victim.transactionId, checkoutUrl: victim.checkoutUrl, reused: true, setBuyerToken: null });
  });
  it("the same client double-click (same cookie token, or same Idempotency-Key with no cookie yet) still yields ONE txn; concurrent too", async () => {
    const s = await seed();
    const first = await idemCo(s, null, "dbl@example.test", null);
    const token = first.setBuyerToken!;
    const rs = await Promise.all(Array.from({ length: 12 }, () => idemCo(s, null, "dbl@example.test", token)));
    expect(new Set(rs.map((r) => r.transactionId))).toEqual(new Set([first.transactionId]));
    expect(rs.every((r) => r.reused && r.setBuyerToken === null)).toBe(true);
    // first-ever concurrent burst with a key and no cookie: one txn, exactly one response carries the new cookie
    const s2 = await seed();
    const burst = await Promise.all(Array.from({ length: 12 }, () => idemCo(s2, "burst-key-1", "dbl@example.test", null)));
    expect(new Set(burst.map((r) => r.transactionId)).size).toBe(1);
    expect(burst.filter((r) => r.setBuyerToken).length).toBe(1);
    expect(await pendingCount(s2.dropId)).toBe(1);
  });
  it("the raw buyer token is never stored (only its SHA-256), and malformed tokens are treated as 'no token'", async () => {
    const s = await seed();
    const a = await idemCo(s, null, "h@example.test", TOKEN_A);
    const row = await m.db.queryOne<{ buyer_token_hash: string }>(`SELECT buyer_token_hash FROM transactions WHERE id=$1`, [a.transactionId]);
    expect(row!.buyer_token_hash).toBe(m.co.hashBuyerToken(TOKEN_A));
    expect(row!.buyer_token_hash).not.toContain(TOKEN_A);
    const bad = await idemCo(s, null, "h@example.test", "short");
    expect(bad.transactionId).not.toBe(a.transactionId);
    expect(bad.setBuyerToken).toBeTruthy();
  });
  it("legacy pending rows (no token, created before migration 008) keep the one-pending rule among themselves and are never returned to a client", async () => {
    const s = await seed();
    const a = await idemCo(s, null, "legacy@example.test", TOKEN_A);
    await m.db.query(`UPDATE transactions SET buyer_token_hash = NULL WHERE id=$1`, [a.transactionId]);
    const b = await idemCo(s, null, "legacy@example.test", TOKEN_A);
    expect(b.transactionId).not.toBe(a.transactionId);
    await expect(m.db.query(
      `INSERT INTO transactions (drop_id, seller_id, buyer_email, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents, status, provider)
       SELECT drop_id, seller_id, buyer_email, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents, 'pending', provider FROM transactions WHERE id=$1`, [a.transactionId],
    )).rejects.toMatchObject({ code: "23505" });
  });
  it("a PAID checkout of one client does not leak to another; a keyed replay by the owner returns the succeeded txn", async () => {
    const s = await seed();
    const a = await idemCo(s, "paid-key-1", "p@example.test", TOKEN_A);
    await deliver(sale(a.transactionId, 2000));
    const other = await idemCo(s, null, "p@example.test", null);
    expect(other.transactionId).not.toBe(a.transactionId);
    expect((await idemCo(s, "paid-key-1", "p@example.test", TOKEN_A)).transactionId).toBe(a.transactionId);
  });
});

describe.skipIf(!available)("FU-1 price change supersedes a stale pending checkout (QA INFO-1)", () => {
  it("reuse with a changed drop price -> old pending txn superseded, NEW txn at the current price (same client, no key)", async () => {
    const s = await seed({ price: 2000 });
    const a = await idemCo(s, null, "price@example.test", TOKEN_A);
    expect(a.amountCents).toBe(2000);
    await m.db.query(`UPDATE drops SET price_cents = 9000 WHERE id=$1`, [s.dropId]);
    const b = await idemCo(s, null, "price@example.test", TOKEN_A);
    expect(b).toMatchObject({ amountCents: 9000, reused: false });
    expect(b.transactionId).not.toBe(a.transactionId);
    expect(await txRow(a.transactionId)).toMatchObject({ status: "failed", failure_code: "superseded" });
    expect(await txRow(b.transactionId)).toMatchObject({ status: "pending", amount_cents: 9000, platform_fee_cents: 900, processing_fee_cents: 1080, seller_net_cents: 7020 });
    expect(await pendingCount(s.dropId)).toBe(1);
    // unchanged price -> reuse again
    expect((await idemCo(s, null, "price@example.test", TOKEN_A)).transactionId).toBe(b.transactionId);
  });
  it("same with an Idempotency-Key: the stale keyed txn is superseded and the key moves to the new one", async () => {
    const s = await seed({ price: 2000 });
    const a = await idemCo(s, "price-key-1", "pk@example.test", TOKEN_A);
    await m.db.query(`UPDATE drops SET price_cents = 1000 WHERE id=$1`, [s.dropId]);
    const b = await idemCo(s, "price-key-1", "pk@example.test", TOKEN_A);
    expect(b).toMatchObject({ amountCents: 1000, reused: false });
    expect((await txRow(a.transactionId))!.failure_code).toBe("superseded");
    expect((await idemCo(s, "price-key-1", "pk@example.test", TOKEN_A)).transactionId).toBe(b.transactionId);
  });
  it("a processor-confirmed payment for the superseded txn (buyer paid the OLD price in another tab) is still booked at the price actually charged: money was captured", async () => {
    const s = await seed({ price: 2000 });
    const a = await idemCo(s, null, "late@example.test", TOKEN_A);
    await m.db.query(`UPDATE drops SET price_cents = 3000 WHERE id=$1`, [s.dropId]);
    await idemCo(s, null, "late@example.test", TOKEN_A);
    const r = await deliver(sale(a.transactionId, 2000));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: "processed" });
    expect(await sum(a.transactionId)).toBe(1560); // 2000 - 200 - 240: the snapshot the buyer was actually charged
    expect((await txRow(a.transactionId))!.status).toBe("succeeded");
  });
});

// =====================================================================================================================
// Follow-ups 2: payments janitor
// =====================================================================================================================
async function voidedTx(over: { failProvider?: boolean } = {}) {
  const s = await seed();
  const c = await checkout(s);
  await m.db.query(`UPDATE sellers SET verification_status='failed' WHERE id=$1`, [s.sellerId]);
  const reg = await import("../../src/server/payments/registry");
  const prov = reg.findProvider("mock")!;
  const orig = prov.issueRefund;
  if (over.failProvider) prov.issueRefund = async () => { throw new Error("processor down"); };
  try { await deliver(sale(c.transactionId, 2000)); } finally { prov.issueRefund = orig; }
  return { ...s, id: c.transactionId };
}
const withProvider = async <T,>(impl: (() => Promise<never>) | null, fn: () => Promise<T>): Promise<T> => {
  const prov = (await import("../../src/server/payments/registry")).findProvider("mock")!;
  const orig = prov.issueRefund;
  if (impl) prov.issueRefund = impl as never;
  try { return await fn(); } finally { prov.issueRefund = orig; }
};
const cleanSlate = async () => { // other tests leave work for the janitor; start each janitor test from zero
  await m.db.query(`UPDATE transactions SET status='failed', failure_code='session_expired' WHERE status='pending'`);
  await m.db.query(`UPDATE transactions SET refund_requested_at = now() WHERE review_reason IS NOT NULL AND refund_requested_at IS NULL`);
  await m.db.query(`UPDATE webhook_events SET stale_flagged_at = now() WHERE outcome='parked' AND stale_flagged_at IS NULL`);
};

describe.skipIf(!available)("FU-2 janitor: expiry sweep", () => {
  it("expires only pending sessions older than the TTL; idempotent; writes heartbeat + audit row with counts", async () => {
    await cleanSlate();
    const s = await seed();
    const old = await idemCo(s, null, "old@example.test", TOKEN_A), fresh = await idemCo(s, null, "fresh@example.test", TOKEN_A);
    await m.db.query(`UPDATE transactions SET created_at = now() - interval '45 minutes' WHERE id=$1`, [old.transactionId]);
    const r1 = await m.jan.runPaymentsJanitor();
    expect(r1).toMatchObject({ skipped: false, counts: { expiredCheckouts: 1 } });
    expect(await txRow(old.transactionId)).toMatchObject({ status: "failed", failure_code: "session_expired" });
    expect((await txRow(fresh.transactionId))!.status).toBe("pending");
    const audit = await m.db.queryOne<{ target: string }>(`SELECT target FROM audit_log WHERE action='payments_janitor_run' ORDER BY created_at DESC LIMIT 1`);
    expect(audit!.target).toMatch(/"expiredCheckouts":1/);
    const r2 = await m.jan.runPaymentsJanitor(); // nothing left to do
    expect(r2).toMatchObject({ skipped: false, counts: { expiredCheckouts: 0, voidRefundsRequested: 0 } });
    const before = Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE action='payments_janitor_run'`))!.n);
    await m.jan.runPaymentsJanitor();
    expect(Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE action='payments_janitor_run'`))!.n)).toBe(before); // quiet runs don't spam the audit log
    const st = await m.jan.getJanitorState();
    expect(st!.last_run_at).not.toBeNull();
    expect(Number(st!.runs)).toBeGreaterThanOrEqual(3);
  });
  it("honours checkout_session_ttl_minutes", async () => {
    await cleanSlate();
    const s = await seed();
    const a = await idemCo(s, null, "ttl@example.test", TOKEN_A);
    await m.db.query(`UPDATE transactions SET created_at = now() - interval '5 minutes' WHERE id=$1`, [a.transactionId]);
    expect((await m.jan.runPaymentsJanitor() as { counts: { expiredCheckouts: number } }).counts.expiredCheckouts).toBe(0);
    await setSetting("checkout_session_ttl_minutes", 2);
    try { expect((await m.jan.runPaymentsJanitor() as { counts: { expiredCheckouts: number } }).counts.expiredCheckouts).toBe(1); }
    finally { await setSetting("checkout_session_ttl_minutes", 30); }
  });
});

describe.skipIf(!available)("FU-2 janitor: void refund retry (success / failure / backoff / cap / last error)", () => {
  it("backoff schedule is pure and capped at 24h", () => {
    expect([1, 2, 3, 4, 5].map((n) => m.refunds.voidRefundBackoffMinutes(n, 5))).toEqual([5, 10, 20, 40, 80]);
    expect(m.refunds.voidRefundBackoffMinutes(30, 5)).toBe(1440);
  });
  it("a failing provider: attempt counted, last error + next attempt recorded; the janitor does not retry before the backoff elapses", async () => {
    await cleanSlate();
    const t = await voidedTx({ failProvider: true });
    let row = (await txRow(t.id)) as unknown as Record<string, unknown>;
    expect(row).toMatchObject({ void_refund_attempts: 1, void_refund_last_error: "processor down", refund_requested_at: null });
    expect(row.void_refund_next_attempt_at).not.toBeNull();
    const r = await m.jan.runPaymentsJanitor();
    expect(r).toMatchObject({ skipped: false, counts: { voidRefundsRequested: 0, voidRefundsFailed: 0 } }); // still inside the backoff window
    expect(((await txRow(t.id)) as unknown as Record<string, unknown>).void_refund_attempts).toBe(1);
    // backoff elapsed + provider still down -> attempt 2, longer next delay
    await m.db.query(`UPDATE transactions SET void_refund_next_attempt_at = now() - interval '1 second' WHERE id=$1`, [t.id]);
    const r2 = await withProvider(async () => { throw new Error("still down"); }, () => m.jan.runPaymentsJanitor());
    expect(r2).toMatchObject({ counts: { voidRefundsFailed: 1 } });
    row = (await txRow(t.id)) as unknown as Record<string, unknown>;
    expect(row).toMatchObject({ void_refund_attempts: 2, void_refund_last_error: "still down" });
    const gap = await m.db.queryOne<{ mins: string }>(`SELECT round(extract(epoch FROM (void_refund_next_attempt_at - void_refund_last_attempt_at))/60) AS mins FROM transactions WHERE id=$1`, [t.id]);
    expect(Number(gap!.mins)).toBe(10); // 5 * 2^1
    // provider recovers -> requested, error history kept, no more retries
    await m.db.query(`UPDATE transactions SET void_refund_next_attempt_at = NULL WHERE id=$1`, [t.id]);
    const r3 = await m.jan.runPaymentsJanitor();
    expect(r3).toMatchObject({ counts: { voidRefundsRequested: 1 } });
    row = (await txRow(t.id)) as unknown as Record<string, unknown>;
    expect(row.refund_requested_at).not.toBeNull();
    expect(row.void_refund_next_attempt_at).toBeNull();
    expect(await m.jan.runPaymentsJanitor()).toMatchObject({ counts: { voidRefundsRequested: 0 } }); // idempotent
    expect(await ledgerOf(t.id)).toEqual([]); // the janitor never posts money
  });
  it("attempt cap: after void_refund_max_attempts failures the row is no longer retried and is reported as gaveUp", async () => {
    await cleanSlate();
    await setSetting("void_refund_max_attempts", 2);
    try {
      const t = await voidedTx({ failProvider: true }); // attempt 1
      await m.db.query(`UPDATE transactions SET void_refund_next_attempt_at = NULL WHERE id=$1`, [t.id]);
      await withProvider(async () => { throw new Error("down #2"); }, () => m.jan.runPaymentsJanitor()); // attempt 2 = cap
      expect(((await txRow(t.id)) as unknown as Record<string, unknown>).void_refund_attempts).toBe(2);
      await m.db.query(`UPDATE transactions SET void_refund_next_attempt_at = NULL WHERE id=$1`, [t.id]);
      const calls = { n: 0 };
      const r = await withProvider(async () => { calls.n++; throw new Error("never called"); }, () => m.jan.runPaymentsJanitor());
      expect(calls.n).toBe(0);
      expect(r).toMatchObject({ counts: { voidRefundsFailed: 0, voidRefundsGaveUp: 1 } });
      expect(((await txRow(t.id)) as unknown as Record<string, unknown>)).toMatchObject({ void_refund_last_error: "down #2", refund_requested_at: null });
    } finally { await setSetting("void_refund_max_attempts", 5); }
  });
});

describe.skipIf(!available)("FU-2 janitor: stale parked events and concurrency", () => {
  it("a refund parked for longer than parked_event_stale_hours is flagged stale (not deleted, still parked); fresh ones are untouched; flagged once", async () => {
    await cleanSlate();
    const s = await seed();
    const c1 = await checkout(s), c2 = await checkout(s, { email: "other@example.test" });
    for (const c of [c1, c2]) expect((await deliver(m.ev.mockEvents.refund({ transactionId: c.transactionId, refundId: `mockrf_park_${c.transactionId.slice(0, 8)}`, amountCents: 500 }))).body.outcome).toBe("parked");
    await m.db.query(`UPDATE webhook_events SET received_at = now() - interval '100 hours' WHERE transaction_id=$1 AND outcome='parked'`, [c1.transactionId]);
    const r = await m.jan.runPaymentsJanitor();
    expect(r).toMatchObject({ counts: { parkedEventsFlaggedStale: 1 } });
    const rows = await m.db.query<{ transaction_id: string; outcome: string; stale: boolean }>(`SELECT transaction_id, outcome, stale_flagged_at IS NOT NULL AS stale FROM webhook_events WHERE outcome='parked' AND transaction_id = ANY($1)`, [[c1.transactionId, c2.transactionId]]);
    expect(rows.find((x) => x.transaction_id === c1.transactionId)).toMatchObject({ outcome: "parked", stale: true });
    expect(rows.find((x) => x.transaction_id === c2.transactionId)).toMatchObject({ outcome: "parked", stale: false });
    expect(await m.jan.runPaymentsJanitor()).toMatchObject({ counts: { parkedEventsFlaggedStale: 0 } });
    // the sale still arrives later and applies the parked refund (the stale flag never blocks reconciliation)
    expect((await deliver(sale(c1.transactionId, 2000))).body.outcome).toBe("processed");
  });
  it("concurrent janitor runs: exactly one does the work, the others return skipped; counts are never doubled", async () => {
    await cleanSlate();
    const s = await seed();
    const rows = [] as string[];
    for (let i = 0; i < 6; i++) rows.push((await idemCo(s, null, `race${i}@example.test`, TOKEN_A)).transactionId);
    await m.db.query(`UPDATE transactions SET created_at = now() - interval '2 hours' WHERE id = ANY($1)`, [rows]);
    const rs = await Promise.all(Array.from({ length: 8 }, () => m.jan.runPaymentsJanitor()));
    const done = rs.filter((r) => !r.skipped) as Extract<Awaited<ReturnType<typeof m.jan.runPaymentsJanitor>>, { skipped: false }>[];
    expect(done.length).toBeGreaterThanOrEqual(1);
    expect(done.reduce((a, r) => a + r.counts.expiredCheckouts, 0)).toBe(6); // each row expired exactly once across all runs
    expect(rs.filter((r) => r.skipped).every((r) => r.skipped && r.reason === "already_running")).toBe(true);
    const lockFree = await m.db.queryOne<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtextextended('payments:janitor', 0)) AS ok`);
    expect(lockFree!.ok).toBe(true); // the lock is released after the runs (this connection may now hold it; release below)
    await m.db.query(`SELECT pg_advisory_unlock_all()`);
  });
  it("a failing step is recorded as an error (heartbeat + audit) but the other steps still run, and the lock is released", async () => {
    await cleanSlate();
    const s = await seed();
    const a = await idemCo(s, null, "stepfail@example.test", TOKEN_A);
    await m.db.query(`UPDATE transactions SET created_at = now() - interval '2 hours' WHERE id=$1`, [a.transactionId]);
    await m.db.query(`ALTER TABLE webhook_events RENAME COLUMN stale_flagged_at TO stale_flagged_at_x`); // make step 4 blow up
    try {
      const r = await m.jan.runPaymentsJanitor();
      expect(r).toMatchObject({ skipped: false, counts: { expiredCheckouts: 1, parkedEventsFlaggedStale: 0 } });
      expect((r as { errors: string[] }).errors.join()).toMatch(/flag_stale_parked/);
    } finally { await m.db.query(`ALTER TABLE webhook_events RENAME COLUMN stale_flagged_at_x TO stale_flagged_at`); }
    const audit = await m.db.queryOne<{ target: string }>(`SELECT target FROM audit_log WHERE action='payments_janitor_run' ORDER BY created_at DESC LIMIT 1`);
    expect(audit!.target).toMatch(/errors/);
    expect(await m.jan.runPaymentsJanitor()).toMatchObject({ skipped: false, errors: [] }); // lock was released; next run is healthy
  });
});

describe.skipIf(!available)("FU-2 earnings label for voided charges", () => {
  it("a void shows as voided_refunding (refund asked) / voided (not yet) in the seller's recent list; raw status stays 'failed'; money totals unchanged", async () => {
    await cleanSlate();
    const t = await voidedTx();
    const e1 = await m.earn.getEarningsSummary(t.sellerId);
    expect(e1.recent.find((x) => x.id === t.id)).toMatchObject({ status: "failed", displayStatus: "voided_refunding" });
    expect(e1.lifetime.grossCents).toBe(0);
    expect(e1.balance.totalCents).toBe(0);
    await m.db.query(`UPDATE transactions SET refund_requested_at = NULL WHERE id=$1`, [t.id]);
    expect((await m.earn.getEarningsSummary(t.sellerId)).recent.find((x) => x.id === t.id)!.displayStatus).toBe("voided");
    const s = await seed(); const c = await checkout(s);
    await deliver(m.ev.mockEvents.saleFailed({ transactionId: c.transactionId, amountCents: 2000, failureCode: "card_declined" }));
    expect((await m.earn.getEarningsSummary(s.sellerId)).recent.find((x) => x.id === c.transactionId)).toMatchObject({ status: "failed", displayStatus: "failed" });
  });
});

// =====================================================================================================================
// Follow-ups 3: admin auth foundation + flagged sellers / review transactions / clear flag
// =====================================================================================================================
const ADMIN_PW = "Correct-horse-battery-staple-42";
let adminCounter = 0;
const mkAdmin = async (pw = ADMIN_PW) => { const email = `admin${++adminCounter}-${Date.now()}@example.test`; const r = await m.adm.createAdmin(email, pw); return { id: r.id, email }; };

describe.skipIf(!available)("FU-3 admin authentication", () => {
  it("createAdmin: bcrypt hash only (never the password), lower-cased email, weak/short passwords and bad emails refused, duplicates refused, audit row", async () => {
    const a = await mkAdmin();
    const row = await m.db.queryOne<{ email: string; password_hash: string }>(`SELECT email, password_hash FROM admins WHERE id=$1`, [a.id]);
    expect(row!.password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(row!.password_hash).not.toContain(ADMIN_PW);
    await expect(m.adm.createAdmin("x@example.test", "short")).rejects.toThrow(/at least 10/);
    await expect(m.adm.createAdmin("x@example.test", "password1234")).rejects.toThrow();
    await expect(m.adm.createAdmin("not-an-email", ADMIN_PW)).rejects.toThrow(/invalid email/);
    await expect(m.adm.createAdmin(a.email.toUpperCase(), ADMIN_PW)).rejects.toThrow(/already exists/);
    expect(Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE action='admin_created_cli' AND target=$1`, [`admin:${a.id}`]))!.n)).toBe(1);
  });
  it("there is NO seeded/default admin: a fresh schema has zero admins until the CLI creates one (and the table has no default password)", async () => {
    const cols = await m.db.query<{ column_name: string; column_default: string | null }>(`SELECT column_name, column_default FROM information_schema.columns WHERE table_name='admins' AND column_name='password_hash'`);
    expect(cols[0].column_default).toBeNull();
    // seeded rows would have no password_hash: none may exist except those created by this test file
    const bad = await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM admins WHERE password_hash IS NULL`);
    expect(Number(bad!.n)).toBe(0);
  });
  it("login: correct password -> session token that verifies; wrong password / unknown email / disabled admin -> null (uniform)", async () => {
    const a = await mkAdmin();
    const ok = await m.adm.loginAdmin(a.email, ADMIN_PW, "ua");
    expect(ok).not.toBeNull();
    expect(await m.adm.readAdminToken(ok!.token)).toEqual({ id: a.id, email: a.email });
    expect(await m.adm.loginAdmin(a.email, ADMIN_PW + "x")).toBeNull();
    expect(await m.adm.loginAdmin("nobody@example.test", ADMIN_PW)).toBeNull();
    await m.db.query(`UPDATE admins SET disabled_at = now() WHERE id=$1`, [a.id]);
    expect(await m.adm.loginAdmin(a.email, ADMIN_PW)).toBeNull();
    expect(await m.adm.readAdminToken(ok!.token)).toBeNull(); // an existing session dies with the account
    const au = await m.db.query<{ action: string }>(`SELECT action FROM audit_log WHERE admin_id=$1 ORDER BY created_at`, [a.id]);
    expect(au.map((x) => x.action)).toContain("admin_login");
  });
  it("sessions are server-side revocable (logout) and expire", async () => {
    const a = await mkAdmin();
    const { token } = (await m.adm.loginAdmin(a.email, ADMIN_PW))!;
    expect(await m.adm.revokeAdminToken(token)).toBe(true);
    expect(await m.adm.readAdminToken(token)).toBeNull();
    const t2 = (await m.adm.loginAdmin(a.email, ADMIN_PW))!.token;
    await m.db.query(`UPDATE admin_sessions SET expires_at = now() - interval '1 second' WHERE admin_id=$1`, [a.id]);
    expect(await m.adm.readAdminToken(t2)).toBeNull();
  });
  it("principals are separate: a SELLER session token never validates as an admin, and an admin token never as a seller", async () => {
    const s = await seed();
    const sellerToken = await m.sess.createSession(s.sellerId);
    expect(await m.sess.readSessionToken(sellerToken)).toBe(s.sellerId);
    expect(await m.adm.readAdminToken(sellerToken)).toBeNull();
    const a = await mkAdmin();
    const { token } = (await m.adm.loginAdmin(a.email, ADMIN_PW))!;
    expect(await m.sess.readSessionToken(token)).toBeNull();
    // a seller whose email equals an admin's email is still not an admin
    expect(await m.adm.readAdminToken(sellerToken + "x")).toBeNull();
    expect(await m.adm.readAdminToken("garbage")).toBeNull();
  });
  it("--reset-password path: replaces the hash, re-enables, revokes existing sessions, audit row; old password stops working", async () => {
    const a = await mkAdmin();
    const { token } = (await m.adm.loginAdmin(a.email, ADMIN_PW))!;
    await m.adm.createAdmin(a.email, "A-totally-different-passphrase-1", { resetIfExists: true });
    expect(await m.adm.readAdminToken(token)).toBeNull();
    expect(await m.adm.loginAdmin(a.email, ADMIN_PW)).toBeNull();
    expect(await m.adm.loginAdmin(a.email, "A-totally-different-passphrase-1")).not.toBeNull();
  });
});

describe.skipIf(!available)("FU-3 admin queries and the audited 'clear flag' action", () => {
  async function flagged(n = 3) {
    const s = await seed();
    for (let i = 0; i < n; i++) {
      const out = await m.co.createCheckout({ dropId: s.dropId, email: `fl${i}@example.test`, confirmOver18: true });
      await deliver(sale(out.transactionId, 2000));
      await deliver(m.ev.mockEvents.chargeback({ transactionId: out.transactionId, amountCents: null }));
    }
    return s;
  }
  it("listFlaggedSellers: only flagged sellers, with counts, never password hashes or payout details", async () => {
    const f = await flagged(3);
    const notFlagged = await seed();
    const list = await m.admq.listFlaggedSellers();
    const row = list.find((x) => x.id === f.sellerId)!;
    expect(row).toMatchObject({ chargebacks: 3, totalSales: 3, refunds: 0, verificationStatus: "verified" });
    expect(row.flagReason).toMatch(/3 chargebacks/);
    expect(list.find((x) => x.id === notFlagged.sellerId)).toBeUndefined();
    const json = JSON.stringify(list);
    expect(json).not.toMatch(/password|hash|payout_details|dob|legal_name/i);
  });
  it("listReviewTransactions: voided charge with refund state; failed retries show pending_retry / failed with last error", async () => {
    await cleanSlate();
    const ok = await voidedTx(); // refund requested
    const fail = await voidedTx({ failProvider: true });
    const list = await m.admq.listReviewTransactions();
    expect(list.find((x) => x.id === ok.id)).toMatchObject({ refundState: "requested", reviewReason: "seller_not_verified", status: "failed", failureCode: "invalid_at_capture" });
    expect(list.find((x) => x.id === fail.id)).toMatchObject({ refundState: "pending_retry", refundAttempts: 1, refundLastError: "processor down" });
    await m.db.query(`UPDATE transactions SET void_refund_attempts = 99 WHERE id=$1`, [fail.id]);
    expect((await m.admq.listReviewTransactions()).find((x) => x.id === fail.id)!.refundState).toBe("failed");
    expect(JSON.stringify(list)).not.toMatch(/buyer_email|buyer@example|password/i);
  });
  it("listSellerTransactions: rows for that seller only, no buyer email; unknown/garbage id -> null seller", async () => {
    const f = await flagged(3);
    const r = await m.admq.listSellerTransactions(f.sellerId);
    expect(r.rows).toHaveLength(3);
    expect(JSON.stringify(r)).not.toMatch(/example\.test"?,"(dropTitle|status)|buyer/i);
    expect((await m.admq.listSellerTransactions("not-a-uuid")).seller).toBeNull();
    expect((await m.admq.listSellerTransactions("00000000-0000-4000-8000-000000000000")).seller).toBeNull();
  });
  it("clearSellerFlag: clears the flag, records reviewer + note, writes ONE audit row (admin id + time) atomically; nothing else about the seller changes", async () => {
    const f = await flagged(3);
    const a = await mkAdmin();
    const before = await m.db.queryOne<{ verification_status: string }>(`SELECT verification_status FROM sellers WHERE id=$1`, [f.sellerId]);
    const r = await m.admq.clearSellerFlag(a.id, f.sellerId, "Reviewed disputes: legitimate buyers' remorse, no fraud.");
    expect(r.sellerId).toBe(f.sellerId);
    const s = await m.db.queryOne<Record<string, unknown>>(`SELECT risk_flagged_at, risk_flag_reason, risk_reviewed_at, risk_reviewed_by, risk_review_note, verification_status FROM sellers WHERE id=$1`, [f.sellerId]);
    expect(s).toMatchObject({ risk_flagged_at: null, risk_flag_reason: null, risk_reviewed_by: a.id, verification_status: before!.verification_status });
    expect(s!.risk_reviewed_at).not.toBeNull();
    expect(s!.risk_review_note).toMatch(/legitimate/);
    const au = await m.db.query<{ admin_id: string; target: string; created_at: string }>(`SELECT admin_id, target, created_at FROM audit_log WHERE action='seller_flag_cleared' AND target LIKE $1`, [`seller:${f.sellerId}%`]);
    expect(au).toHaveLength(1);
    expect(au[0].admin_id).toBe(a.id);
    expect(au[0].target).toMatch(/3 chargebacks/); // previous reason retained in the audit trail
    expect(au[0].created_at).toBeTruthy();
    expect((await m.admq.listFlaggedSellers()).find((x) => x.id === f.sellerId)).toBeUndefined();
  });
  it("clearSellerFlag validation: note required (3-500), unflagged seller 409, unknown seller 404 - and NO audit row / state change on failure", async () => {
    const f = await flagged(3);
    const a = await mkAdmin();
    const auditCount = async () => Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE action='seller_flag_cleared'`))!.n);
    const n0 = await auditCount();
    await expect(m.admq.clearSellerFlag(a.id, f.sellerId, "  ")).rejects.toMatchObject({ status: 400, code: "note_required" });
    await expect(m.admq.clearSellerFlag(a.id, f.sellerId, "x".repeat(501))).rejects.toMatchObject({ status: 400 });
    await expect(m.admq.clearSellerFlag(a.id, "00000000-0000-4000-8000-000000000000", "valid note")).rejects.toMatchObject({ status: 404 });
    await expect(m.admq.clearSellerFlag(a.id, "garbage", "valid note")).rejects.toMatchObject({ status: 404 });
    expect((await m.db.queryOne<{ risk_flagged_at: string | null }>(`SELECT risk_flagged_at FROM sellers WHERE id=$1`, [f.sellerId]))!.risk_flagged_at).not.toBeNull();
    expect(await auditCount()).toBe(n0);
    await m.admq.clearSellerFlag(a.id, f.sellerId, "first review");
    await expect(m.admq.clearSellerFlag(a.id, f.sellerId, "second review")).rejects.toMatchObject({ status: 409, code: "not_flagged" });
    expect(await auditCount()).toBe(n0 + 1);
  });
  it("concurrent clears: exactly one succeeds and exactly one audit row exists", async () => {
    const f = await flagged(3);
    const a = await mkAdmin();
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => m.admq.clearSellerFlag(a.id, f.sellerId, "concurrent review")));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE action='seller_flag_cleared' AND target LIKE $1`, [`seller:${f.sellerId}%`]))!.n)).toBe(1);
  });
  it("after a review the count restarts: old chargebacks don't instantly re-flag; the next 3 new ones do", async () => {
    const f = await flagged(3);
    const a = await mkAdmin();
    await m.admq.clearSellerFlag(a.id, f.sellerId, "reviewed, fine");
    const cb = async (tag: string) => { const o = await m.co.createCheckout({ dropId: f.dropId, email: `${tag}@example.test`, confirmOver18: true }); await deliver(sale(o.transactionId, 2000)); await deliver(m.ev.mockEvents.chargeback({ transactionId: o.transactionId, amountCents: null })); };
    const isFlagged = async () => (await m.db.queryOne<{ risk_flagged_at: string | null }>(`SELECT risk_flagged_at FROM sellers WHERE id=$1`, [f.sellerId]))!.risk_flagged_at !== null;
    await cb("n1"); await cb("n2");
    expect(await isFlagged()).toBe(false);
    await cb("n3");
    expect(await isFlagged()).toBe(true);
  });
});

// =====================================================================================================================
// Audit hardening (migration 011): append-only audit_log, attribution survives, failed-login auditing, input hygiene
// =====================================================================================================================
describe.skipIf(!available)("AH-1 audit_log is append-only and attribution is permanent", () => {
  const anyRow = async () => {
    const a = await mkAdmin();
    await m.adm.loginAdmin(a.email, ADMIN_PW, "ua", "10.1.1.1");
    return a;
  };
  it("UPDATE, DELETE and TRUNCATE on audit_log are refused for the app role (restrict_violation, 'append-only'), rows unchanged", async () => {
    const a = await anyRow();
    const before = await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log`);
    await expect(m.db.query(`UPDATE audit_log SET target = 'tampered'`)).rejects.toThrow(/audit_log is append-only/);
    await expect(m.db.query(`UPDATE audit_log SET admin_email = 'x@y.z' WHERE admin_id = $1`, [a.id])).rejects.toMatchObject({ code: "23001" });
    await expect(m.db.query(`DELETE FROM audit_log WHERE admin_id = $1`, [a.id])).rejects.toThrow(/append-only/);
    await expect(m.db.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
    await expect(m.db.query(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/);
    await expect(m.db.query(`TRUNCATE audit_log, admins CASCADE`)).rejects.toThrow(/append-only/);
    expect((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log`))!.n).toBe(before!.n);
    // zero-row statements are still refused where the trigger is statement-level (TRUNCATE); row triggers only fire per row, so also check none leaked:
    expect(Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE target='tampered'`))!.n)).toBe(0);
  });
  it("INSERT still works for every existing writer (cli create, login, logout, clear-flag, chargeback flag, janitor) and fills the email snapshot", async () => {
    const a = await mkAdmin();
    const t = (await m.adm.loginAdmin(a.email, ADMIN_PW, "ua", "10.1.1.2"))!.token;
    await m.adm.revokeAdminToken(t);
    const rows = await m.db.query<{ action: string; admin_email: string | null; admin_id: string | null }>(
      `SELECT action, admin_email, admin_id FROM audit_log WHERE admin_email = $1 ORDER BY created_at, action`, [a.email]);
    expect(rows.map((r) => r.action).sort()).toEqual(["admin_created_cli", "admin_login", "admin_logout"]);
    expect(rows.every((r) => r.admin_email === a.email)).toBe(true);
    // a raw writer that only sets admin_id (the pre-011 shape) gets the snapshot from the DB trigger
    await m.db.query(`INSERT INTO audit_log (admin_id, action, target) VALUES ($1, 'x_legacy_shape', 't')`, [a.id]);
    expect((await m.db.queryOne<{ admin_email: string }>(`SELECT admin_email FROM audit_log WHERE action='x_legacy_shape' AND admin_id=$1`, [a.id]))!.admin_email).toBe(a.email);
  });
  it("an admin with audit history cannot be deleted (FK RESTRICT + guard trigger); the audit rows and the actor survive; disabling is the supported path and is itself audited", async () => {
    const a = await anyRow();
    await expect(m.db.query(`DELETE FROM admins WHERE id = $1`, [a.id])).rejects.toThrow();
    await expect(m.db.query(`DELETE FROM admins`)).rejects.toThrow();
    expect(Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM admins WHERE id=$1`, [a.id]))!.n)).toBe(1);
    const still = await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE admin_id=$1 AND admin_email=$2`, [a.id, a.email]);
    expect(Number(still!.n)).toBeGreaterThanOrEqual(2); // created (has admin_id via snapshot-less CLI row too) + login
    // a CLI-created-only admin (row has admin_id NULL in legacy data) is protected via its admin:<uuid> target as well
    const legacy = await m.db.queryOne<{ id: string }>(`INSERT INTO admins (email, password_hash) VALUES ($1, 'x') RETURNING id`, [`legacy${Date.now()}@example.test`]);
    await m.db.query(`INSERT INTO audit_log (admin_id, action, target) VALUES (NULL, 'admin_created_cli', $1)`, [`admin:${legacy!.id}`]);
    await expect(m.db.query(`DELETE FROM admins WHERE id=$1`, [legacy!.id])).rejects.toThrow(/audit history/);
    // disable instead
    await m.db.query(`UPDATE admins SET disabled_at = now() WHERE id=$1`, [a.id]);
    const dis = await m.db.query<{ action: string; admin_email: string }>(`SELECT action, admin_email FROM audit_log WHERE action='admin_disabled' AND target=$1`, [`admin:${a.id}`]);
    expect(dis).toEqual([{ action: "admin_disabled", admin_email: a.email }]);
    expect(await m.adm.loginAdmin(a.email, ADMIN_PW)).toBeNull();
  });
  it("an admin with NO audit history can still be deleted (no pointless lock-in), and nothing else cascades into audit_log", async () => {
    const r = await m.db.queryOne<{ id: string }>(`INSERT INTO admins (email, password_hash) VALUES ($1, 'x') RETURNING id`, [`clean${Date.now()}@example.test`]);
    await m.db.query(`DELETE FROM admins WHERE id=$1`, [r!.id]);
    const fks = await m.db.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='audit_log'::regclass AND contype='f'`);
    expect(fks).toHaveLength(1);
    expect(fks[0].def).toMatch(/ON DELETE RESTRICT/);
    expect(fks[0].def).not.toMatch(/SET NULL|CASCADE/);
  });
  it("re-enabling via --reset-password is audited (enable + reset + sessions revoked) with the actor email", async () => {
    const a = await mkAdmin();
    const t = (await m.adm.loginAdmin(a.email, ADMIN_PW, "ua", "10.1.1.3"))!.token;
    await m.db.query(`UPDATE admins SET disabled_at = now() WHERE id=$1`, [a.id]);
    await m.adm.createAdmin(a.email, "A-totally-different-passphrase-1", { resetIfExists: true });
    expect(await m.adm.readAdminToken(t)).toBeNull();
    const acts = (await m.db.query<{ action: string }>(`SELECT action FROM audit_log WHERE admin_email=$1 ORDER BY created_at, action`, [a.email])).map((r) => r.action);
    expect(acts).toEqual(expect.arrayContaining(["admin_created_cli", "admin_login", "admin_disabled", "admin_enabled", "admin_password_reset_cli", "admin_sessions_revoked"]));
    const rev = await m.db.queryOne<{ target: string; reason: string }>(`SELECT target, reason FROM audit_log WHERE action='admin_sessions_revoked' AND admin_email=$1`, [a.email]);
    expect(rev!.reason).toBe("password_reset");
    expect(rev!.target).toMatch(/sessions_revoked: 1/);
  });
  it("the migration is idempotent: re-running 011 on a populated DB succeeds, keeps rows and keeps the triggers", async () => {
    const fs = await import("node:fs");
    const sql = fs.readFileSync("db/migrations/011_audit_hardening.sql", "utf8");
    const before = await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log`);
    await m.db.pool().query(sql);
    await m.db.pool().query(sql);
    expect((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log`))!.n).toBe(before!.n);
    await expect(m.db.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
  });
});

describe.skipIf(!available)("AH-2 failed admin logins are audited, bounded, and invisible to the client", () => {
  const failures = (extra = "") => m.db.query<{ admin_email: string; ip: string; reason: string; target: string; created_at: string }>(
    `SELECT admin_email, ip, reason, target, created_at FROM audit_log WHERE action='admin_login_failed' ${extra} ORDER BY created_at`);
  it("unknown email, wrong password and disabled account each write a row with attempted email, ip, reason code, timestamp; every call returns the same null", async () => {
    const a = await mkAdmin();
    const dis = await mkAdmin();
    await m.db.query(`UPDATE admins SET disabled_at = now() WHERE id=$1`, [dis.id]);
    const ghost = `ghost${Date.now()}@example.test`;
    const r = await Promise.all([
      m.adm.loginAdmin(ghost, ADMIN_PW, "ua", "10.2.0.1"), m.adm.loginAdmin(a.email, "wrong-wrong-wrong-1", "ua", "10.2.0.2"), m.adm.loginAdmin(dis.email, ADMIN_PW, "ua", "10.2.0.3"),
    ]);
    expect(r).toEqual([null, null, null]); // identical outcome whatever the reason
    const rows = await failures(`AND admin_email IN ('${ghost}','${a.email}','${dis.email}')`);
    const by = Object.fromEntries(rows.map((x) => [x.admin_email, x]));
    expect(by[ghost]).toMatchObject({ reason: "unknown_email", ip: "10.2.0.1" });
    expect(by[a.email]).toMatchObject({ reason: "bad_password", ip: "10.2.0.2" });
    expect(by[dis.email]).toMatchObject({ reason: "disabled", ip: "10.2.0.3" });
    expect(rows.every((x) => !!x.created_at)).toBe(true);
    // a failed attempt does not create or link to an admin; no admin_id on the row
    expect(Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE action='admin_login_failed' AND admin_id IS NOT NULL`))!.n)).toBe(0);
  });
  it("no password or hash ever lands in audit_log (any column), for failures and successes", async () => {
    const a = await mkAdmin();
    const pw = "Wrong-Secret-Passphrase-ZZZ-9";
    await m.adm.loginAdmin(a.email, pw, "ua", "10.2.1.1");
    await m.adm.loginAdmin(a.email, ADMIN_PW, "ua", "10.2.1.1");
    const hash = (await m.db.queryOne<{ password_hash: string }>(`SELECT password_hash FROM admins WHERE id=$1`, [a.id]))!.password_hash;
    const all = JSON.stringify(await m.db.query(`SELECT * FROM audit_log`));
    expect(all).not.toContain(pw);
    expect(all).not.toContain(ADMIN_PW);
    expect(all).not.toContain(hash);
    expect(all).not.toMatch(/\$2[aby]\$/);
  });
  it("flooding is bounded: 60 identical failures from one ip+email write 1 row + a milestone row at 10 (not 60); next window folds the count", async () => {
    const email = `flood${Date.now()}@example.test`;
    for (let i = 0; i < 60; i++) await m.auditMod.auditFailedAdminLogin(email, "bad_password", "10.3.0.1"); // the audit step in isolation (bcrypt per call would just slow the loop)
    const rows = await failures(`AND admin_email='${email}'`);
    expect(rows.length).toBe(2);
    expect(rows[0].target).toBe("failed admin login");
    expect(rows[1].target).toMatch(/repeated 10x/);
    // new window: age the bucket, the first row of the new window states how many were folded
    await m.db.query(`UPDATE admin_login_failure_buckets SET window_start = now() - interval '1 hour' WHERE bucket LIKE 'f:%'`);
    await m.auditMod.auditFailedAdminLogin(email, "bad_password", "10.3.0.1");
    const rows2 = await failures(`AND admin_email='${email}'`);
    expect(rows2.length).toBe(3);
    expect(rows2[2].target).toMatch(/\+59 repeats folded/);
  });
  it("many DIFFERENT emails/ips are capped by the global hourly limit: bounded rows plus exactly one 'admin_login_flood' marker", async () => {
    await m.db.query(`DELETE FROM admin_login_failure_buckets`); // the side table is operational state (not the trail)
    const cap = m.auditMod.FAILED_LOGIN_AUDIT.globalPerHour;
    const before = Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE action IN ('admin_login_failed','admin_login_flood')`))!.n);
    const N = cap + 40;
    for (let i = 0; i < N; i += 20) await Promise.all(Array.from({ length: Math.min(20, N - i) }, (_, k) => m.auditMod.auditFailedAdminLogin(`spray${i + k}-${Date.now()}@example.test`, "unknown_email", `10.4.${(i + k) % 250}.1`)));
    const after = Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE action IN ('admin_login_failed','admin_login_flood')`))!.n);
    expect(after - before).toBeLessThanOrEqual(cap + 1);
    expect(Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE action='admin_login_flood'`))!.n)).toBeLessThanOrEqual(2); // 1 per hour (a test straddling the hour boundary may see 2)
  });
  it("hostile attempted emails are sanitised and truncated, never fail the request, never reach SQL raw", async () => {
    await m.db.query(`DELETE FROM admin_login_failure_buckets`);
    const nul = `nul\u0000byte${Date.now()}@example.test`;
    expect(await m.adm.loginAdmin(nul, "bad-bad-bad-bad-1", "ua", "10.5.0.1")).toBeNull();
    const long = "L".repeat(5000) + "@example.test";
    expect(await m.adm.loginAdmin(long, "bad-bad-bad-bad-1", "ua", "10.5.0.2")).toBeNull();
    const lone = `lone\uD800${Date.now()}@example.test`;
    expect(await m.adm.loginAdmin(lone, "x", "ua", "x".repeat(500))).toBeNull();
    const rows = await failures(`AND ip IN ('10.5.0.1','10.5.0.2') OR ip LIKE 'xxxx%'`);
    expect(rows.length).toBe(3);
    for (const r of rows) { expect(r.admin_email.length).toBeLessThanOrEqual(100); expect(r.admin_email).not.toContain("\u0000"); expect(r.ip.length).toBeLessThanOrEqual(64); }
  });
  it("a successful login after failures is audited as admin_login (with ip) and logout as admin_logout", async () => {
    const a = await mkAdmin();
    await m.adm.loginAdmin(a.email, "bad-bad-bad-bad-1", "ua", "10.6.0.1");
    const ok = (await m.adm.loginAdmin(a.email, ADMIN_PW, "ua", "10.6.0.1"))!;
    await m.adm.revokeAdminToken(ok.token);
    await m.adm.revokeAdminToken(ok.token); // second revoke is a no-op and writes nothing
    const rows = await m.db.query<{ action: string; ip: string | null }>(`SELECT action, ip FROM audit_log WHERE admin_email=$1 AND action IN ('admin_login','admin_logout','admin_login_failed') ORDER BY created_at`, [a.email]);
    expect(rows.map((r) => r.action)).toEqual(["admin_login_failed", "admin_login", "admin_logout"]);
    expect(rows[1].ip).toBe("10.6.0.1");
  });
});

describe.skipIf(!available)("AH-3 input hygiene (NUL / lone surrogates / oversize / malformed ids) never becomes a 500", () => {
  it("createAdmin / loginAdmin reject or null out NUL, lone surrogate and oversize text without touching SQL errors", async () => {
    await expect(m.adm.createAdmin("a\u0000@example.test", ADMIN_PW)).rejects.toThrow(/invalid email/);
    await expect(m.adm.createAdmin("a@example.test", "pw\u0000" + ADMIN_PW)).rejects.toThrow(/invalid characters/);
    await expect(m.adm.createAdmin("a@example.test", "\uD800" + ADMIN_PW)).rejects.toThrow(/invalid characters/);
    await expect(m.adm.createAdmin("a".repeat(300) + "@example.test", ADMIN_PW)).rejects.toThrow(/invalid email/);
    expect(await m.adm.loginAdmin("a\u0000@example.test", "x")).toBeNull();
    expect(await m.adm.loginAdmin("a@example.test", "p\u0000w")).toBeNull();
    expect(await m.adm.loginAdmin("a".repeat(300) + "@example.test", "x")).toBeNull();
  });
  it("malformed ids (incl. 36 dashes, which the old regex accepted) -> clean not-found, never a Postgres error", async () => {
    const dashes = "-".repeat(36);
    const bad = [dashes, "garbage", "00000000-0000-0000-0000-00000000000g", "0".repeat(36), "\u0000", " ", "' OR 1=1 --"];
    const a = await mkAdmin();
    for (const id of bad) {
      await expect(m.admq.clearSellerFlag(a.id, id, "valid note")).rejects.toMatchObject({ status: 404 });
      expect((await m.admq.listSellerTransactions(id)).seller).toBeNull();
      expect(await m.co.getCheckoutStatus(id)).toBeNull();
    }
    const imgs = await import("../../src/server/services/images");
    const drops = await import("../../src/server/services/drops");
    const s = await seed();
    for (const id of bad) {
      expect(await imgs.getFileRow(id)).toBeNull();
      await expect(drops.getOwnedDrop(s.sellerId, id)).rejects.toMatchObject({ status: 404 });
    }
  }, 30_000);
  it("dev simulator: NUL / oversize / unknown session ids are a clean 404", async () => {
    for (const id of ["a\u0000b", "x".repeat(101), "\uD800", "nope"]) await expect(m.sim.simulatePayment(id, "4242424242424242")).rejects.toMatchObject({ status: 404 });
  });
});

// =====================================================================================================================
// QA round 4: NEW-4 (reset-password vs in-flight login race), NEW-5 (login throttle 500 under concurrency)
// =====================================================================================================================
describe.skipIf(!available)("R4 NEW-4: no live admin session survives a password reset / disable that commits mid-login", () => {
  const live = async (adminId: string) => Number((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM admin_sessions WHERE admin_id=$1 AND revoked_at IS NULL AND expires_at > now()`, [adminId]))!.n);
  /** Parks the next loginAdmin after its bcrypt check; returns {parked, release}. */
  function park() {
    let release!: () => void; let parked!: () => void;
    const p = new Promise<void>((r) => (parked = r)); const rel = new Promise<void>((r) => (release = r));
    gate.hold = async () => { gate.hold = null; parked(); await rel; };
    return { parked: p, release };
  }
  it("DETERMINISTIC: password check passes, reset commits, THEN the session insert runs -> login fails with the uniform null, zero live sessions, audited as 'superseded'", async () => {
    const a = await mkAdmin();
    const { parked, release } = park();
    const login = m.adm.loginAdmin(a.email, ADMIN_PW, "ua", "10.7.0.1"); // old password: bcrypt succeeds, then parks
    await parked;
    await m.adm.createAdmin(a.email, "A-totally-different-passphrase-1", { resetIfExists: true }); // commits (revokes everything that exists NOW)
    release();
    expect(await login).toBeNull();
    expect(await live(a.id)).toBe(0);
    expect(await m.adm.loginAdmin(a.email, ADMIN_PW)).toBeNull();
    const row = await m.db.queryOne<{ reason: string; ip: string }>(`SELECT reason, ip FROM audit_log WHERE action='admin_login_failed' AND admin_email=$1 AND reason='superseded'`, [a.email]);
    expect(row).toMatchObject({ reason: "superseded", ip: "10.7.0.1" });
    expect(await m.adm.loginAdmin(a.email, "A-totally-different-passphrase-1")).not.toBeNull(); // the new password works
  });
  it("DETERMINISTIC: an admin disabled between the password check and the session insert cannot get a session either", async () => {
    const a = await mkAdmin();
    const { parked, release } = park();
    const login = m.adm.loginAdmin(a.email, ADMIN_PW, "ua", "10.7.0.2");
    await parked;
    await m.db.query(`UPDATE admins SET disabled_at = now() WHERE id=$1`, [a.id]);
    release();
    expect(await login).toBeNull();
    expect(await live(a.id)).toBe(0);
    expect((await m.db.queryOne<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE action='admin_login_failed' AND admin_email=$1 AND reason='superseded'`, [a.email]))!.n).toBe("1");
  });
  it("DETERMINISTIC (other order): the login's insert holds the row first, the reset waits for it and then revokes the fresh session", async () => {
    const a = await mkAdmin();
    // hold the admin row with FOR SHARE in a side transaction, exactly what the session insert takes
    const c = await m.db.pool().connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT 1 FROM admins WHERE id=$1 FOR SHARE`, [a.id]);
      const reset = m.adm.createAdmin(a.email, "A-totally-different-passphrase-1", { resetIfExists: true }); // must block on our lock
      const early = await Promise.race([reset.then(() => "done"), new Promise((r) => setTimeout(() => r("blocked"), 400))]);
      expect(early).toBe("blocked");
      await c.query(`INSERT INTO admin_sessions (admin_id, expires_at, credentials_version) SELECT id, now() + interval '1 hour', credentials_version FROM admins WHERE id=$1`, [a.id]);
      await c.query("COMMIT");
      await reset;
    } finally { c.release(); }
    expect(await live(a.id)).toBe(0); // the session minted just before the reset committed was revoked by it
  });
  it("STRESS: 12 rounds of an old-password login loop racing a reset; afterwards NO session minted for the old credentials is live", async () => {
    for (let round = 0; round < 12; round++) {
      const a = await mkAdmin();
      let stop = false; const tokens: string[] = [];
      const attacker = (async () => { while (!stop) { const r = await m.adm.loginAdmin(a.email, ADMIN_PW, "ua", `10.8.${round}.1`); if (r) tokens.push(r.token); } })();
      const attacker2 = (async () => { while (!stop) { const r = await m.adm.loginAdmin(a.email, ADMIN_PW, "ua", `10.8.${round}.2`); if (r) tokens.push(r.token); } })();
      await new Promise((r) => setTimeout(r, 150 + round * 40)); // sweep the reset across the bcrypt window
      await m.adm.createAdmin(a.email, "A-totally-different-passphrase-1", { resetIfExists: true });
      await new Promise((r) => setTimeout(r, 700));
      stop = true; await Promise.all([attacker, attacker2]);
      expect(await live(a.id)).toBe(0);
      for (const t of tokens) expect(await m.adm.readAdminToken(t)).toBeNull();
    }
  }, 120_000);
  it("sessions are bound to the credentials version: a surviving pre-reset row is rejected even if it was never revoked; disable/enable and password change bump the version", async () => {
    const a = await mkAdmin();
    const v0 = (await m.db.queryOne<{ credentials_version: number }>(`SELECT credentials_version FROM admins WHERE id=$1`, [a.id]))!.credentials_version;
    const { token } = (await m.adm.loginAdmin(a.email, ADMIN_PW))!;
    expect(await m.adm.readAdminToken(token)).not.toBeNull();
    await m.db.query(`UPDATE admins SET last_login_at = now() WHERE id=$1`, [a.id]); // unrelated column: no bump
    expect((await m.db.queryOne<{ credentials_version: number }>(`SELECT credentials_version FROM admins WHERE id=$1`, [a.id]))!.credentials_version).toBe(v0);
    await m.db.query(`UPDATE admins SET password_hash = password_hash || '' , disabled_at = NULL WHERE id=$1`, [a.id]); // same values: no bump
    expect(await m.adm.readAdminToken(token)).not.toBeNull();
    const h = await (await import("../../src/server/auth/password")).hashPassword("Another-Long-Passphrase-77");
    await m.db.query(`UPDATE admins SET password_hash = $2 WHERE id=$1`, [a.id, h]); // plain SQL password change, sessions NOT revoked
    expect((await m.db.queryOne<{ revoked_at: string | null }>(`SELECT revoked_at FROM admin_sessions WHERE admin_id=$1`, [a.id]))!.revoked_at).toBeNull();
    expect(await m.adm.readAdminToken(token)).toBeNull(); // dead anyway
    expect((await m.db.queryOne<{ credentials_version: number }>(`SELECT credentials_version FROM admins WHERE id=$1`, [a.id]))!.credentials_version).toBe(v0 + 1);
    await m.db.query(`UPDATE admins SET disabled_at = now() WHERE id=$1`, [a.id]);
    await m.db.query(`UPDATE admins SET disabled_at = NULL WHERE id=$1`, [a.id]);
    expect((await m.db.queryOne<{ credentials_version: number }>(`SELECT credentials_version FROM admins WHERE id=$1`, [a.id]))!.credentials_version).toBe(v0 + 3);
  });
});

describe.skipIf(!available)("R4 NEW-5: login throttle never throws under concurrency", () => {
  it("30 concurrent admissions racing 30 successful-login resets for ONE email: no exception, every result is admitted or delayed", async () => {
    const lt = await import("../../src/server/ratelimit/login-throttle");
    const cfg = { threshold: 3, baseSec: 1, capSec: 4, decaySec: 600 };
    for (let round = 0; round < 5; round++) {
      const email = `conc${round}-${Date.now()}@example.test`;
      const jobs: Promise<unknown>[] = [];
      for (let i = 0; i < 30; i++) {
        jobs.push(lt.admitLoginAttempt(email, cfg));
        jobs.push(lt.resetLoginThrottle(email));
      }
      const res = await Promise.allSettled(jobs);
      const bad = res.filter((r) => r.status === "rejected");
      expect(bad.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    }
  }, 60_000);
  it("admin and seller login flows (service level): 30 parallel correct-password admin logins -> all succeed or are cleanly refused, none throw", async () => {
    const a = await mkAdmin();
    const lt = await import("../../src/server/ratelimit/login-throttle");
    const one = async () => {
      const adm = await lt.admitLoginAttempt(`admin:${a.email}`, { threshold: 3, baseSec: 1, capSec: 4, decaySec: 600 });
      if (!adm.admitted) return "delayed";
      const r = await m.adm.loginAdmin(a.email, ADMIN_PW, "ua", "10.9.0.1");
      if (r) await lt.resetLoginThrottle(`admin:${a.email}`);
      return r ? "ok" : "fail";
    };
    const out = await Promise.allSettled(Array.from({ length: 30 }, one));
    expect(out.filter((o) => o.status === "rejected")).toHaveLength(0);
    expect(out.some((o) => o.status === "fulfilled" && o.value === "ok")).toBe(true);
  }, 120_000);
});

// FE-15: per-drop Sold/Revenue (dashboard data layer, read-only query on `transactions`) must reconcile with the ledger's gross kept.
describe.skipIf(!available)("dashboard per-drop stats reconcile with the earnings summary (DB)", () => {
  it("partial refunds, full refunds and chargebacks are deducted; totals == gross - refunded - charged back", async () => {
    const dash = await import("../../src/app/dashboard/data");
    const s = await seed({ price: 2500 });
    const mk = async (price: number) => {
      const { transactionId: id } = await checkout(s);
      await deliver(sale(id, price));
      return id;
    };
    const a = await mk(2500); // untouched          -> kept 2500, 1 unit
    const b = await mk(2500); // partial $10 refund  -> kept 1500, 1 unit
    const c = await mk(2500); // full refund         -> kept 0,    0 units
    const d = await mk(2500); // chargeback          -> kept 0,    0 units
    await deliver(m.ev.mockEvents.refund({ transactionId: b, refundId: "rf_fe15_b", amountCents: 1000 }));
    await deliver(m.ev.mockEvents.refund({ transactionId: c, refundId: "rf_fe15_c", amountCents: 2500 }));
    await deliver(m.ev.mockEvents.chargeback({ transactionId: d, amountCents: null }));
    await checkout(s); // pending checkout: never counted
    void a;
    const stats = await dash.getDropStats(s.sellerId);
    expect(stats[s.dropId]).toMatchObject({ units: 2, revenueCents: 4000 });
    const e = await m.earn.getEarningsSummary(s.sellerId);
    const kept = e.lifetime.grossCents - e.lifetime.refundedCents - e.lifetime.chargebackCents;
    expect(kept).toBe(4000);
    expect(Object.values(stats).reduce((x, y) => x + y.revenueCents, 0)).toBe(kept);
  });
});
