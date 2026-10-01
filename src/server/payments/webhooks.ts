import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { withTx, query } from "../db";
import { HttpError } from "../errors";
import { enforceIpLimit } from "../ratelimit";
import { getSettings } from "../services/settings";
import { OverRefundError } from "./money";
import { postReversal, postSale, TX_COLS, type TxRow } from "./ledger";
import { voidCharge } from "./refunds";
import { findProvider } from "./registry";
import { writeAudit } from "../admin/audit";
import type { NormalizedPaymentEvent } from "./types";

/**
 * Generic, provider-independent webhook pipeline. Order of operations for a delivery:
 *   1. provider lookup + availability, body size cap
 *   2. provider.verifyWebhook(rawBody, headers)  -> bad signature: 401 + a `rejected` log row, NOTHING else changes
 *   3. (optional) provider.confirmTransaction() server-side confirmation for sales
 *   4. ONE database transaction:
 *        a. claim the event: INSERT webhook_events(dedupe_claim=true) ON CONFLICT DO NOTHING. The partial unique indexes on
 *           (provider, provider_event_id) and (provider, provider_transaction_id, event_type) make concurrent deliveries
 *           serialise here; the loser sees no row back, logs a `duplicate` row and returns 200 without touching state.
 *        b. lock the transaction row (FOR UPDATE), apply the event (status change + ledger postings), set the log outcome.
 *      Any exception rolls back the claim as well, so the processor's retry is processed normally.
 *   The claim (dedupe_claim=true) is KEPT only for outcomes `processed` and `parked`. A `rejected` / `ignored` outcome releases
 *   it (setOutcome), so e.g. an amount_mismatch or unknown_transaction event can never make a later, correct event for the
 *   same processor transaction look like a duplicate. Genuine duplicates (same event id, or same processor txn id + type of an
 *   already processed event) still collapse into exactly one posting.
 * Outcomes: processed | duplicate | rejected | ignored | parked | error  (see webhook_events.outcome).
 */
export type WebhookOutcome = "processed" | "duplicate" | "rejected" | "ignored" | "parked" | "error";
export interface WebhookResult {
  status: number;
  body: { received?: boolean; outcome?: WebhookOutcome; detail?: string; error?: string; code?: string };
}

const MAX_BODY_BYTES = 256 * 1024;
const MAX_STORED_PAYLOAD = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

interface Applied { outcome: WebhookOutcome; detail?: string; transactionId?: string | null; voidRefundFor?: string }
interface ApplyCtx {
  holdDays: number; chargebackFeeCents: number;
  sessionTtlMinutes: number; lateGraceMinutes: number; cbThreshold: number; cbWindowDays: number;
}
const ctxFrom = (s: Awaited<ReturnType<typeof getSettings>>): ApplyCtx => ({
  holdDays: s.payout_hold_days, chargebackFeeCents: s.chargeback_fee_cents,
  sessionTtlMinutes: s.checkout_session_ttl_minutes, lateGraceMinutes: s.checkout_late_success_grace_minutes,
  cbThreshold: s.chargeback_flag_threshold, cbWindowDays: s.chargeback_flag_window_days,
});

/** Postgres text/jsonb reject U+0000 (and we don't want lone surrogates): scrub anything from outside before it is stored. */
export const clean = (s: string | null | undefined): string | null => (s == null ? null : s.replace(/\u0000/g, "\uFFFD").toWellFormed());
const hasBadChars = (s: string) => s.includes("\u0000") || !s.isWellFormed();
function badEventStrings(e: NormalizedPaymentEvent): string | null {
  for (const [k, v] of Object.entries(e)) {
    if (typeof v === "string" && (hasBadChars(v) || v.length > 512)) return `invalid_${k}`;
  }
  return null;
}
async function logRejected(provider: string, signatureValid: boolean, detail: string, hash: string, rawBody: string) {
  try {
    await query(
      `INSERT INTO webhook_events (provider, signature_valid, outcome, outcome_detail, payload_sha256, payload)
       VALUES ($1, $2, 'rejected', $3, $4, $5)`,
      [provider, signatureValid, clean(detail), hash, clean(rawBody.slice(0, 1024))],
    );
  } catch (e) {
    console.error("could not write rejected webhook row", (e as Error).message);
  }
}

