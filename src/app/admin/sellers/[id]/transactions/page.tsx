import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdmin } from "@/server/admin/auth";
import { listSellerTransactions } from "@/server/admin/queries";
import { Card, CardDescription } from "@/components/ui";
import AdminShell from "../../../components/AdminShell";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export default async function SellerTransactionsPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  const { id } = await params;
  const { seller, rows } = await listSellerTransactions(id);
  if (!seller) notFound();
  return (
    <AdminShell email={admin.email}>
      <p className="text-sm"><Link className="underline" href="/admin/sellers/flagged">← Flagged sellers</Link></p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Transactions: {seller.displayName}</h1>
      <p className="text-sm text-muted">{seller.email} · most recent 200 · buyer emails are not shown</p>
      {rows.length === 0 ? (
        <Card className="mt-4"><CardDescription>No transactions.</CardDescription></Card>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="seller-transactions">
            <thead><tr className="border-b border-border"><th className="py-2 pr-3">When</th><th className="pr-3">Drop</th><th className="pr-3">Status</th><th className="pr-3">Amount</th><th className="pr-3">Reversed</th><th className="pr-3">Note</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-border">
                  <td className="py-2 pr-3">{new Date(t.createdAt).toISOString().replace("T", " ").slice(0, 16)} UTC</td>
                  <td className="pr-3">{t.dropTitle}</td><td className="pr-3">{t.status}</td>
                  <td className="pr-3">{money(t.amountCents)}</td><td className="pr-3">{money(t.reversedCents)}</td>
                  <td className="pr-3">{t.reviewReason ?? t.failureCode ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
