import { NextResponse } from "next/server";
import { HttpError } from "@/server/errors";
import { api, requireSeller } from "@/server/http";
import { addImageToDrop } from "@/server/services/images";
import { addVideoToDrop } from "@/server/services/video";
import { getOwnedDrop } from "@/server/services/drops";
import { getSettings } from "@/server/services/settings";
import { receiveUpload } from "@/server/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * multipart/form-data with a single `file` field: JPG/PNG/WebP (buffered, <= max_image_size_bytes) or MP4 (streamed to a temp file,
 * <= max_video_size_bytes, never held in memory). The type is decided from the file's magic bytes, not the client MIME.
 */
export const POST = api<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const seller = await requireSeller();
  const dropId = (await params).id;
  await getOwnedDrop(seller.id, dropId); // fail fast before reading the body

  const s = await getSettings();
  // Reject obviously oversized bodies before reading them (largest per-file cap + multipart overhead).
  const declared = Number(req.headers.get("content-length") ?? 0);
  const hard = Math.max(s.max_image_size_bytes, s.max_video_size_bytes);
  if (declared > hard + 64 * 1024) {
    throw new HttpError(413, `File exceeds limit of ${hard} bytes`, "file_too_large");
  }

  const up = await receiveUpload(req, { maxImageBytes: s.max_image_size_bytes, maxVideoBytes: s.max_video_size_bytes });
  try {
    const out =
      up.kind === "video"
        ? await addVideoToDrop(seller.id, dropId, { name: up.name, path: up.path, size: up.size, declaredMime: up.declaredMime })
        : await addImageToDrop(seller.id, dropId, { name: up.name, data: up.data, declaredMime: up.declaredMime });
    return NextResponse.json({ file: out }, { status: 201 });
  } finally {
    await up.cleanup();
  }
});