export async function handleWebhook(opts: { providerName: string; rawBody: string; headers: Headers; req?: Request }): Promise<WebhookResult> {
  const provider = findProvider(opts.providerName);
  if (!provider) return { status: 404, body: { error: "Unknown provider", code: "unknown_provider" } };
  const avail = provider.availability();
  if (!avail.ok) {
    console.error(`webhook for unavailable provider "${provider.name}": ${avail.reason}`);
    return { status: 503, body: { error: "Provider unavailable", code: "payments_unavailable" } };
  }
  const { rawBody } = opts;
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return { status: 413, body: { error: "Payload too large", code: "payload_too_large" } };
  }
  const payloadHash = sha256(rawBody);

  const v = provider.verifyWebhook({ rawBody, headers: opts.headers });
  if (!v.ok) {
    // Unauthenticated traffic must not be able to flood the reconciliation log: cap logged rejections per IP.
    if (opts.req) await enforceIpLimit("WEBHOOK_REJECTED", opts.req);
    await logRejected(provider.name, v.signatureValid, v.reason, payloadHash, rawBody);
    return v.signatureValid
      ? { status: 400, body: { error: "Invalid payload", code: "invalid_payload" } }
      : { status: 401, body: { error: "Invalid signature", code: "invalid_signature" } };
  }
  const event = v.event;
  const badField = badEventStrings(event);
  if (badField) {
    // Authentic but unstorable/hostile strings (NUL, lone surrogates, absurd length): 4xx, never a 500 retry storm.
    if (opts.req) await enforceIpLimit("WEBHOOK_REJECTED", opts.req);
    await logRejected(provider.name, true, badField, payloadHash, rawBody);
    return { status: 400, body: { error: "Invalid payload", code: "invalid_payload" } };
  }

  // Server-side confirmation (processors without signed webhooks). Network I/O stays outside the DB transaction.
  let confirmFailure: string | null = null;
  if (event.type === "sale_succeeded" && provider.confirmTransaction) {
    const conf = await provider.confirmTransaction(event.providerTransactionId); // throws => 500 => processor retries
    if (!conf || !conf.approved) confirmFailure = "confirmation_not_approved";
    else if (event.amountCents != null && conf.amountCents !== event.amountCents) confirmFailure = "confirmation_amount_mismatch";
  }

  const settings = await getSettings();
  const ctx = ctxFrom(settings);

  try {
    const result = await withTx(async (c) => {
      const claim = await c.query<{ id: string }>(
        `INSERT INTO webhook_events
           (provider, provider_event_id, event_type, raw_event_type, signature_valid, outcome, dedupe_claim,
            merchant_reference, provider_transaction_id, related_transaction_id, amount_cents, normalized, payload_sha256, payload)
         VALUES ($1,$2,$3,$4,true,'error',true,$5,$6,$7,$8,$9::jsonb,$10,$11)
         ON CONFLICT DO NOTHING RETURNING id`,
        [
          event.provider, event.eventId, event.type, event.rawType, event.merchantReference, event.providerTransactionId,
          event.relatedProviderTransactionId, event.amountCents, JSON.stringify(event), payloadHash, clean(rawBody.slice(0, MAX_STORED_PAYLOAD)),
        ],
      );
      if (claim.rowCount === 0) {
        const prior = await c.query<{ id: string; transaction_id: string | null }>(
          `SELECT id, transaction_id FROM webhook_events
            WHERE dedupe_claim AND provider = $1 AND (provider_event_id = $2 OR (provider_transaction_id = $3 AND event_type = $4)) LIMIT 1`,
          [event.provider, event.eventId, event.providerTransactionId, event.type],
        );
        await c.query(
          `INSERT INTO webhook_events (provider, provider_event_id, event_type, raw_event_type, signature_valid, outcome, outcome_detail,
             transaction_id, merchant_reference, provider_transaction_id, related_transaction_id, amount_cents, payload_sha256, processed_at)
           VALUES ($1,$2,$3,$4,true,'duplicate',$5,$6,$7,$8,$9,$10,$11, now())`,
          [
            event.provider, event.eventId, event.type, event.rawType, prior.rows[0] ? `duplicate of ${prior.rows[0].id}` : "duplicate",
            prior.rows[0]?.transaction_id ?? null, event.merchantReference, event.providerTransactionId,
            event.relatedProviderTransactionId, event.amountCents, payloadHash,
          ],
        );
        return { outcome: "duplicate" as const, detail: undefined };
      }
      const rowId = claim.rows[0].id;
      const applied = confirmFailure
        ? ({ outcome: "rejected", detail: confirmFailure } satisfies Applied)
        : await applyEvent(c, rowId, event, ctx);
      await setOutcome(c, rowId, applied);
      return { outcome: applied.outcome, detail: applied.detail, voidRefundFor: applied.voidRefundFor };
    });
    if (result.voidRefundFor) {
      // After commit (network I/O never runs inside the DB transaction). A failure here is logged and picked up by
      // retryVoidRefunds(); it must not make the processor re-deliver (the event is already recorded as processed).
      await voidCharge(result.voidRefundFor).catch((e) => console.error("void refund request failed", (e as Error).message));
    }
    return { status: 200, body: { received: true, outcome: result.outcome, detail: result.detail } };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error("webhook processing failed", e);
    // The claim was rolled back with the transaction; record the failure for ops and let the processor retry.
    await query(
      `INSERT INTO webhook_events (provider, provider_event_id, event_type, raw_event_type, signature_valid, outcome, outcome_detail,
         merchant_reference, provider_transaction_id, payload_sha256)
       VALUES ($1,$2,$3,$4,true,'error',$5,$6,$7,$8)`,
      [event.provider, clean(event.eventId), event.type, event.rawType, clean((e as Error).message.slice(0, 300)), clean(event.merchantReference), clean(event.providerTransactionId), payloadHash],
    ).catch(() => {});
    return { status: 500, body: { error: "Internal error", code: "webhook_error" } };
  }
}

