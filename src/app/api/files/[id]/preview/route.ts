import { HttpError } from "@/server/errors";
import { api, optionalSellerId } from "@/server/http";
import { getFileRow } from "@/server/services/images";
import { storage } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves ONLY the blurred preview. Public for published drops; the owner can also see
 * previews of their own unpublished drops. This route cannot return an original.
 */
export const GET = api<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const row = await getFileRow((await params).id);
  if (!row || !row.blurred_preview_key) throw new HttpError(404, "Not found");
  if (row.drop_status !== "published") {
    const me = await optionalSellerId();
    if (me !== row.seller_id) throw new HttpError(404, "Not found");
  }
  const data = await storage().get(row.blurred_preview_key);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": row.drop_status === "published" ? "public, max-age=300" : "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
