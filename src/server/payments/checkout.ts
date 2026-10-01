import type { PoolClient } from "pg";
import { pool, queryOne, withTx } from "../db";
import { HttpError } from "../errors";
import { config } from "../config";
import { getDropByPublicLink, type Drop } from "../services/drops";
import { getSettings } from "../services/settings";
import { activeProvider } from "./registry";
import { quoteSale } from "./pricing";
import { friendlyFailure, RETRYABLE_FAILURES } from "../../../lib/purchase-copy";

export interface CheckoutInput {
  /** Exactly one of dropId (uuid) / linkId (12-char public link id). */
  dropId?: string;
  linkId?: string;
  email: string;
  /** Buyer's self-declared 18+ confirmation. Required for every drop (there is no per-drop adult flag in the schema). */
  confirmOver18: boolean;
  /** `Idempotency-Key` request header (1-128 printable chars). Namespaced by buyer email. */
  idempotencyKey?: string | null;
}
export interface CheckoutResult {
  transactionId: string;
  provider: string;
  amountCents: number;
  currency: string;
  checkoutUrl: string;
  status: string;
  /** True when an existing checkout was returned (same Idempotency-Key, or an identical live pending checkout). */
  reused: boolean;
}

const DROP_COLS = "id, seller_id, public_link_id, title, description, price_cents, cover_url, status, created_at";
const KEY_RE = /^[\x21-\x7e]{1,128}$/;

async function loadDrop(input: CheckoutInput): Promise<Drop | null> {
  if (input.linkId) return getDropByPublicLink(input.linkId);
  if (input.dropId && /^[0-9a-f-]{36}$/i.test(input.dropId)) {
    return queryOne<Drop>(`SELECT ${DROP_COLS} FROM drops WHERE id = $1`, [input.dropId]);
  }
  return null;
}

/**
 * Pending checkouts older than platform_settings.checkout_session_ttl_minutes (default 30) become `failed`/`session_expired`.
 * Call with a transaction id (on access) or a client/pool-level filter, or with no filter as a sweep (cron/ops hook).
 * A late processor-confirmed success for such a transaction is still handled safely (see webhooks.ts invalidAtCapture).
 */
export async function expirePendingCheckouts(opts: { transactionId?: string; dropId?: string; email?: string } = {}, c?: Pick<PoolClient, "query">): Promise<number> {
  const ttl = (await getSettings()).checkout_session_ttl_minutes;
  const q = c ?? pool();
  const r = await q.query(
    `UPDATE transactions SET status = 'failed', failure_code = 'session_expired', updated_at = now()
      WHERE status = 'pending' AND created_at < now() - make_interval(mins => $1::int)
        AND ($2::uuid IS NULL OR id = $2) AND ($3::uuid IS NULL OR drop_id = $3) AND ($4::text IS NULL OR lower(buyer_email) = $4)`,
    [ttl, opts.transactionId ?? null, opts.dropId ?? null, opts.email ?? null],
  );
  return r.rowCount ?? 0;
}

interface ExistingRow { id: string; drop_id: string; status: string; amount_cents: number; currency: string; provider: string; checkout_url: string | null }
const EXISTING_COLS = "id, drop_id, status, amount_cents, currency, provider, checkout_url";
const asResult = (r: ExistingRow): CheckoutResult => ({
  transactionId: r.id, provider: r.provider, amountCents: r.amount_cents, currency: r.currency.trim(), checkoutUrl: r.checkout_url ?? "", status: r.status, reused: true,
});

/**
 * Creates a PENDING transaction priced from the database and a hosted-checkout session at the active provider.
 * The transaction only becomes `succeeded` when a verified webhook says so (payments/webhooks.ts) - never from the
 * browser redirect. The client never supplies an amount.
 *
 * Idempotency / double submit (race-safe): everything below runs in one DB transaction holding a transaction-scoped advisory
 * lock on (drop, buyer email), so concurrent identical requests serialise. Then:
 *   1. same Idempotency-Key (+ same buyer)  -> the stored transaction/session is returned (a different drop => 409);
 *   2. an identical LIVE pending checkout (same drop + email) exists -> that session is returned;
 *   3. otherwise a new transaction + session. The partial unique index transactions_one_pending_uniq is the DB backstop.
 */
