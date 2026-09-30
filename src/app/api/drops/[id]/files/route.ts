import { NextResponse } from "next/server";
import { HttpError } from "@/server/errors";
import { api, requireSeller } from "@/server/http";
import { addImageToDrop } from "@/server/services/images";
import { getOwnedDrop } from "@/server/services/drops";
import { getSettings } from "@/server/services/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** multipart/form-data with a single `file` field. */
export const POST = api<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const seller = await requireSeller();
  const dropId = (await params).id;
  await getOwnedDrop(seller.id, dropId); // fail fast before reading the body

  // Reject obviously oversized bodies before buffering them.
  const limit = (await getSettings()).max_image_size_bytes;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > limit + 64 * 1024) {
    throw new HttpError(413, `File exceeds limit of ${limit} bytes`, "file_too_large");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Expected multipart/form-data", "bad_form");
  }
  const f = form.get("file");
  if (!(f instanceof File)) throw new HttpError(400, "Missing 'file' field", "missing_file");

  const out = await addImageToDrop(seller.id, dropId, {
    name: f.name,
    data: Buffer.from(await f.arrayBuffer()),
    declaredMime: f.type,
  });
  return NextResponse.json({ file: out }, { status: 201 });
});
