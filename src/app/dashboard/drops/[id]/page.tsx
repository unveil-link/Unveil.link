import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionSellerId } from "@/server/auth/session";
import { getSellerById } from "@/server/services/sellers";
import { getOwnedDrop, listFiles } from "@/server/services/drops";
import { getSettings } from "@/server/services/settings";
import { HttpError } from "@/server/errors";
import DropEditor from "../../../components/DropEditor";
import { DEFAULT_LIMITS, type UploadLimits } from "@/lib/upload-limits";
import { getDropStats } from "../../data";

export const metadata = { title: "Manage drop" };

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
  const [files, s, stats] = await Promise.all([listFiles(drop.id), getSettings(), getDropStats(seller.id)]);
  const limits: UploadLimits = {
    ...DEFAULT_LIMITS,
    priceMinCents: s.price_min_cents, priceMaxCents: s.price_max_cents, maxImageSizeBytes: s.max_image_size_bytes,
    maxVideoSizeBytes: s.max_video_size_bytes, maxFilesPerDrop: s.max_files_per_drop, maxTotalBytesPerDrop: s.max_total_bytes_per_drop,
    allowedImageMimes: s.allowed_image_mimes,
  };
  return (
    <>
      <Link href="/dashboard/drops" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-text">← All drops</Link>
      <DropEditor
        drop={{ id: drop.id, title: drop.title, description: drop.description, priceCents: drop.price_cents, status: drop.status, publicLinkId: drop.public_link_id }}
        files={files.map((f) => ({ id: f.id, filename: f.filename, sizeBytes: f.size_bytes, mime: f.mime }))}
        verificationStatus={seller.verification_status}
        limits={limits}
        units={stats[drop.id]?.units ?? 0}
        revenueCents={stats[drop.id]?.revenueCents ?? 0}
      />
    </>
  );
}
