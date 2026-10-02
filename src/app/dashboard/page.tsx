import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionSellerId } from "@/server/auth/session";
import { getSellerById } from "@/server/services/sellers";
import { listDropsForSeller } from "@/server/services/drops";
import { Alert, Badge, ButtonLink, Card, CardDescription, CardTitle, CardIcon, ChartIcon, ClockIcon, CoinIcon, PlusIcon, StatCard, WalletIcon } from "@/components/ui";
import { DropList } from "@/components/dashboard/DropList";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { VERIFICATION_META, type DropRow } from "@/components/dashboard/types";
import { breakdownLine, reversalsLabel } from "@/lib/earnings";
import { usd } from "@/lib/format";
import { getDropStats, getDropThumbs, getEarnings } from "./data";

export const metadata = { title: "Overview" };

export default async function DashboardOverview() {
  const id = await getSessionSellerId();
  const seller = id ? await getSellerById(id) : null;
  if (!seller) redirect("/login");
  const [drops, earnings, stats, thumbs] = await Promise.all([
    listDropsForSeller(seller.id),
    getEarnings(seller.id),
    getDropStats(seller.id),
    getDropThumbs(seller.id),
  ]);
  const rows: DropRow[] = drops.map((d) => ({
    id: d.id, title: d.title, priceCents: d.price_cents, status: d.status, publicLinkId: d.public_link_id,
    fileCount: d.file_count, createdAt: d.created_at, units: stats[d.id]?.units ?? 0, revenueCents: stats[d.id]?.revenueCents ?? 0,
    thumbFileId: thumbs[d.id] ?? null,
  }));
  const v = VERIFICATION_META[seller.verification_status];
  const first = seller.display_name.split(" ")[0];
  const e = earnings;
  const reversals = reversalsLabel(e);
  const published = rows.filter((r) => r.status === "published").length;

  return (
    <>
      <PageHeader
        title={`Hi, ${first}`}
        description="Here’s how your drops are doing."
        actions={<ButtonLink href="/dashboard/drops/new"><PlusIcon className="size-4" /> New drop</ButtonLink>}
      />

      {seller.verification_status !== "verified" && (
        <Alert
          tone={seller.verification_status === "failed" ? "danger" : "warning"}
          title={`Verification: ${v.label}`}
          className="mb-6"
          data-testid="verification"
        >
          <span data-testid="verification-status" className="sr-only">{v.label}</span>
          {v.hint}
        </Alert>
      )}
      {seller.verification_status === "verified" && (
        <p className="sr-only" data-testid="verification"><span data-testid="verification-status">{v.label}</span></p>
      )}

      <section aria-labelledby="earn-h" className="mb-10">
        <h2 id="earn-h" className="sr-only">Earnings</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" data-testid="earnings-breakdown">
          <StatCard label="Gross sales" value={usd(e.grossCents)} icon={<ChartIcon />} tone="primary"
            hint={`${e.salesCount} sale${e.salesCount === 1 ? "" : "s"} charged, before refunds`} />
          <StatCard label="Platform fee" value={usd(e.platformFeeCents)} icon={<CoinIcon />}
            hint={e.platformFeePct === null ? "Charged on each sale" : `${e.platformFeePct}% of completed sales`} />
          <StatCard label="Processing fees" value={usd(e.processingFeeCents)} icon={<CardIcon />}
            hint={e.processingFeePct === null ? "Paid to the card processor" : `${e.processingFeePct}% of completed sales · card processor`} />
          <StatCard label="Your earnings (net)" value={usd(e.netCents)} icon={<CoinIcon />} tone="accent"
            hint={e.keepPct === null ? "After fees" : `${e.keepPct}% of completed sales, after fees`} />
        </div>
        <p className="mt-3 text-sm text-muted" data-testid="net-breakdown">
          {breakdownLine(e)}
        </p>
        {reversals && (
          <p className="mt-1 text-sm text-muted" data-testid="reversals">
            Reversed sales: {reversals}. Fees on reversed sales are returned, so they are not counted above. Per-drop Sold and Revenue are net of these reversals ({usd(e.grossCents - e.refundedCents - e.chargebackCents)} kept).
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" data-testid="balance-cards">
          <StatCard
            label={e.availableCents < 0 ? "Balance owed" : "Available"}
            value={usd(e.availableCents)}
            icon={<WalletIcon />}
            tone={e.availableCents < 0 ? "danger" : "default"}
            hint={
              e.availableCents < 0
                ? "Below zero. It will be deducted from future earnings."
                : e.availableCents === 0
                  ? "Nothing to pay out yet"
                  : e.payoutEligible
                    ? `You’ve reached the ${usd(e.minPayoutCents)} minimum. Payout requests are coming soon`
                    : `Payouts start at ${usd(e.minPayoutCents)}`
            }
          />
          <StatCard label="Pending" value={usd(e.pendingCents)} icon={<ClockIcon />}
            hint={e.holdDays > 0 ? `Becomes available ${e.holdDays} day${e.holdDays === 1 ? "" : "s"} after each sale` : "Becomes available right away"} />
          <StatCard label="In payout" value={usd(e.inPayoutCents)} icon={<WalletIcon />}
            hint={e.inPayoutCents ? "Requested or approved, not yet paid" : "None in progress"} />
          <StatCard label="Paid out" value={usd(e.paidOutCents)} icon={<WalletIcon />}
            hint={e.paidOutCents ? "Payouts marked as paid" : "No payouts yet"} />
        </div>
        {e.availableCents < 0 && (
          <Alert tone="danger" role="status" title={`You owe ${usd(-e.availableCents)}`} className="mt-4" data-testid="negative-balance">
            Your available balance is below zero because a refund, chargeback or chargeback fee was larger than the money available to you. It will be deducted from your future earnings before your next payout.
          </Alert>
        )}
        <p className="mt-3 text-xs text-muted">
          Net earnings = gross sales − platform fee − card-processing fees − refunds, chargebacks and chargeback fees. Available + pending + in payout + paid out add up to your net earnings.
        </p>
      </section>

      <section aria-labelledby="drops-h">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="drops-h" className="text-lg font-semibold tracking-tight">Your drops</h2>
            <p className="text-sm text-muted">{rows.length ? `${rows.length} total · ${published} live` : "Nothing here yet"}</p>
          </div>
          {rows.length > 0 && <Link href="/dashboard/drops" className="text-sm font-semibold text-primary">View all</Link>}
        </div>
        <DropList drops={rows.slice(0, 5)} verification={seller.verification_status} />
      </section>

      {rows.length === 0 && (
        <Card className="mt-8 border-primary/20 bg-primary-soft">
          <CardTitle>How it works</CardTitle>
          <CardDescription className="!text-ink/75">
            1. Upload your files · 2. Set a price · 3. Share the link anywhere. Buyers pay by card — no account needed.
          </CardDescription>
          <Badge tone="primary" className="mt-3 bg-white">Takes about a minute</Badge>
        </Card>
      )}
    </>
  );
}
