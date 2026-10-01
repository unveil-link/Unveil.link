import { redirect } from "next/navigation";
import { getSessionSellerId } from "@/server/auth/session";
import { getSellerById } from "@/server/services/sellers";
import { getSettings } from "@/server/services/settings";
import NewDropFlow from "@/components/dashboard/NewDropFlow";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DEFAULT_LIMITS, type UploadLimits } from "@/lib/upload-limits";

export const metadata = { title: "New drop" };

export default async function NewDropPage() {
  const id = await getSessionSellerId();
  const seller = id ? await getSellerById(id) : null;
  if (!seller) redirect("/login");
  // Same numbers GET /api/settings returns (read server-side to avoid a client round trip / flash of defaults).
  const s = await getSettings();
  const limits: UploadLimits = {
    ...DEFAULT_LIMITS,
    priceMinCents: s.price_min_cents,
    priceMaxCents: s.price_max_cents,
    maxImageSizeBytes: s.max_image_size_bytes,
    maxVideoSizeBytes: s.max_video_size_bytes,
    maxFilesPerDrop: s.max_files_per_drop,
    maxTotalBytesPerDrop: s.max_total_bytes_per_drop,
    allowedImageMimes: s.allowed_image_mimes,
  };
  return (
    <>
      <PageHeader title="New drop" description="Add your files, set a price, and get a link you can share anywhere." />
      <NewDropFlow limits={limits} verification={seller.verification_status} />
    </>
  );
}
