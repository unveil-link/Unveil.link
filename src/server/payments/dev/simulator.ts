import { config } from "../../config";
import { HttpError } from "../../errors";
import { queryOne } from "../../db";
import { handleWebhook, type WebhookResult } from "../webhooks";
import { cardOutcome } from "../mock/cards";
import { mockEvents, mockRefundId, signMockEvent, type MockWireEvent } from "../mock/events";
import { requestRefund } from "../refunds";

/**
 * DEV-ONLY mock processor simulator: stands in for "the processor calls our webhook". It builds a mock wire event,
 * signs it with the real HMAC helper and runs it through the SAME pipeline as POST /api/webhooks/mock (handleWebhook).
 * Every entry point calls assertSimulatorEnabled(), and the routes under /api/dev/payments/* 404 when it is off
 * (production, see config.mockPaymentsAllowed).
 */
export function assertSimulatorEnabled(): void {
  if (!config.mockPaymentsAllowed || config.payments.provider !== "mock") {
    throw new HttpError(404, "Not found", "not_found");
  }
}

export async function deliverMockEvent(event: MockWireEvent): Promise<WebhookResult> {
  assertSimulatorEnabled();
  const signed = signMockEvent(event, config.payments.webhookSecret);
  return handleWebhook({ providerName: "mock", rawBody: signed.rawBody, headers: new Headers(signed.headers) });
}

interface SessionTx { id: string; amount_cents: number; currency: string; status: string }
async function txForSession(sessionId: string): Promise<SessionTx> {
  const tx = await queryOne<SessionTx>(
    `SELECT id, amount_cents, currency, status FROM transactions WHERE provider = 'mock' AND provider_session_id = $1`, [sessionId]);
  if (!tx) throw new HttpError(404, "Unknown checkout session", "unknown_session");
  return tx;
}

/** The hosted mock page's "Pay" button: the card number picks the outcome (see mock/cards.ts). The number is never stored. */
export async function simulatePayment(sessionId: string, cardNumber: string) {
  assertSimulatorEnabled();
  const tx = await txForSession(sessionId);
  if (tx.status !== "pending") return { transactionId: tx.id, status: tx.status, approved: tx.status === "succeeded", failureCode: null };
  const outcome = cardOutcome(cardNumber);
  const ev = outcome.approved
    ? mockEvents.saleSucceeded({ transactionId: tx.id, amountCents: tx.amount_cents, currency: tx.currency.trim() })
    : mockEvents.saleFailed({ transactionId: tx.id, amountCents: tx.amount_cents, currency: tx.currency.trim(), failureCode: outcome.failureCode });
  const res = await deliverMockEvent(ev);
  const after = await txForSession(sessionId);
  return { transactionId: tx.id, status: after.status, approved: outcome.approved, failureCode: outcome.approved ? null : outcome.failureCode, webhook: res.body };
}

/** Ops/dev: ask the (mock) processor for a refund, then play the processor's `refund.created` webhook. */
export async function simulateRefund(transactionId: string, amountCents?: number) {
  assertSimulatorEnabled();
  const requestId = crypto.randomUUID();
  const r = await requestRefund(transactionId, { amountCents, requestId });
  const tx = await queryOne<{ processor_ref: string }>(`SELECT processor_ref FROM transactions WHERE id = $1`, [transactionId]);
  const ev = mockEvents.refund({
    transactionId, refundId: mockRefundId(`${transactionId}:${requestId}`), amountCents: r.amountCents, saleId: tx!.processor_ref,
  });
  const res = await deliverMockEvent(ev);
  return { ...r, webhook: res.body };
}
