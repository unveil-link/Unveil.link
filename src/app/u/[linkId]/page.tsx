import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDropByPublicLink, listFiles, summarizeFiles } from "@/server/services/drops";
import { queryOne } from "@/server/db";
import { Badge, Container, ImageIcon, ShieldCheckIcon } from "@/components/ui";
import { BuyerShell } from "@/components/buyer/BuyerShell";
import { BuyPanel } from "@/components/buyer/BuyPanel";
import { TrustPoints } from "@/components/buyer/TrustPoints";
import { LockIcon } from "@/components/landing/Icons";
import { usd } from "@/lib/format";

export const dynamic = "force-dynamic";

// Link pages must never be indexed (also enforced by the X-Robots-Tag header in next.config.ts and /robots.txt).
export const metadata: Metadata = {
  title: "Unveil",
  robots: { index: false, follow: false, nocache: true },
};

// Public drop page: only blurred previews are ever rendered here.
export default async function PublicDrop({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const drop = await getDropByPublicLink(linkId);
  if (!drop || drop.status !== "published") notFound();
  const [files, seller] = await Promise.all([
    listFiles(drop.id),
    queryOne<{ display_name: string }>("SELECT display_name FROM sellers WHERE id = $1", [drop.seller_id]),
  ]);
  const summary = summarizeFiles(files);
  const name = seller?.display_name ?? "Unknown seller";
  const [hero, ...rest] = files;
  const shown = rest.slice(0, 5);
  const more = rest.length - shown.length;

  return (
    <BuyerShell>
      <Container size="narrow" className="grid gap-6 lg:max-w-5xl lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:gap-10">
        {/* Preview card */}
        <section aria-label="Preview" className="overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
          <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-[#7c6cf5] via-[#c38bf0] to-[#f7a8b8]">
            {hero && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${hero.id}/preview`} alt="Blurred preview of the first file" className="absolute inset-0 size-full scale-110 object-cover" />
            )}
            <div className="absolute inset-0 bg-white/10 backdrop-blur-md" />
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-text shadow-sm">
              <ImageIcon className="size-3.5" /> <span data-testid="file-summary">{summary.label}</span>
            </div>
            <div className="absolute inset-0 grid place-items-center">
              <div className="grid size-16 place-items-center rounded-full bg-white/90 text-primary shadow-card"><LockIcon className="size-7" /></div>
            </div>
          </div>
          {shown.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5 p-1.5 sm:grid-cols-6">
              {shown.map((f) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={f.id} src={`/api/files/${f.id}/preview`} alt="Blurred preview" className="aspect-square w-full rounded-md object-cover" />
              ))}
              {more > 0 && <div className="grid aspect-square place-items-center rounded-md bg-surface-muted text-sm font-semibold text-muted">+{more}</div>}
            </div>
          )}
          <p className="border-t border-border px-4 py-2.5 text-xs text-muted">Previews are blurred. The full files unlock after purchase.</p>
        </section>

        {/* Details + buy */}
        <div className="flex flex-col gap-5">
          <div>
            <Badge tone="accent" className="mb-3"><ShieldCheckIcon className="size-3.5" /> Verified creator</Badge>
            <h1 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl" data-testid="drop-title">{drop.title}</h1>
            <p className="mt-3 flex items-center gap-2.5 text-sm text-muted">
              <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-bold text-white" aria-hidden="true">{name.trim()[0]?.toUpperCase() ?? "?"}</span>
              <span>by <span className="font-semibold text-text" data-testid="seller-name">{name}</span></span>
            </p>
            {drop.description && <p className="mt-4 whitespace-pre-line text-base text-ink/85">{drop.description}</p>}
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-sm text-muted">Price</p>
                <p className="text-4xl font-extrabold tracking-tight" data-testid="drop-price">{usd(drop.price_cents)}</p>
              </div>
              <p className="pb-1 text-right text-sm text-muted">{summary.label}</p>
            </div>
            <BuyPanel linkId={drop.public_link_id} priceCents={drop.price_cents} />
            <p className="mt-4 rounded-md bg-surface-muted px-3 py-2 text-xs text-muted" data-testid="final-sale">
              <b className="text-text">All sales are final.</b> Because files are delivered digitally right away, purchases can’t be refunded.
            </p>
          </div>
        </div>
      </Container>

      <Container size="narrow" className="mt-8 lg:max-w-5xl">
        <TrustPoints />
      </Container>
    </BuyerShell>
  );
}
