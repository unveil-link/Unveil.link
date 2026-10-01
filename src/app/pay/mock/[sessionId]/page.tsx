import { notFound } from "next/navigation";
import { config } from "@/server/config";
import { queryOne } from "@/server/db";
import { hasBadText } from "@/server/input";
import AppShell from "../../../components/AppShell";
import MockCheckoutForm from "./MockCheckoutForm";
import { SALES_FINAL_TEXT } from "../../../../../lib/purchase-copy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mock checkout", robots: { index: false, follow: false } };

/** DEV ONLY hosted checkout stand-in for the mock processor (404 in production). Real processors host their own page. */
export default async function MockCheckout({ params }: { params: Promise<{ sessionId: string }> }) {
  if (!config.mockPaymentsAllowed) notFound();
  const { sessionId } = await params;
  if (hasBadText(sessionId) || sessionId.length > 100) notFound();
  const tx = await queryOne<{ amount_cents: number; status: string; link: string; title: string }>(
    `SELECT t.amount_cents, t.status, d.public_link_id AS link, d.title
       FROM transactions t JOIN drops d ON d.id = t.drop_id WHERE t.provider = 'mock' AND t.provider_session_id = $1`, [sessionId]);
  if (!tx) notFound();
  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Mock checkout (test mode, no real payment)</h1>
        <p className="text-sm text-muted">{tx.title} · <span data-testid="mock-amount">${(tx.amount_cents / 100).toFixed(2)}</span></p>
        <p className="text-sm font-medium" data-testid="sales-final">{SALES_FINAL_TEXT}</p>
        <MockCheckoutForm sessionId={sessionId} returnPath={`/u/${tx.link}`} />
      </div>
    </AppShell>
  );
}
