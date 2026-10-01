/**
 * Processor-agnostic payment layer: the contract every processor (mock today, Segpay / CCBill later) implements.
 *
 * Rules the rest of the app relies on:
 *  - Money is ALWAYS integer cents. Currency is an ISO-4217 code (USD only for now).
 *  - Nothing outside `src/server/payments/<provider>/` may know a processor's wire format, parameter names or URLs.
 *  - A processor reaches us only through `verifyWebhook` -> `NormalizedPaymentEvent`. Webhooks are at-least-once and
 *    unordered, so the generic handler (../webhooks.ts) owns dedupe, ordering and ledger postings, never the provider.
 *  - Providers never touch the database.
 */

export type PaymentEventType = "sale_succeeded" | "sale_failed" | "refunded" | "chargeback";

export interface NormalizedPaymentEvent {
  provider: string;
  /**
   * Dedupe key, unique per provider. Use the processor's event id when it has one; otherwise derive a stable value from
   * (processor transaction id + event type), e.g. `${tranid}:${type}` (Segpay/CCBill document no idempotency key).
   */
  eventId: string;
  type: PaymentEventType;
  /** The processor's own label for the event (kept for reconciliation only). */
  rawType: string;
  /** The processor's id of THIS transaction (the sale, or the refund/chargeback record). */
  providerTransactionId: string;
  /** Refund / chargeback: the processor id of the ORIGINAL sale. Null on sale events. */
  relatedProviderTransactionId: string | null;
  /** Our `transactions.id`, echoed back by the processor (custom variable / pass-through field). Null if absent. */
  merchantReference: string | null;
  /** Sale: amount charged. Refund: amount refunded (null = "all that remains"). Chargeback: amount disputed (null = all that remains). */
  amountCents: number | null;
  currency: string;
  /** sale_failed: machine-readable decline reason (e.g. card_declined). */
  failureCode: string | null;
  /** When the processor says it happened (ISO string). Informational; ordering is NOT inferred from it. */
  occurredAt: string;
}

export type WebhookVerification =
  | { ok: true; event: NormalizedPaymentEvent }
  /** `signatureValid=false` => 401, nothing parsed is trusted. `signatureValid=true` + !ok => authentic but malformed (400). */
  | { ok: false; signatureValid: boolean; reason: string };

export interface CheckoutSessionInput {
  /** Our transactions.id. MUST round-trip through the processor and come back as `merchantReference`. */
  transactionId: string;
  amountCents: number;
  currency: string;
  description: string;
  buyerEmail: string;
  /** Absolute URL the buyer returns to after paying. */
  returnUrl: string;
}
export interface CheckoutSession {
  providerSessionId: string;
  /** Where to send the buyer's browser (hosted payment page). */
  redirectUrl: string;
}

export interface RefundInput {
  /** Processor id of the original sale (transactions.processor_ref). */
  providerTransactionId: string;
  transactionId: string;
  amountCents: number;
  currency: string;
  /** Stable per refund request so a retried call cannot refund twice at the processor. */
  idempotencyKey: string;
  reason?: string;
}
export interface RefundResult {
  providerRefundId: string;
  /** 'accepted' = the processor will confirm via a `refunded` webhook (the ledger moves only on that webhook). */
  status: "accepted" | "completed";
}

export interface PayoutInput {
  payoutId: string;
  sellerId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}
export interface PayoutResult {
  providerRef: string;
  /** Record-only for now: no provider moves money. */
  status: "recorded";
}

/** Optional server-side confirmation (neither Segpay nor CCBill signs webhooks: confirm with their API/reporting). */
export interface ConfirmedTransaction {
  approved: boolean;
  amountCents: number;
  currency: string;
}

export interface PaymentProvider {
  /** Registry key and the `[provider]` segment of /api/webhooks/[provider]. */
  readonly name: string;
  /** `{ok:false}` => the provider refuses to run (e.g. mock in production, missing credentials). */
  availability(): { ok: true } | { ok: false; reason: string };
  /** The processor's cut as a percent with at most 2 decimals, e.g. "12" or "7.5". platform_settings.processing_fee_percent overrides it. */
  processingFeePercent(): string;

  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;

  /**
   * Verify authenticity of the delivery over the RAW body, then parse it. MUST be constant-time on secrets, MUST NOT
   * throw on hostile input (return `{ok:false}`), and MUST NOT trust any parsed field before authenticity is established.
   * Processors without webhook signatures: verify your own HMAC carried in a pass-through field (+ optional IP allowlist).
   */
  verifyWebhook(input: { rawBody: string; headers: Headers }): WebhookVerification;

  /** Optional second factor: ask the processor whether it really approved this sale (called before a sale is applied). */
  confirmTransaction?(providerTransactionId: string): Promise<ConfirmedTransaction | null>;

  issueRefund(input: RefundInput): Promise<RefundResult>;
  recordPayout(input: PayoutInput): Promise<PayoutResult>;
}
