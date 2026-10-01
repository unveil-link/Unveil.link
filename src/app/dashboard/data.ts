import { query, queryOne } from "@/server/db";
import { getSettings } from "@/server/services/settings";

/**
 * Read-only dashboard data.
 *
 * GAP (backend): there is no earnings / payouts / per-drop-stats API yet (see docs/frontend-dashboard-notes.md).
 * Until one exists the dashboard reads aggregates straight from the existing `transactions` and `payouts` tables
 * (schema is final in 001_init.sql; nothing writes to them yet, so everything is $0 today). When a real
 * `GET /api/earnings` lands, replace `getEarnings` / `getDropStats` with a fetch to it — the shapes below are what the UI consumes.
 */
export type Earnings = {
  feePercent: number;
  sellerPercent: number;
  grossCents: number;
  /** Seller share: gross − platform fee − processing fees, succeeded transactions only. */
  netCents: number;
  refundedCents: number;
  paidOutCents: number;
  /** Payouts requested / processing (not yet paid). */
  pendingPayoutCents: number;
  /** Net not yet claimed by any payout. */
  availableCents: number;
  salesCount: number;
};

export async function getEarnings(sellerId: string): Promise<Earnings> {
  const s = await getSettings();
  const feePercent = Number(s.fee_percent);
  const t = await queryOne<{ gross: string; net: string; refunded: string; n: number }>(
    `SELECT COALESCE(SUM(amount_cents)    FILTER (WHERE status = 'succeeded'), 0)::text AS gross,
            COALESCE(SUM(seller_net_cents) FILTER (WHERE status = 'succeeded'), 0)::text AS net,
            COALESCE(SUM(amount_cents)    FILTER (WHERE status <> 'succeeded'), 0)::text AS refunded,
            COUNT(*) FILTER (WHERE status = 'succeeded')::int AS n
       FROM transactions WHERE seller_id = $1`,
    [sellerId],
  );
  const p = await queryOne<{ paid: string; pending: string }>(
    `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::text AS paid,
            COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('pending','processing')), 0)::text AS pending
       FROM payouts WHERE seller_id = $1`,
    [sellerId],
  );
  const netCents = Number(t?.net ?? 0);
  const paidOutCents = Number(p?.paid ?? 0);
  const pendingPayoutCents = Number(p?.pending ?? 0);
  return {
    feePercent,
    sellerPercent: Math.round((100 - feePercent) * 100) / 100,
    grossCents: Number(t?.gross ?? 0),
    netCents,
    refundedCents: Number(t?.refunded ?? 0),
    paidOutCents,
    pendingPayoutCents,
    availableCents: Math.max(0, netCents - paidOutCents - pendingPayoutCents),
    salesCount: t?.n ?? 0,
  };
}

export type DropStats = { units: number; revenueCents: number };

/** drop_id -> units sold + gross revenue. NOTE: "views" are not tracked anywhere in the backend. */
export async function getDropStats(sellerId: string): Promise<Record<string, DropStats>> {
  const rows = await query<{ drop_id: string; units: number; revenue: string }>(
    `SELECT drop_id, COUNT(*)::int AS units, COALESCE(SUM(amount_cents), 0)::text AS revenue
       FROM transactions WHERE seller_id = $1 AND status = 'succeeded' GROUP BY drop_id`,
    [sellerId],
  );
  return Object.fromEntries(rows.map((r) => [r.drop_id, { units: r.units, revenueCents: Number(r.revenue) }]));
}

/** drop_id -> first file that has a blurred preview (used for list thumbnails). */
export async function getDropThumbs(sellerId: string): Promise<Record<string, string>> {
  const rows = await query<{ drop_id: string; id: string }>(
    `SELECT DISTINCT ON (f.drop_id) f.drop_id, f.id
       FROM drop_files f JOIN drops d ON d.id = f.drop_id
      WHERE d.seller_id = $1 AND f.blurred_preview_key IS NOT NULL
      ORDER BY f.drop_id, f.sort_order, f.created_at`,
    [sellerId],
  );
  return Object.fromEntries(rows.map((r) => [r.drop_id, r.id]));
}
