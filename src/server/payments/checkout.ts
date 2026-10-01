import { query, queryOne } from "../db";
import { HttpError } from "../errors";
import { config } from "../config";
import { getDropByPublicLink, type Drop } from "../services/drops";
import { getSellerById } from "../services/sellers";
import { activeProvider } from "./registry";
import { quoteSale } from "./pricing";

export interface CheckoutInput {
  /** Exactly one of dropId (uuid) / linkId (12-char public link id). */
  dropId?: string;
  linkId?: string;
  email: string;
  /** Buyer's self-declared 18+ confirmation. Required for every drop (there is no per-drop adult flag in the schema). */
  confirmOver18: boolean;
}
export interface CheckoutResult {
  transactionId: string;
  provider: string;
  amountCents: number;
  currency: string;
  checkoutUrl: string;
}

const DROP_COLS = "id, seller_id, public_link_id, title, description, price_cents, cover_url, status, created_at";

async function loadDrop(input: CheckoutInput): Promise<Drop | null> {
  if (input.linkId) return getDropByPublicLink(input.linkId);
  if (input.dropId && /^[0-9a-f-]{36}$/i.test(input.dropId)) {
    return queryOne<Drop>(`SELECT ${DROP_COLS} FROM drops WHERE id = $1`, [input.dropId]);
  }
  return null;
}

/**
 * Creates a PENDING transaction priced from the database and a hosted-checkout session at the active provider.
 * The transaction only becomes `succeeded` when a verified webhook says so (payments/webhooks.ts) - never from the
 * browser redirect. The client never supplies an amount.
 */
export async function createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  if (input.confirmOver18 !== true) {
    throw new HttpError(400, "You must confirm you are 18 or older to buy", "age_confirmation_required");
  }
  const provider = activeProvider();
  const drop = await loadDrop(input);
  if (!drop || drop.status !== "published") throw new HttpError(404, "Drop not found", "drop_not_found");
  const seller = await getSellerById(drop.seller_id);
  if (!seller || seller.verification_status !== "verified") {
    // Same message as an unpublished drop would be misleading; the buyer can't act on it either way.
    throw new HttpError(409, "This drop can't be purchased right now", "seller_not_verified");
  }
  const { split, rates } = await quoteSale(provider, drop.price_cents);
  const email = input.email.trim().toLowerCase();

  const [tx] = await query<{ id: string }>(
    `INSERT INTO transactions
       (drop_id, seller_id, buyer_email, amount_cents, platform_fee_cents, processing_fee_cents, seller_net_cents,
        status, provider, currency, fee_percent, processing_fee_percent, buyer_confirmed_18_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,'USD',$9,$10, now()) RETURNING id`,
    [
      drop.id, drop.seller_id, email, split.grossCents, split.platformFeeCents, split.processingFeeCents, split.sellerNetCents,
      provider.name, rates.feePercent, rates.processingFeePercent,
    ],
  );
  try {
    const session = await provider.createCheckoutSession({
      transactionId: tx.id,
      amountCents: split.grossCents,
      currency: "USD",
      description: drop.title.slice(0, 120),
      buyerEmail: email,
      returnUrl: `${config.appUrl}/u/${drop.public_link_id}`,
    });
    await query(`UPDATE transactions SET provider_session_id = $2, updated_at = now() WHERE id = $1`, [tx.id, session.providerSessionId]);
    return { transactionId: tx.id, provider: provider.name, amountCents: split.grossCents, currency: "USD", checkoutUrl: session.redirectUrl };
  } catch (e) {
    console.error("createCheckoutSession failed", e);
    await query(`UPDATE transactions SET status = 'failed', failure_code = 'session_error', updated_at = now() WHERE id = $1`, [tx.id]);
    throw new HttpError(502, "Could not start checkout", "checkout_unavailable");
  }
}

/** Buyer-facing status (the unguessable transaction uuid is the capability). Never exposes fees, seller or email. */
export async function getCheckoutStatus(transactionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(transactionId)) return null;
  return queryOne<{ id: string; status: string; amount_cents: number; failure_code: string | null }>(
    `SELECT id, status, amount_cents, failure_code FROM transactions WHERE id = $1`, [transactionId]);
}
