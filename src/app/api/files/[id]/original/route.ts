import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
import { enforceIpLimit } from "@/server/ratelimit";
import { getFileRow } from "@/server/services/images";
import { verifyOriginalSignature } from "@/server/services/signing";
import { storage } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The ONLY route that can return original bytes. Requires a valid, unexpired HMAC signature. */
export const GET = api<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await enforceIpLimit("DOWNLOAD", req);
  const { id } = await params;
  const url = new URL(req.url);
  const v = verifyOriginalSignature(id, url.searchParams.get("exp"), url.searchParams.get("sig"));
  if (v === "expired") throw new HttpError(410, "Link expired", "expired");
  if (v !== "ok") throw new HttpError(403, "Invalid or missing signature", "forbidden");

  const row = await getFileRow(id);
  if (!row) throw new HttpError(404, "Not found");
  const data = await storage().get(row.storage_key);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": row.mime,
      "content-disposition": `attachment; filename="${row.filename.replace(/"/g, "")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
