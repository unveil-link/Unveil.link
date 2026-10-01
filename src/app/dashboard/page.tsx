import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionSellerId } from "@/server/auth/session";
import { getSellerById } from "@/server/services/sellers";
import { listDropsForSeller } from "@/server/services/drops";
import { Alert, Badge, ButtonLink, Card, CardDescription, CardTitle, ChartIcon, ClockIcon, CoinIcon, PlusIcon, StatCard, WalletIcon } from "@/components/ui";
import { DropList } from "@/components/dashboard/DropList";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { VERIFICATION_META, type DropRow } from "@/components/dashboard/types";
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard label="Gross sales" value={usd(e.grossCents)} icon={<ChartIcon />} tone="primary"
            hint={`${e.salesCount} sale${e.salesCount === 1 ? "" : "s"}${e.refundedCents ? ` · ${usd(e.refundedCents)} refunded` : ""}`} />
          <StatCard label={`Your ${e.sellerPercent}%`} value={usd(e.netCents)} icon={<CoinIcon />} tone="accent"
            hint={`After the ${e.feePercent}% platform fee & processing`} />
          <StatCard label="Available" value={usd(e.availableCents)} icon={<WalletIcon />}
            hint={e.availableCents > 0 ? "Ready for your next payout" : "Nothing to pay out yet"} />
          <StatCard label="Pending payouts" value={usd(e.pendingPayoutCents)} icon={<ClockIcon />}
            hint={e.paidOutCents ? `${usd(e.paidOutCents)} paid out so far` : "No payouts yet"} />
        </div>
        <p className="mt-3 text-xs text-muted">
          You keep {e.sellerPercent}% of each sale; the {e.feePercent}% platform fee is shown before payment processing costs. Payouts are not enabled yet — balances will appear here as sales come in.
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
            1. Upload your files · 2. Set a price · 3. Share the link anywhere. Buyers pay by card — no account needed — and download instantly.
          </CardDescription>
          <Badge tone="primary" className="mt-3 bg-white">Takes about a minute</Badge>
        </Card>
      )}
    </>
  );
}
