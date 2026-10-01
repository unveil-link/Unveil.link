import { afterEach, beforeAll, describe, expect, it } from "vitest";

const SECRET = "unit-test-webhook-secret-unit-test-webhook-secret";
beforeAll(() => {
  process.env.DATABASE_URL = "postgres://unused/unused";
  process.env.APP_URL = "http://localhost:3000";
  process.env.PAYMENT_WEBHOOK_SECRET = SECRET;
});
const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, L: env.MOCK_PAYMENTS_LOCAL_BUILD, P: env.PAYMENT_PROVIDER, A: env.APP_URL };
// process.env coerces `= undefined` to the string "undefined", so restore via delete.
const restore = (k: string, v: string | undefined) => { if (v === undefined) delete env[k]; else env[k] = v; };
afterEach(() => {
  restore("NODE_ENV", saved.NODE_ENV); restore("MOCK_PAYMENTS_LOCAL_BUILD", saved.L); restore("PAYMENT_PROVIDER", saved.P); restore("APP_URL", saved.A);
  env.PAYMENT_WEBHOOK_SECRET = SECRET;
});

describe("webhook HMAC signature", async () => {
  const { signPayload, verifySignature } = await import("../src/server/payments/signature");
  const body = '{"id":"evt_1","type":"sale.succeeded"}';
  const now = 1_800_000_000;
  const good = () => signPayload(SECRET, body, now);

  it("accepts a valid signature", () => {
    expect(verifySignature({ secret: SECRET, rawBody: body, header: good(), nowSec: now })).toBe("ok");
  });
  it("accepts within the tolerance window and rejects outside it (stale / future)", () => {
    expect(verifySignature({ secret: SECRET, rawBody: body, header: good(), nowSec: now + 299, toleranceSec: 300 })).toBe("ok");
    expect(verifySignature({ secret: SECRET, rawBody: body, header: good(), nowSec: now + 301, toleranceSec: 300 })).toBe("stale");
    expect(verifySignature({ secret: SECRET, rawBody: body, header: good(), nowSec: now - 301, toleranceSec: 300 })).toBe("stale");
  });
  it("rejects a tampered body (even one byte / whitespace)", () => {
    expect(verifySignature({ secret: SECRET, rawBody: body.replace("evt_1", "evt_2"), header: good(), nowSec: now })).toBe("bad_signature");
    expect(verifySignature({ secret: SECRET, rawBody: body + " ", header: good(), nowSec: now })).toBe("bad_signature");
  });
  it("rejects the wrong secret", () => {
    const h = signPayload("another-secret-another-secret-another-secret", body, now);
    expect(verifySignature({ secret: SECRET, rawBody: body, header: h, nowSec: now })).toBe("bad_signature");
  });
  it("rejects a tampered timestamp (the timestamp is inside the MAC)", () => {
    const h = good().replace(`t=${now}`, `t=${now + 10}`);
    expect(verifySignature({ secret: SECRET, rawBody: body, header: h, nowSec: now })).toBe("bad_signature");
  });
  it("rejects missing / malformed headers and an unset server secret", () => {
    expect(verifySignature({ secret: SECRET, rawBody: body, header: null, nowSec: now })).toBe("missing");
    expect(verifySignature({ secret: SECRET, rawBody: body, header: "garbage", nowSec: now })).toBe("malformed");
    expect(verifySignature({ secret: SECRET, rawBody: body, header: `t=abc,v1=${"a".repeat(64)}`, nowSec: now })).toBe("malformed");
    expect(verifySignature({ secret: SECRET, rawBody: body, header: `t=${now}`, nowSec: now })).toBe("malformed");
    expect(verifySignature({ secret: SECRET, rawBody: body, header: `t=${now},v1=zz`, nowSec: now })).toBe("bad_signature");
    expect(verifySignature({ secret: SECRET, rawBody: body, header: `t=${now},v1=${"0".repeat(64)}`, nowSec: now })).toBe("bad_signature");
    expect(verifySignature({ secret: "", rawBody: body, header: good(), nowSec: now })).toBe("no_secret");
  });
});

