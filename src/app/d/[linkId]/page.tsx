import { notFound } from "next/navigation";
import { getDropByPublicLink, listFiles } from "@/server/services/drops";
import { Button } from "@/components/ui";
import AppShell from "../../components/AppShell";

export const dynamic = "force-dynamic";

// Public drop page: only blurred previews are ever rendered here. Purchase flow comes later.
export default async function PublicDrop({ params }: { params: Promise<{ linkId: string }> }) {
  const drop = await getDropByPublicLink((await params).linkId);
  if (!drop || drop.status !== "published") notFound();
  const files = await listFiles(drop.id);
  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{drop.title}</h1>
        {drop.description && <p>{drop.description}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {files.map((f) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={f.id} src={`/api/files/${f.id}/preview`} alt="Blurred preview" className="aspect-square w-full rounded-lg object-cover" />
          ))}
        </div>
        <Button disabled className="self-start">Unlock for ${(drop.price_cents / 100).toFixed(2)} (payments coming soon)</Button>
      </div>
    </AppShell>
  );
}
