import crypto from "node:crypto";
import { z } from "zod";
import { config } from "../../config";
import type {
  CheckoutSession, CheckoutSessionInput, NormalizedPaymentEvent, PaymentEventType, PaymentProvider,
  PayoutInput, PayoutResult, RefundInput, RefundResult, WebhookVerification,
} from "../types";
import { SIGNATURE_HEADER, verifySignature } from "../signature";
import { mockRefundId } from "./events";

/**
 * MOCK processor. No network, no money. Everything processor-specific about it (wire format, ids, test cards,
 * signature header) lives under src/server/payments/mock/. It can never run in production: `availability()` is false
 * whenever config.mockPaymentsAllowed is false, and the registry/checkout/webhook route all honour that.
 */
const wireSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(["sale.succeeded", "sale.failed", "refund.created", "chargeback.created"]),
  created: z.string().min(1).max(64),
  data: z.object({
    transaction_id: z.string().min(1).max(200),
    related_transaction_id: z.string().min(1).max(200).nullish(),
    reference: z.string().min(1).max(200).nullish(),
    amount_cents: z.number().int().positive().max(100_000_000).nullish(),
    currency: z.string().length(3),
    failure_code: z.string().max(100).nullish(),
  }),
});

const TYPE_MAP: Record<z.infer<typeof wireSchema>["type"], PaymentEventType> = {
  "sale.succeeded": "sale_succeeded",
  "sale.failed": "sale_failed",
  "refund.created": "refunded",
  "chargeback.created": "chargeback",
};

export const mockProvider: PaymentProvider = {
  name: "mock",

  availability() {
    if (!config.mockPaymentsAllowed) return { ok: false, reason: "mock payment provider is disabled in production" };
    if (config.payments.webhookSecret.length < 32) return { ok: false, reason: "PAYMENT_WEBHOOK_SECRET (>= 32 chars) is required" };
    return { ok: true };
  },

  processingFeePercent: () => config.payments.mockProcessingFeePercent,

  async createCheckoutSession(_input: CheckoutSessionInput): Promise<CheckoutSession> {
    void _input;
    const providerSessionId = `mocksess_${crypto.randomBytes(16).toString("hex")}`;
    return { providerSessionId, redirectUrl: `${config.appUrl}/pay/mock/${providerSessionId}` };
  },

  verifyWebhook({ rawBody, headers }): WebhookVerification {
    const check = verifySignature({
      secret: config.payments.webhookSecret,
      rawBody,
      header: headers.get(SIGNATURE_HEADER),
      toleranceSec: config.payments.webhookToleranceSeconds,
    });
    if (check !== "ok") return { ok: false, signatureValid: false, reason: `signature_${check}` };
    let json: unknown;
    try { json = JSON.parse(rawBody); } catch { return { ok: false, signatureValid: true, reason: "invalid_json" }; }
    const p = wireSchema.safeParse(json);
    if (!p.success) return { ok: false, signatureValid: true, reason: "invalid_payload" };
    const d = p.data;
    const created = Date.parse(d.created);
    const event: NormalizedPaymentEvent = {
      provider: "mock",
      eventId: d.id,
      type: TYPE_MAP[d.type],
      rawType: d.type,
      providerTransactionId: d.data.transaction_id,
      relatedProviderTransactionId: d.data.related_transaction_id ?? null,
      merchantReference: d.data.reference ?? null,
      amountCents: d.data.amount_cents ?? null,
      currency: d.data.currency.toUpperCase(),
      failureCode: d.data.failure_code ?? null,
      occurredAt: Number.isFinite(created) ? new Date(created).toISOString() : new Date().toISOString(),
    };
    return { ok: true, event };
  },

  /** The mock only acknowledges; the dev simulator (payments/dev) then delivers the signed `refund.created` webhook. */
  async issueRefund(input: RefundInput): Promise<RefundResult> {
    return { providerRefundId: mockRefundId(input.idempotencyKey), status: "accepted" };
  },

  async recordPayout(input: PayoutInput): Promise<PayoutResult> {
    return { providerRef: `mockpo_${crypto.createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24)}`, status: "recorded" };
  },
};
