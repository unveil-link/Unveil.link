import { query } from "@/server/db";
import { toEarningsView, type EarningsView } from "@/lib/earnings";
import { getEarningsSummary } from "@/server/payments/earnings";

/**
 * Read-only dashboard data. Earnings: payments layer (below). Per-drop units/revenue: there is still no per-drop stats API,
 * so these two small display queries read `transactions` directly (succeeded sales only; revenue = gross charged, before fees/refunds).
 */
/**
 * Earnings come from the payments layer — the same `getEarningsSummary()` that backs `GET /api/earnings` (ledger balance with the
 * payout hold, lifetime ledger sums, payouts). We call the service function directly instead of fetching our own HTTP endpoint:
 * this is a server component that already resolved the signed-in seller from the session, so the seller id is never client-supplied
 * (seller isolation) and there is no extra round trip / cookie forwarding. No money rules are re-implemented here or in
 * lib/earnings.ts (display mapping only; field mapping is documented there and in docs/frontend-dashboard-notes.md).
 */
export async function getEarnings(sellerId: string): Promise<EarningsView> {
  return toEarningsView(await getEarningsSummary(sellerId));
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
