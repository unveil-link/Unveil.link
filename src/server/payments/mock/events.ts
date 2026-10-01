import crypto from "node:crypto";
import { signPayload, SIGNATURE_HEADER } from "../signature";

/** The mock processor's WIRE format (what it POSTs to /api/webhooks/mock). Only mock/index.ts parses it. */
export type MockWireType = "sale.succeeded" | "sale.failed" | "refund.created" | "chargeback.created";
export interface MockWireEvent {
  id: string;
  type: MockWireType;
  created: string;
  data: {
    transaction_id: string;
    related_transaction_id?: string | null;
    reference?: string | null;
    amount_cents?: number | null;
    currency: string;
    failure_code?: string | null;
  };
}

const h = (s: string, n = 24) => crypto.createHash("sha256").update(s).digest("hex").slice(0, n);
/** Deterministic processor-side ids, so tests/simulators can name a sale's id before the sale event exists. */
export const mockSaleId = (ourTransactionId: string) => `mocktx_${h(ourTransactionId)}`;
export const mockRefundId = (idempotencyKey: string) => `mockrf_${h(idempotencyKey)}`;
export const mockChargebackId = (ourTransactionId: string, n = 1) => `mockcb_${h(`${ourTransactionId}:cb:${n}`)}`;
export const newEventId = () => `evt_${crypto.randomBytes(12).toString("hex")}`;

type Common = { eventId?: string; created?: Date; currency?: string };
/** Builders for each mock event. `transactionId` is OUR transactions.id (echoed back as `reference`). */
export const mockEvents = {
  saleSucceeded: (p: Common & { transactionId: string; amountCents: number; reference?: string | null; saleId?: string }): MockWireEvent => ({
    id: p.eventId ?? newEventId(), type: "sale.succeeded", created: (p.created ?? new Date()).toISOString(),
    data: { transaction_id: p.saleId ?? mockSaleId(p.transactionId), reference: p.reference === undefined ? p.transactionId : p.reference, amount_cents: p.amountCents, currency: p.currency ?? "USD" },
  }),
  saleFailed: (p: Common & { transactionId: string; amountCents: number; failureCode: string }): MockWireEvent => ({
    id: p.eventId ?? newEventId(), type: "sale.failed", created: (p.created ?? new Date()).toISOString(),
    data: { transaction_id: mockSaleId(p.transactionId), reference: p.transactionId, amount_cents: p.amountCents, currency: p.currency ?? "USD", failure_code: p.failureCode },
  }),
  refund: (p: Common & { transactionId: string; refundId: string; amountCents: number | null; saleId?: string }): MockWireEvent => ({
    id: p.eventId ?? newEventId(), type: "refund.created", created: (p.created ?? new Date()).toISOString(),
    data: { transaction_id: p.refundId, related_transaction_id: p.saleId ?? mockSaleId(p.transactionId), reference: p.transactionId, amount_cents: p.amountCents, currency: p.currency ?? "USD" },
  }),
  chargeback: (p: Common & { transactionId: string; amountCents: number | null; chargebackId?: string; saleId?: string }): MockWireEvent => ({
    id: p.eventId ?? newEventId(), type: "chargeback.created", created: (p.created ?? new Date()).toISOString(),
    data: { transaction_id: p.chargebackId ?? mockChargebackId(p.transactionId), related_transaction_id: p.saleId ?? mockSaleId(p.transactionId), reference: p.transactionId, amount_cents: p.amountCents, currency: p.currency ?? "USD" },
  }),
};

export interface SignedWebhookRequest { rawBody: string; headers: Record<string, string> }

/** Serialise + sign an event exactly as the mock processor would send it. Used by tests, the e2e and the dev simulator. */
export function signMockEvent(event: MockWireEvent | Record<string, unknown>, secret: string, opts: { nowSec?: number } = {}): SignedWebhookRequest {
  const rawBody = JSON.stringify(event);
  const t = opts.nowSec ?? Math.floor(Date.now() / 1000);
  return { rawBody, headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signPayload(secret, rawBody, t) } };
}
