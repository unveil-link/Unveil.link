import { NextResponse } from "next/server";
import { HttpError } from "@/server/errors";
import { api, requireSeller } from "@/server/http";
import { getFileRow } from "@/server/services/images";
import { signOriginalUrl } from "@/server/services/signing";

export const dynamic = "force-dynamic";

/** Owner-only: mint a short-lived signed URL for the original. (Buyer fulfilment will mint these after payment.) */
export const POST = api<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const seller = await requireSeller();
  const row = await getFileRow((await params).id);
  if (!row || row.seller_id !== seller.id) throw new HttpError(404, "Not found");
  return NextResponse.json(signOriginalUrl(row.id));
});
