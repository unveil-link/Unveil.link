import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { getSettings } from "@/server/services/settings";

export const dynamic = "force-dynamic";

/** Public, non-sensitive limits for the UI. */
export const GET = api(async () => {
  const s = await getSettings();
  return NextResponse.json({
    priceMinCents: s.price_min_cents,
    priceMaxCents: s.price_max_cents,
    maxImageSizeBytes: s.max_image_size_bytes,
    maxFilesPerDrop: s.max_files_per_drop,
    allowedImageMimes: s.allowed_image_mimes,
  });
});
