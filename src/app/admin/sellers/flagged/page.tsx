import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdmin } from "@/server/admin/auth";
import { listFlaggedSellers, listReviewTransactions } from "@/server/admin/queries";
import { Badge, Card, CardDescription, CardTitle } from "@/components/ui";
import AdminShell from "../../components/AdminShell";
import ClearFlagForm from "./ClearFlagForm";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const when = (s: string) => new Date(s).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const REFUND_LABEL = { requested: "Refund requested", pending_retry: "Refund pending retry", failed: "Refund FAILED (needs action)", not_applicable: "-" } as const;

export default async function FlaggedSellersPage() {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  const [sellers, txns] = await Promise.all([listFlaggedSellers(), listReviewTransactions()]);
  return (
    <AdminShell email={admin.email}>
      <div className="flex flex-col gap-8">
        <section data-testid="flagged-sellers">
          <h1 className="text-2xl font-bold tracking-tight">Flagged sellers</h1>
          <p className="text-sm text-muted">Accounts flagged for review (repeat chargebacks). Flagging blocks nothing by itself.</p>
          {sellers.length === 0 ? (
            <Card className="mt-4"><CardDescription data-testid="no-flagged">No flagged sellers.</CardDescription></Card>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {sellers.map((s) => (
                <Card key={s.id} data-testid="flagged-seller" data-seller-id={s.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{s.displayName}</CardTitle>
                    <span className="text-sm text-muted">{s.email}</span>
                    <Badge tone="warning">flagged {when(s.flaggedAt)}</Badge>
                  </div>
                  <CardDescription>{s.flagReason ?? "No reason recorded"}</CardDescription>
                  <p className="mt-2 text-sm">Sales: <b>{s.totalSales}</b> · Chargebacks: <b>{s.chargebacks}</b> · Refunds: <b>{s.refunds}</b> · Verification: {s.verificationStatus} · <Link className="underline" href={`/admin/sellers/${s.id}/transactions`}>View transactions</Link></p>
                  <div className="mt-3"><ClearFlagForm sellerId={s.id} /></div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section data-testid="review-transactions">
          <h2 className="text-2xl font-bold tracking-tight">Transactions needing review</h2>
          <p className="text-sm text-muted">Charges the processor confirmed that we did not honour (seller/drop no longer valid, or far past expiry). They are not credited to the seller and are refunded automatically.</p>
          {txns.length === 0 ? (
            <Card className="mt-4"><CardDescription data-testid="no-review">Nothing needs review.</CardDescription></Card>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-border"><th className="py-2 pr-3">When</th><th className="pr-3">Seller</th><th className="pr-3">Drop</th><th className="pr-3">Amount</th><th className="pr-3">Reason</th><th className="pr-3">Refund</th></tr></thead>
                <tbody>
                  {txns.map((t) => (
                    <tr key={t.id} className="border-b border-border align-top" data-testid="review-tx" data-tx-id={t.id}>
                      <td className="py-2 pr-3">{when(t.createdAt)}</td>
                      <td className="pr-3"><Link className="underline" href={`/admin/sellers/${t.sellerId}/transactions`}>{t.sellerEmail}</Link></td>
                      <td className="pr-3">{t.dropTitle}</td>
                      <td className="pr-3">{money(t.amountCents)}</td>
                      <td className="pr-3">{t.reviewReason ?? t.failureCode}</td>
                      <td className="pr-3" data-testid="refund-state">
                        {REFUND_LABEL[t.refundState]}{t.refundRequestedAt ? ` (${when(t.refundRequestedAt)})` : ""}
                        {t.refundState !== "requested" && t.refundAttempts > 0 && <div className="text-xs text-muted">attempts: {t.refundAttempts}{t.refundLastError ? ` · last error: ${t.refundLastError}` : ""}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
