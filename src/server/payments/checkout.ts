import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { pool, queryOne, withTx } from "../db";
import { HttpError } from "../errors";
import { isUuid } from "../input";
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
  /** Value of the httpOnly `unveil_buyer` cookie (opaque random token). Absent/invalid => this request is a new, unknown client. */
  buyerToken?: string | null;
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
/** `setBuyerToken` is non-null only when the caller must be given a NEW buyer cookie (never part of the JSON response). */
export type CheckoutOutcome = CheckoutResult & { setBuyerToken: string | null };

export const BUYER_COOKIE = "unveil_buyer";
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
export const hashBuyerToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

const DROP_COLS = "id, seller_id, public_link_id, title, description, price_cents, cover_url, status, created_at";
const KEY_RE = /^[\x21-\x7e]{1,128}$/;

async function loadDrop(input: CheckoutInput): Promise<Drop | null> {
  if (input.linkId) return getDropByPublicLink(input.linkId);
  if (input.dropId && isUuid(input.dropId)) {
    return queryOne<Drop>(`SELECT ${DROP_COLS} FROM drops WHERE id = $1`, [input.dropId]);
  }
  return null;
}

/**
 * Pending checkouts older than platform_settings.checkout_session_ttl_minutes (default 30) become `failed`/`session_expired`.
 * Call with a transaction id (on access) or a client/pool-level filter, or with no filter as a sweep (cron/ops hook).
 * A late processor-confirmed success for such a transaction is still handled safely (see webhooks.ts invalidAtCapture).
 */
export async function expirePendingCheckouts(opts: { transactionId?: string; dropId?: string; email?: string } = {}, c?: Pick<PoolClient, "query">, ttlMinutes?: number): Promise<number> {
  // NB: callers that already hold a pooled connection pass ttlMinutes - fetching settings here would need a SECOND connection
  // and can deadlock the pool when many requests wait on the advisory lock.
  const ttl = ttlMinutes ?? (await getSettings()).checkout_session_ttl_minutes;
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
/** The price changed since this pending checkout was created: it must not be handed out (the buyer would pay a stale price). */
const supersede = (c: Pick<PoolClient, "query">, id: string) =>
  c.query(`UPDATE transactions SET status = 'failed', failure_code = 'superseded', idempotency_key = NULL, updated_at = now() WHERE id = $1 AND status = 'pending'`, [id]);
const asResult = (r: ExistingRow): CheckoutResult => ({
  transactionId: r.id, provider: r.provider, amountCents: r.amount_cents, currency: r.currency.trim(), checkoutUrl: r.checkout_url ?? "", status: r.status, reused: true,
});

/**
 * Creates a PENDING transaction priced from the database and a hosted-checkout session at the active provider.
 * The transaction only becomes `succeeded` when a verified webhook says so (payments/webhooks.ts) - never from the
 * browser redirect. The client never supplies an amount.
 *
 * Idempotency / double submit (race-safe) AND privacy: a pending checkout is only ever handed back to the client that created it.
 * "Same client" = presents the same `Idempotency-Key`, or the same random httpOnly `unveil_buyer` cookie (only its SHA-256 is stored).
 * Everything below runs in one DB transaction holding a transaction-scoped advisory lock on (drop, buyer email), so concurrent
 * requests serialise. Then:
 *   1. same Idempotency-Key (+ same buyer email) -> the stored transaction/session is returned (a different drop => 409);
 *   2. a LIVE pending checkout of the SAME client (drop + email + cookie token) -> that session is returned;
 *   3. otherwise a NEW transaction + session (an unknown client - e.g. someone who only knows the victim's email - gets its own,
 *      independent session and never sees anybody else's checkoutUrl). `setBuyerToken` tells the route to issue the cookie.
 * In 1 and 2, if the drop's price changed since the pending transaction was created, that transaction is superseded
 * (failed/superseded) and a fresh one at the current price is created instead. The partial unique index
 * transactions_one_pending_per_client_uniq (drop, email, token) is the DB backstop.
 */
export async function createCheckout(input: CheckoutInput): Promise<CheckoutOutcome> {
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
  const ttlMinutes = (await getSettings()).checkout_session_ttl_minutes;
  const email = input.email.trim().toLowerCase();
  const presented = input.buyerToken && TOKEN_RE.test(input.buyerToken) ? input.buyerToken : null;
  const token = presented ?? crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashBuyerToken(token);
  const setBuyerToken = presented ? null : token;

  for (let attempt = 0; ; attempt++) {
    try {
      const out = await withTx(async (c): Promise<CheckoutResult> => {
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`checkout:${drop.id}:${email}`]);
        await expirePendingCheckouts({ dropId: drop.id, email }, c, ttlMinutes);
        if (key) {
          const k = await c.query<ExistingRow>(`SELECT ${EXISTING_COLS} FROM transactions WHERE lower(buyer_email) = $1 AND idempotency_key = $2`, [email, key]);
          if (k.rows[0]) {
            if (k.rows[0].drop_id !== drop.id) throw new HttpError(409, "Idempotency-Key was already used for a different purchase", "idempotency_key_reused");
            if (k.rows[0].status === "succeeded") return asResult(k.rows[0]);
            if (k.rows[0].status === "pending" && k.rows[0].amount_cents === split.grossCents) return asResult(k.rows[0]);
            // The keyed checkout is dead (expired / failed) or has a stale price: release the key so this request starts a fresh one.
            if (k.rows[0].status === "pending") await supersede(c, k.rows[0].id);
            await c.query(`UPDATE transactions SET idempotency_key = NULL WHERE id = $1`, [k.rows[0].id]);
          }
        }
        const live = await c.query<ExistingRow>(
          `SELECT ${EXISTING_COLS} FROM transactions
            WHERE drop_id = $1 AND lower(buyer_email) = $2 AND status = 'pending' AND checkout_url IS NOT NULL AND buyer_token_hash = $3`, [drop.id, email, tokenHash]);
        if (live.rows[0]) {
          if (live.rows[0].amount_cents === split.grossCents) return asResult(live.rows[0]);
          await supersede(c, live.rows[0].id); // price changed since: never hand out the stale-priced session
        }

        const ins = await c.query<{ id: string }>(
          `INSERT INTO transactions
             (drop_id, seller_id, buyer_email, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents,
              status, provider, currency, fee_percent, processing_fee_percent, buyer_confirmed_18_at, idempotency_key, buyer_token_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,'USD',$9,$10, now(), $11, $12) RETURNING id`,
          [drop.id, drop.seller_id, email, split.grossCents, split.platformFeeCents, split.processingFeeCents, split.sellerNetCents,
            provider.name, rates.feePercent, rates.processingFeePercent, key, tokenHash],
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
      // The cookie is only issued when a NEW transaction was created for a client without one (a reused row belongs to whoever
      // already holds its credential, so we never mint a second token for it).
      return { ...out, setBuyerToken: out.reused ? null : setBuyerToken };
    } catch (e) {
      // Backstop: if some other writer slipped past the lock and hit a unique index, re-run once and pick up its row.
      if ((e as { code?: string }).code === "23505" && attempt < 2) continue;
      throw e;
    }
  }
}

/** Buyer-facing status (the unguessable transaction uuid is the capability). Never exposes fees, seller or email. */
export async function getCheckoutStatus(transactionId: string) {
  if (!isUuid(transactionId)) return null;
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
