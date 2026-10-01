import { NextResponse } from "next/server";
import { HttpError } from "@/server/errors";
import { api, requireSeller } from "@/server/http";
import { getFileRow } from "@/server/services/images";
import { defaultTtlSeconds, signOriginalUrl } from "@/server/services/signing";
import { getSettings } from "@/server/services/settings";
import { enforceIpLimit } from "@/server/ratelimit";

export const dynamic = "force-dynamic";

/** Owner-only: mint a signed URL (default TTL 24 h; see platform_settings.download_ttl_seconds / SIGNED_URL_TTL_SECONDS) for the original. (Buyer fulfilment will mint these after payment.) */
export const POST = api<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await enforceIpLimit("SIGNED_URL", req);
  const seller = await requireSeller();
  const row = await getFileRow((await params).id);
  if (!row || row.seller_id !== seller.id) throw new HttpError(404, "Not found");
  return NextResponse.json(signOriginalUrl(row.id, defaultTtlSeconds((await getSettings()).download_ttl_seconds)));
});
