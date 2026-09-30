import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionSellerId } from "@/server/auth/session";
import { getSellerById } from "@/server/services/sellers";
import { getOwnedDrop, listFiles } from "@/server/services/drops";
import { HttpError } from "@/server/errors";
import AppShell from "../../../components/AppShell";
import DropEditor from "../../../components/DropEditor";

export const dynamic = "force-dynamic";

export default async function DropPage({ params }: { params: Promise<{ id: string }> }) {
  const sid = await getSessionSellerId();
  const seller = sid ? await getSellerById(sid) : null;
  if (!seller) redirect("/login");
  let drop;
  try {
    drop = await getOwnedDrop(seller.id, (await params).id);
  } catch (e) {
    if (e instanceof HttpError) notFound();
    throw e;
  }
  const files = await listFiles(drop.id);
  return (
    <AppShell>
      <Link href="/dashboard" className="mb-4 inline-block text-sm text-muted hover:text-text">← Dashboard</Link>
      <DropEditor
        drop={{ id: drop.id, title: drop.title, description: drop.description, priceCents: drop.price_cents, status: drop.status, publicLinkId: drop.public_link_id }}
        files={files.map((f) => ({ id: f.id, filename: f.filename, sizeBytes: f.size_bytes }))}
        verificationStatus={seller.verification_status}
      />
    </AppShell>
  );
}
