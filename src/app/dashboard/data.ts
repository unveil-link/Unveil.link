import { query, queryOne } from "@/server/db";
import { earningsBreakdown, type EarningsBreakdown } from "@/lib/earnings";

/**
 * Read-only dashboard data.
 *
 * GAP (backend): there is no earnings / payouts / per-drop-stats API yet (see docs/frontend-dashboard-notes.md).
 * Until one exists the dashboard reads aggregates straight from the existing `transactions` and `payouts` tables
 * (schema is final in 001_init.sql; nothing writes to them yet, so everything is $0 today). When a real
 * `GET /api/earnings` lands, replace `getEarnings` / `getDropStats` with a fetch to it — the shapes below are what the UI consumes.
 */
export type Earnings = EarningsBreakdown & { salesCount: number; reversedCount: number };

/**
 * Same semantics as `lifetime` in the payments layer's GET /api/earnings (not on this branch's base yet):
 *  - grossCents = every sale (succeeded + refunded + charged back);
 *  - platform / processing fee totals are NET of the fee shares handed back on a refund or chargeback — a reversed
 *    sale (full reversal; there are no partial refunds on this base) therefore contributes 0 fees;
 *  - refundedCents / chargebackCents = gross handed back, kept apart;
 *  - net = gross − refunded − charged back − platform fee − processing fees (see lib/earnings.ts), i.e. refunds are
 *    taken off once, from gross, never again from the fees.
 * With only succeeded rows (seed data) this equals SUM(seller_net_cents).
 */
export async function getEarnings(sellerId: string): Promise<Earnings> {
  const t = await queryOne<{ gross: string; platform: string; processing: string; refunded: string; charged: string; n: number; rev: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0)::text AS gross,
            COALESCE(SUM(platform_fee_cents)   FILTER (WHERE status = 'succeeded'), 0)::text AS platform,
            COALESCE(SUM(processing_fee_cents) FILTER (WHERE status = 'succeeded'), 0)::text AS processing,
            COALESCE(SUM(amount_cents) FILTER (WHERE status = 'refunded'), 0)::text AS refunded,
            COALESCE(SUM(amount_cents) FILTER (WHERE status = 'charged_back'), 0)::text AS charged,
            COUNT(*) FILTER (WHERE status = 'succeeded')::int AS n,
            COUNT(*) FILTER (WHERE status <> 'succeeded')::int AS rev
       FROM transactions WHERE seller_id = $1`,
    [sellerId],
  );
  const p = await queryOne<{ paid: string; pending: string }>(
    `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::text AS paid,
            COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('pending','processing')), 0)::text AS pending
       FROM payouts WHERE seller_id = $1`,
    [sellerId],
  );
  const b = earningsBreakdown({
    grossCents: Number(t?.gross ?? 0),
    platformFeeCents: Number(t?.platform ?? 0),
    processingFeeCents: Number(t?.processing ?? 0),
    refundedCents: Number(t?.refunded ?? 0),
    chargebackCents: Number(t?.charged ?? 0),
    paidOutCents: Number(p?.paid ?? 0),
    pendingPayoutCents: Number(p?.pending ?? 0),
  });
  return { ...b, availableCents: Math.max(0, b.availableCents), salesCount: t?.n ?? 0, reversedCount: t?.rev ?? 0 };
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
