import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDropByPublicLink, listFiles, summarizeFiles } from "@/server/services/drops";
import { queryOne } from "@/server/db";
import AppShell from "../../components/AppShell";
import BuyForm from "./BuyForm";

export const dynamic = "force-dynamic";

// Link pages must never be indexed (also enforced by the X-Robots-Tag header in next.config.ts and /robots.txt).
export const metadata: Metadata = {
  title: "Unveil",
  robots: { index: false, follow: false, nocache: true },
};

// Public drop page: only blurred previews are ever rendered here. The buy form posts to /api/checkout (price comes from the DB).
export default async function PublicDrop({ params }: { params: Promise<{ linkId: string }> }) {
  const drop = await getDropByPublicLink((await params).linkId);
  if (!drop || drop.status !== "published") notFound();
  const [files, seller] = await Promise.all([
    listFiles(drop.id),
    queryOne<{ display_name: string }>("SELECT display_name FROM sellers WHERE id = $1", [drop.seller_id]),
  ]);
  const summary = summarizeFiles(files);
  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="drop-title">{drop.title}</h1>
          <p className="mt-1 text-sm text-muted">
            by <span className="font-medium text-text" data-testid="seller-name">{seller?.display_name ?? "Unknown seller"}</span>
            {" · "}
            <span data-testid="file-summary">{summary.label}</span>
          </p>
        </div>
        {drop.description && <p>{drop.description}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {files.map((f) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={f.id} src={`/api/files/${f.id}/preview`} alt="Blurred preview" className="aspect-square w-full rounded-lg object-cover" />
          ))}
        </div>
        <p className="text-2xl font-semibold" data-testid="drop-price">{`$${(drop.price_cents / 100).toFixed(2)}`}</p>
        <BuyForm linkId={drop.public_link_id} priceLabel={`$${(drop.price_cents / 100).toFixed(2)}`} />
      </div>
    </AppShell>
  );
}
