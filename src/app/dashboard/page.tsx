import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionSellerId } from "@/server/auth/session";
import { getSellerById } from "@/server/services/sellers";
import { listDropsForSeller } from "@/server/services/drops";
import { Badge, Card, CardDescription, CardTitle, type BadgeTone } from "@/components/ui";
import AppShell from "../components/AppShell";
import LogoutButton from "../components/LogoutButton";
import NewDropForm from "../components/NewDropForm";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: BadgeTone; hint: string }> = {
  pending: { label: "Pending", tone: "warning", hint: "You can create drafts and upload files, but you can't publish until you're verified." },
  verified: { label: "Verified", tone: "success", hint: "You can publish drops." },
  failed: { label: "Failed", tone: "danger", hint: "Verification failed. Contact support." },
  manual_review: { label: "Manual review", tone: "primary", hint: "A person is reviewing your verification." },
};

export default async function Dashboard() {
  const id = await getSessionSellerId();
  const seller = id ? await getSellerById(id) : null;
  if (!seller) redirect("/login");
  const drops = await listDropsForSeller(seller.id);
  const st = STATUS[seller.verification_status];

  return (
    <AppShell right={<LogoutButton />}>
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Hi, {seller.display_name}</h1>
          <p className="text-sm text-muted">{seller.email}</p>
        </div>

        <Card data-testid="verification">
          <div className="flex items-center gap-3">
            <CardTitle>Verification status</CardTitle>
            <Badge data-testid="verification-status" tone={st.tone}>{st.label}</Badge>
          </div>
          <CardDescription>{st.hint}</CardDescription>
        </Card>

        <Card>
          <CardTitle className="mb-4">New drop</CardTitle>
          <NewDropForm />
        </Card>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Your drops</h2>
          {drops.length === 0 ? (
            <p className="text-sm text-muted">No drops yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {drops.map((d) => (
                <li key={d.id}>
                  <Link href={`/dashboard/drops/${d.id}`}>
                    <Card elevated={false} className="flex items-center justify-between !py-4 hover:border-primary">
                      <span className="font-medium">{d.title}</span>
                      <span className="text-sm text-muted">
                        ${(d.price_cents / 100).toFixed(2)} · {d.file_count} file(s) · {d.status}
                      </span>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
