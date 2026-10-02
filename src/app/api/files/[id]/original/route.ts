import { Readable } from "node:stream";
import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
import { enforceIpLimit } from "@/server/ratelimit";
import { getFileRow } from "@/server/services/images";
import { parseRange } from "@/server/services/range";
import { verifyOriginalSignature } from "@/server/services/signing";
import { storage } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The ONLY route that can return original bytes. Requires a valid, unexpired HMAC signature.
 * Streams from storage (videos can be 500 MB) and supports single-range `Range: bytes=a-b` requests (206) for seeking/resuming.
 */
export const GET = api<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await enforceIpLimit("DOWNLOAD", req);
  const { id } = await params;
  const url = new URL(req.url);
  const v = verifyOriginalSignature(id, url.searchParams.get("exp"), url.searchParams.get("sig"));
  if (v === "expired") throw new HttpError(410, "Link expired", "expired");
  if (v !== "ok") throw new HttpError(403, "Invalid or missing signature", "forbidden");

  const row = await getFileRow(id);
  if (!row) throw new HttpError(404, "Not found");
  const st = storage();
  let total: number;
  try {
    total = await st.size(row.storage_key);
  } catch {
    throw new HttpError(404, "Not found");
  }

  const headers: Record<string, string> = {
    "content-type": row.mime,
    "content-disposition": `attachment; filename="${row.filename.replace(/"/g, "")}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  };
  const rangeHeader = req.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, total) : null;
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${total}` } });
  }
  if (range) {
    const stream = await st.getStream(row.storage_key, range);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${total}`, "content-length": String(range.end - range.start + 1) },
    });
  }
  const stream = await st.getStream(row.storage_key);
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { ...headers, "content-length": String(total) } });
});