export async function createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  if (input.confirmOver18 !== true) {
    throw new HttpError(400, "You must confirm you are 18 or older to buy", "age_confirmation_required");
  }
  const key = input.idempotencyKey?.trim() || null;
  if (key && !KEY_RE.test(key)) throw new HttpError(400, "Idempotency-Key must be 1-128 printable ASCII characters", "invalid_idempotency_key");
  const provider = activeProvider();
  const drop = await loadDrop(input);
  if (!drop || drop.status !== "published") throw new HttpError(404, "Drop not found", "drop_not_found");
  const seller = await queryOne<{ verification_status: string }>("SELECT verification_status FROM sellers WHERE id = $1", [drop.seller_id]);
  if (!seller || seller.verification_status !== "verified") {
    throw new HttpError(409, "This drop can't be purchased right now", "seller_not_verified");
  }
  const { split, rates } = await quoteSale(provider, drop.price_cents);
  const email = input.email.trim().toLowerCase();

  for (let attempt = 0; ; attempt++) {
    try {
      return await withTx(async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`checkout:${drop.id}:${email}`]);
        await expirePendingCheckouts({ dropId: drop.id, email }, c);
        if (key) {
          const k = await c.query<ExistingRow>(`SELECT ${EXISTING_COLS} FROM transactions WHERE lower(buyer_email) = $1 AND idempotency_key = $2`, [email, key]);
          if (k.rows[0]) {
            if (k.rows[0].drop_id !== drop.id) throw new HttpError(409, "Idempotency-Key was already used for a different purchase", "idempotency_key_reused");
            if (k.rows[0].status === "pending" || k.rows[0].status === "succeeded") return asResult(k.rows[0]);
            // The keyed checkout is dead (expired / superseded / failed): release the key so this request starts a fresh one.
            await c.query(`UPDATE transactions SET idempotency_key = NULL WHERE id = $1`, [k.rows[0].id]);
          }
        }
        const live = await c.query<ExistingRow>(
          `SELECT ${EXISTING_COLS} FROM transactions WHERE drop_id = $1 AND lower(buyer_email) = $2 AND status = 'pending' AND checkout_url IS NOT NULL`, [drop.id, email]);
        if (live.rows[0]) return asResult(live.rows[0]);

        const ins = await c.query<{ id: string }>(
          `INSERT INTO transactions
             (drop_id, seller_id, buyer_email, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents,
              status, provider, currency, fee_percent, processing_fee_percent, buyer_confirmed_18_at, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,'USD',$9,$10, now(), $11) RETURNING id`,
          [drop.id, drop.seller_id, email, split.grossCents, split.platformFeeCents, split.processingFeeCents, split.sellerNetCents,
            provider.name, rates.feePercent, rates.processingFeePercent, key],
        );
        const id = ins.rows[0].id;
        let session;
        try {
          session = await provider.createCheckoutSession({
            transactionId: id, amountCents: split.grossCents, currency: "USD", description: drop.title.slice(0, 120),
            buyerEmail: email, returnUrl: `${config.appUrl}/u/${drop.public_link_id}`,
          });
        } catch (e) {
          console.error("createCheckoutSession failed", e);
          throw new HttpError(502, "Could not start checkout", "checkout_unavailable"); // rolls the insert back too
        }
        await c.query(`UPDATE transactions SET provider_session_id = $2, checkout_url = $3, updated_at = now() WHERE id = $1`, [id, session.providerSessionId, session.redirectUrl]);
        return { transactionId: id, provider: provider.name, amountCents: split.grossCents, currency: "USD", checkoutUrl: session.redirectUrl, status: "pending", reused: false };
      });
    } catch (e) {
      // Backstop: if some other writer slipped past the lock and hit a unique index, re-run once and pick up its row.
      if ((e as { code?: string }).code === "23505" && attempt < 2) continue;
      throw e;
    }
  }
}

/** Buyer-facing status (the unguessable transaction uuid is the capability). Never exposes fees, seller or email. */
export async function getCheckoutStatus(transactionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(transactionId)) return null;
  await expirePendingCheckouts({ transactionId });
  const r = await queryOne<{ id: string; status: string; amount_cents: number; failure_code: string | null }>(
    `SELECT id, status, amount_cents, failure_code FROM transactions WHERE id = $1`, [transactionId]);
  if (!r) return null;
  const failed = r.status === "failed";
  return {
    ...r,
    retryable: failed && !!r.failure_code && RETRYABLE_FAILURES.has(r.failure_code),
    message: failed ? friendlyFailure(r.failure_code) : null,
  };
}