async function setOutcome(c: PoolClient, rowId: string, a: Applied) {
  // Only processed / parked events hold the dedupe claim (see header comment).
  const keepClaim = a.outcome === "processed" || a.outcome === "parked";
  await c.query(
    `UPDATE webhook_events SET outcome = $2, outcome_detail = $3, transaction_id = $4, processed_at = now(), dedupe_claim = $5 WHERE id = $1`,
    [rowId, a.outcome, a.detail ?? null, a.transactionId ?? null, keepClaim],
  );
}

async function findTransaction(c: PoolClient, e: NormalizedPaymentEvent): Promise<TxRow | null> {
  if (e.merchantReference) {
    if (!UUID.test(e.merchantReference)) return null;
    return (await c.query<TxRow>(`SELECT ${TX_COLS} FROM transactions WHERE id = $1 AND provider = $2 FOR UPDATE`, [e.merchantReference, e.provider])).rows[0] ?? null;
  }
  const ref = e.type === "sale_succeeded" || e.type === "sale_failed" ? e.providerTransactionId : e.relatedProviderTransactionId;
  if (!ref) return null;
  return (await c.query<TxRow>(`SELECT ${TX_COLS} FROM transactions WHERE provider = $1 AND processor_ref = $2 FOR UPDATE`, [e.provider, ref])).rows[0] ?? null;
}

/** Applies a verified, newly-claimed event inside the caller's transaction. Never throws for business conditions. */
async function applyEvent(c: PoolClient, rowId: string, e: NormalizedPaymentEvent, ctx: ApplyCtx): Promise<Applied> {
  const tx = await findTransaction(c, e);

  if (e.type === "sale_succeeded" || e.type === "sale_failed") {
    if (!tx) return { outcome: "ignored", detail: "unknown_transaction" };
    const tid = tx.id;
    if (e.type === "sale_failed") {
      if (tx.review_reason || tx.refund_requested_at) return { outcome: "ignored", detail: "voided", transactionId: tid };
      if (tx.status === "pending" || tx.status === "failed") {
        // A card can be retried on the same checkout, so a later failure just refreshes the reason.
        await c.query(`UPDATE transactions SET status='failed', failure_code=$2, updated_at=now() WHERE id=$1`, [tid, e.failureCode ?? "declined"]);
        return { outcome: "processed", transactionId: tid };
      }
      return { outcome: "ignored", detail: `sale_failed_but_${tx.status}`, transactionId: tid };
    }
    // sale_succeeded
    if (e.amountCents == null || e.amountCents !== tx.amount_cents || e.currency !== tx.currency.trim()) {
      return { outcome: "rejected", detail: "amount_mismatch", transactionId: tid };
    }
    if (tx.status !== "pending" && tx.status !== "failed") {
      return { outcome: "ignored", detail: `sale_succeeded_but_${tx.status}`, transactionId: tid };
    }
    if (tx.review_reason || tx.refund_requested_at) return { outcome: "ignored", detail: "voided", transactionId: tid };
    // The processor says money was taken. Is the purchase still valid? (seller verified, drop published and not flagged,
    // session not older than TTL + late-success grace.) If not we do NOT credit the seller: the charge is voided
    // (auto-refund via the provider interface after commit) and the transaction is marked for review.
    const invalid = await invalidAtCapture(c, tid, ctx);
    if (invalid) {
      await c.query(
        `UPDATE transactions SET status='failed', failure_code='invalid_at_capture', review_reason=$2, processor_ref=$3, updated_at=now() WHERE id=$1`,
        [tid, invalid, e.providerTransactionId],
      );
      return { outcome: "processed", detail: `voided:${invalid}`, transactionId: tid, voidRefundFor: tid };
    }
    await c.query(
      `UPDATE transactions SET status='succeeded', failure_code=NULL, processor_ref=$2, succeeded_at=now(), updated_at=now() WHERE id=$1`,
      [tid, e.providerTransactionId],
    );
    await postSale(c, tx, rowId, ctx.holdDays);
    await applyParked(c, { ...tx, status: "succeeded", processor_ref: e.providerTransactionId }, ctx);
    return { outcome: "processed", transactionId: tid };
  }

  // refunded / chargeback
  if (!tx) {
    // Authentic, but we can't tie it to a sale yet. With only a processor-side sale id (no reference) the sale may simply
    // not have arrived: park. If a reference was given and matches nothing, or nothing identifies a sale: unknown.
    if (!e.merchantReference && e.relatedProviderTransactionId) return { outcome: "parked", detail: "sale_not_seen_yet" };
    return { outcome: "ignored", detail: "unknown_transaction" };
  }
  return applyReversalEvent(c, rowId, e, tx, ctx);
}

