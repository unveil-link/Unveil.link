import { redirect } from "next/navigation";
import { getSessionSellerId } from "@/server/auth/session";
import { getSellerById } from "@/server/services/sellers";
import { listDropsForSeller } from "@/server/services/drops";
import { ButtonLink, PlusIcon } from "@/components/ui";
import { DropList } from "@/components/dashboard/DropList";
import { PageHeader } from "@/components/dashboard/PageHeader";
import type { DropRow } from "@/components/dashboard/types";
import { getDropStats, getDropThumbs } from "../data";

export const metadata = { title: "Drops" };

export default async function DropsPage() {
  const id = await getSessionSellerId();
  const seller = id ? await getSellerById(id) : null;
  if (!seller) redirect("/login");
  const [drops, stats, thumbs] = await Promise.all([listDropsForSeller(seller.id), getDropStats(seller.id), getDropThumbs(seller.id)]);
  const rows: DropRow[] = drops.map((d) => ({
    id: d.id, title: d.title, priceCents: d.price_cents, status: d.status, publicLinkId: d.public_link_id,
    fileCount: d.file_count, createdAt: d.created_at, units: stats[d.id]?.units ?? 0, revenueCents: stats[d.id]?.revenueCents ?? 0,
    thumbFileId: thumbs[d.id] ?? null,
  }));
  return (
    <>
      <PageHeader title="Drops" description="Everything you’re selling, in one place." actions={<ButtonLink href="/dashboard/drops/new"><PlusIcon className="size-4" /> New drop</ButtonLink>} />
      <DropList drops={rows} verification={seller.verification_status} filterable />
    </>
  );
}
