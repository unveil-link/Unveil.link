import { config } from "../../config";
import { HttpError } from "../../errors";
import { query, queryOne } from "../../db";
import { friendlyFailure, RETRYABLE_FAILURES } from "../../../../lib/purchase-copy";
import { expirePendingCheckouts } from "../checkout";
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

interface SessionTx {
  id: string; amount_cents: number; currency: string; status: string; failure_code: string | null; review_reason: string | null;
  seller_verified: boolean; drop_published: boolean;
}
async function txForSession(sessionId: string): Promise<SessionTx> {
  const tx = await queryOne<SessionTx>(
    `SELECT t.id, t.amount_cents, t.currency, t.status, t.failure_code, t.review_reason,
            (s.verification_status = 'verified') AS seller_verified, (d.status = 'published') AS drop_published
       FROM transactions t JOIN sellers s ON s.id = t.seller_id JOIN drops d ON d.id = t.drop_id
      WHERE t.provider = 'mock' AND t.provider_session_id = $1`, [sessionId]);
  if (!tx) throw new HttpError(404, "Unknown checkout session", "unknown_session");
  return tx;
}
const result = (tx: { id: string }, status: string, approved: boolean, failureCode: string | null, extra: object = {}) =>
  ({ transactionId: tx.id, status, approved, failureCode, message: approved ? null : friendlyFailure(failureCode), ...extra });

/**
 * The hosted page's "Pay" button: the card number picks the outcome (see mock/cards.ts). The number is never stored.
 * Like a real processor's hosted page it refuses to take payment for an expired session or a purchase that is no longer valid
 * (seller not verified / drop unpublished or flagged), and it lets the buyer retry after a CARD problem on the same session.
 */
export async function simulatePayment(sessionId: string, cardNumber: string) {
  assertSimulatorEnabled();
  await expirePendingCheckouts({ transactionId: (await txForSession(sessionId)).id });
  const tx = await txForSession(sessionId);
  if (tx.status === "succeeded") return result(tx, "succeeded", true, null);
  const retryable = tx.status === "failed" && !tx.review_reason && !!tx.failure_code && RETRYABLE_FAILURES.has(tx.failure_code);
  if (tx.status !== "pending" && !retryable) {
    return result(tx, tx.status, false, tx.failure_code ?? "unavailable");
  }
  if (!tx.seller_verified || !tx.drop_published) {
    await query(`UPDATE transactions SET status = 'failed', failure_code = 'unavailable', updated_at = now() WHERE id = $1 AND status IN ('pending','failed')`, [tx.id]);
    return result(tx, "failed", false, "unavailable");
  }
  const outcome = cardOutcome(cardNumber);
  const common = { transactionId: tx.id, amountCents: tx.amount_cents, currency: tx.currency.trim() };
  const ev = outcome.approved
    ? mockEvents.saleSucceeded(common)
    : mockEvents.saleFailed({ ...common, failureCode: outcome.failureCode, attemptId: crypto.randomUUID() });
  const res = await deliverMockEvent(ev);
  const after = await txForSession(sessionId);
  return result(tx, after.status, after.status === "succeeded", after.status === "succeeded" ? null : (after.failure_code ?? (outcome.approved ? "unavailable" : outcome.failureCode)), { webhook: res.body });
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