async function applyReversalEvent(c: PoolClient, rowId: string, e: NormalizedPaymentEvent, tx: TxRow, ctx: ApplyCtx): Promise<Applied> {
  const tid = tx.id;
  if (tx.status === "pending") return { outcome: "parked", detail: "sale_not_seen_yet", transactionId: tid };
  if (tx.status === "failed" && tx.review_reason) return { outcome: "processed", detail: "void_refund_confirmed", transactionId: tid };
  if (tx.status === "failed") return { outcome: "ignored", detail: "reversal_of_failed_sale", transactionId: tid };
  if (tx.processor_ref && e.relatedProviderTransactionId && tx.processor_ref !== e.relatedProviderTransactionId) {
    return { outcome: "rejected", detail: "related_transaction_mismatch", transactionId: tid };
  }
  const remaining = tx.amount_cents - tx.reversed_cents;
  const amount = e.amountCents ?? remaining;
  if (amount <= 0) return { outcome: "rejected", detail: "over_refund", transactionId: tid };
  const kind = e.type === "chargeback" ? "chargeback" : "refund";
  try {
    await postReversal(c, tx, { kind, amountCents: amount, chargebackFeeCents: kind === "chargeback" ? ctx.chargebackFeeCents : 0 }, rowId);
  } catch (err) {
    if (err instanceof OverRefundError) return { outcome: "rejected", detail: "over_refund", transactionId: tid };
    throw err;
  }
  const reversed = tx.reversed_cents + amount;
  const status = kind === "chargeback" || tx.status === "charged_back" ? "charged_back" : reversed >= tx.amount_cents ? "refunded" : "succeeded";
  await c.query(`UPDATE transactions SET reversed_cents=$2, status=$3, updated_at=now() WHERE id=$1`, [tid, reversed, status]);
  if (kind === "chargeback") {
    const flagged = await flagSellerIfRepeatChargebacks(c, tx.seller_id, ctx);
    if (flagged) return { outcome: "processed", detail: "seller_flagged_for_review", transactionId: tid };
  }
  return { outcome: "processed", transactionId: tid };
}

/** Why a confirmed charge can no longer be honoured, or null when it is fine. Runs inside the webhook transaction. */
async function invalidAtCapture(c: PoolClient, txId: string, ctx: ApplyCtx): Promise<string | null> {
  const r = await c.query<{ drop_status: string; verification_status: string; age_min: number }>(
    `SELECT d.status::text AS drop_status, s.verification_status::text AS verification_status,
            EXTRACT(EPOCH FROM (now() - t.created_at)) / 60 AS age_min
       FROM transactions t JOIN drops d ON d.id = t.drop_id JOIN sellers s ON s.id = t.seller_id WHERE t.id = $1`, [txId]);
  const row = r.rows[0];
  if (!row) return "transaction_missing";
  if (row.verification_status !== "verified") return "seller_not_verified";
  if (row.drop_status !== "published") return "drop_unavailable";
  if (Number(row.age_min) > ctx.sessionTtlMinutes + ctx.lateGraceMinutes) return "session_expired";
  return null;
}