describe("mock provider verifyWebhook (signature + normalization)", async () => {
  const { mockProvider } = await import("../src/server/payments/mock");
  const { mockEvents, signMockEvent, mockSaleId } = await import("../src/server/payments/mock/events");
  const TX = "11111111-1111-4111-8111-111111111111";
  const verify = (rawBody: string, headers: Record<string, string>) => mockProvider.verifyWebhook({ rawBody, headers: new Headers(headers) });

  it("normalizes each event type", () => {
    const cases = [
      [mockEvents.saleSucceeded({ transactionId: TX, amountCents: 2000 }), "sale_succeeded"],
      [mockEvents.saleFailed({ transactionId: TX, amountCents: 2000, failureCode: "card_declined" }), "sale_failed"],
      [mockEvents.refund({ transactionId: TX, refundId: "mockrf_1", amountCents: 500 }), "refunded"],
      [mockEvents.chargeback({ transactionId: TX, amountCents: null }), "chargeback"],
    ] as const;
    for (const [ev, type] of cases) {
      const s = signMockEvent(ev, SECRET);
      const v = verify(s.rawBody, s.headers);
      expect(v.ok).toBe(true);
      if (v.ok) {
        expect(v.event).toMatchObject({ provider: "mock", eventId: ev.id, type, merchantReference: TX, currency: "USD" });
      }
    }
    const s = signMockEvent(mockEvents.refund({ transactionId: TX, refundId: "mockrf_1", amountCents: 500 }), SECRET);
    const v = verify(s.rawBody, s.headers);
    if (v.ok) expect(v.event).toMatchObject({ providerTransactionId: "mockrf_1", relatedProviderTransactionId: mockSaleId(TX), amountCents: 500 });
  });
  it("bad signature -> {ok:false, signatureValid:false}; nothing parsed", () => {
    const s = signMockEvent(mockEvents.saleSucceeded({ transactionId: TX, amountCents: 2000 }), "wrong-secret-wrong-secret-wrong-secret!");
    expect(verify(s.rawBody, s.headers)).toEqual({ ok: false, signatureValid: false, reason: "signature_bad_signature" });
    expect(verify(s.rawBody, {})).toMatchObject({ ok: false, signatureValid: false, reason: "signature_missing" });
  });
  it("stale timestamp -> rejected (replay window)", () => {
    const s = signMockEvent(mockEvents.saleSucceeded({ transactionId: TX, amountCents: 2000 }), SECRET, { nowSec: Math.floor(Date.now() / 1000) - 3600 });
    expect(verify(s.rawBody, s.headers)).toMatchObject({ ok: false, signatureValid: false, reason: "signature_stale" });
  });
  it("authentic but malformed payload -> signatureValid:true, not ok", () => {
    const bad = signMockEvent({ hello: "world" }, SECRET);
    expect(verify(bad.rawBody, bad.headers)).toEqual({ ok: false, signatureValid: true, reason: "invalid_payload" });
    const notJson = signMockEvent({}, SECRET);
    const raw = "not json";
    const hdr = signMockEvent({}, SECRET).headers;
    void notJson;
    expect(verify(raw, hdr)).toMatchObject({ ok: false, signatureValid: false }); // MAC is over a different body
  });
  it("rejects negative / zero / fractional amounts and bad currency", () => {
    for (const amount of [-5, 0, 1.5]) {
      const ev = mockEvents.saleSucceeded({ transactionId: TX, amountCents: amount });
      const s = signMockEvent(ev, SECRET);
      expect(verify(s.rawBody, s.headers)).toMatchObject({ ok: false, signatureValid: true });
    }
  });
});

describe("mock test cards", async () => {
  const { cardOutcome, TEST_CARDS } = await import("../src/server/payments/mock/cards");
  it("deterministic outcome by last four digits", () => {
    expect(cardOutcome(TEST_CARDS.approved)).toEqual({ approved: true });
    expect(cardOutcome("5555 5555 5555 4242")).toEqual({ approved: true });
    expect(cardOutcome(TEST_CARDS.declined)).toEqual({ approved: false, failureCode: "card_declined" });
    expect(cardOutcome(TEST_CARDS.insufficientFunds)).toEqual({ approved: false, failureCode: "insufficient_funds" });
    expect(cardOutcome(TEST_CARDS.expired)).toEqual({ approved: false, failureCode: "expired_card" });
    expect(cardOutcome(TEST_CARDS.badCvc)).toEqual({ approved: false, failureCode: "incorrect_cvc" });
    expect(cardOutcome("4111111111111111")).toEqual({ approved: false, failureCode: "unrecognized_test_card" });
    expect(cardOutcome("abc")).toEqual({ approved: false, failureCode: "invalid_card_number" });
  });
});

describe("the mock can never run in production", async () => {
  const { config } = await import("../src/server/config");
  const { mockProvider } = await import("../src/server/payments/mock");
  const { activeProvider, findProvider, registeredProviderNames } = await import("../src/server/payments/registry");
  const { assertSimulatorEnabled } = await import("../src/server/payments/dev/simulator");

  it("is available outside production", () => {
    env.NODE_ENV = "test";
    expect(config.mockPaymentsAllowed).toBe(true);
    expect(mockProvider.availability()).toEqual({ ok: true });
    expect(activeProvider().name).toBe("mock");
    expect(() => assertSimulatorEnabled()).not.toThrow();
  });
  it("is disabled when NODE_ENV=production: provider unavailable, registry refuses, simulator 404s", () => {
    env.NODE_ENV = "production";
    delete env.MOCK_PAYMENTS_LOCAL_BUILD;
    expect(config.mockPaymentsAllowed).toBe(false);
    expect(mockProvider.availability().ok).toBe(false);
    expect(() => activeProvider()).toThrowError(/not available/i);
    expect(() => assertSimulatorEnabled()).toThrowError(/not found/i);
  });
  it("the local-build escape hatch needs MOCK_PAYMENTS_LOCAL_BUILD=1 AND a loopback APP_URL", () => {
    env.NODE_ENV = "production";
    env.MOCK_PAYMENTS_LOCAL_BUILD = "1";
    env.APP_URL = "http://localhost:3100";
    expect(config.mockPaymentsAllowed).toBe(true);
    env.APP_URL = "http://127.0.0.1:3100";
    expect(config.mockPaymentsAllowed).toBe(true);
    for (const url of ["https://unveil.link", "https://localhost.evil.example", "http://10.0.0.5", "not a url"]) {
      env.APP_URL = url;
      expect(config.mockPaymentsAllowed, url).toBe(false);
    }
    env.APP_URL = "http://localhost:3100";
    env.MOCK_PAYMENTS_LOCAL_BUILD = "true";
    expect(config.mockPaymentsAllowed).toBe(false);
  });
  it("needs a real webhook secret; unknown provider names are not resolvable (incl. prototype keys)", () => {
    env.NODE_ENV = "test";
    env.PAYMENT_WEBHOOK_SECRET = "short";
    expect(mockProvider.availability().ok).toBe(false);
    expect(registeredProviderNames()).toContain("mock");
    for (const n of ["nope", "__proto__", "constructor", "toString", ""]) expect(findProvider(n)).toBeNull();
    env.PAYMENT_PROVIDER = "segpay";
    env.PAYMENT_WEBHOOK_SECRET = SECRET;
    expect(() => activeProvider()).toThrowError(/not configured/i);
  });
});