/**
 * Spec M5-08: repeated chargebacks on a seller's drops flag the ACCOUNT FOR REVIEW (no auto-ban: nothing else changes).
 * Counts distinct charged-back transactions of the seller within the window; flags once (risk_flagged_at IS NULL guard),
 * writes an audit_log row. The seller row is locked (FOR NO KEY UPDATE) first so concurrent chargebacks can't each miss the threshold.
 */
async function flagSellerIfRepeatChargebacks(c: PoolClient, sellerId: string, ctx: ApplyCtx): Promise<boolean> {
  // FOR NO KEY UPDATE (not FOR UPDATE): this transaction already holds a KEY SHARE lock on the seller through the ledger_entries FK,
  // and two concurrent chargebacks taking FOR UPDATE would deadlock on each other.
  await c.query(`SELECT 1 FROM sellers WHERE id = $1 FOR NO KEY UPDATE`, [sellerId]);
  const n = await c.query<{ n: number }>(
    `SELECT count(DISTINCT transaction_id)::int AS n FROM ledger_entries
      WHERE seller_id = $1 AND entry_type = 'chargeback_reversal' AND component = 'gross'
        AND created_at > now() - make_interval(days => $2::int)
        AND created_at > COALESCE((SELECT risk_reviewed_at FROM sellers WHERE id = $1), '-infinity'::timestamptz)`, // an admin review restarts the count
    [sellerId, ctx.cbWindowDays],
  );
  if (n.rows[0].n < ctx.cbThreshold) return false;
  const reason = `${n.rows[0].n} chargebacks within ${ctx.cbWindowDays} days (threshold ${ctx.cbThreshold})`;
  const up = await c.query(
    `UPDATE sellers SET risk_flagged_at = now(), risk_flag_reason = $2 WHERE id = $1 AND risk_flagged_at IS NULL`, [sellerId, reason]);
  if (!up.rowCount) return false;
  await writeAudit(c, { action: "seller_flagged_repeat_chargebacks", target: `seller:${sellerId} ${reason}` });
  return true;
}

/** After a sale lands, apply refunds/chargebacks that arrived first (oldest first), inside the same transaction. */
async function applyParked(c: PoolClient, sale: TxRow, ctx: ApplyCtx) {
  const parked = await c.query<{ id: string; normalized: NormalizedPaymentEvent }>(
    `SELECT id, normalized FROM webhook_events
      WHERE provider = $1 AND outcome = 'parked' AND dedupe_claim AND (merchant_reference = $2 OR related_transaction_id = $3)
      ORDER BY received_at, id FOR UPDATE`,
    [sale.provider, sale.id, sale.processor_ref],
  );
  let cur = sale;
  for (const p of parked.rows) {
    const a = await applyReversalEvent(c, p.id, p.normalized, cur, ctx);
    await setOutcome(c, p.id, a.outcome === "processed" ? { ...a, detail: "applied_after_sale" } : a);
    if (a.outcome === "processed") {
      const r = await c.query<TxRow>(`SELECT ${TX_COLS} FROM transactions WHERE id = $1`, [sale.id]);
      cur = r.rows[0];
    }
  }
}

/**
 * Ops/retry hook: re-attempt every parked event whose sale has since succeeded (normally unnecessary: the sale event
 * applies them itself). Returns how many were applied.
 */
export async function retryParkedEvents(): Promise<number> {
  const settings = await getSettings();
  const ctx = ctxFrom(settings);
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT t.id FROM webhook_events w
       JOIN transactions t ON t.provider = w.provider AND (t.id::text = w.merchant_reference OR t.processor_ref = w.related_transaction_id)
      WHERE w.outcome = 'parked' AND t.status IN ('succeeded','refunded','charged_back')`,
  );
  let n = 0;
  for (const r of rows) {
    n += await withTx(async (c) => {
      const t = await c.query<TxRow>(`SELECT ${TX_COLS} FROM transactions WHERE id = $1 FOR UPDATE`, [r.id]);
      const before = await c.query(`SELECT count(*)::int AS n FROM webhook_events WHERE outcome='parked' AND (merchant_reference=$1 OR related_transaction_id=$2)`, [r.id, t.rows[0].processor_ref]);
      await applyParked(c, t.rows[0], ctx);
      const after = await c.query(`SELECT count(*)::int AS n FROM webhook_events WHERE outcome='parked' AND (merchant_reference=$1 OR related_transaction_id=$2)`, [r.id, t.rows[0].processor_ref]);
      return before.rows[0].n - after.rows[0].n;
    });
  }
  return n;
}
