import { NextResponse } from "next/server";
import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
import { getDropByPublicLink, listFiles, publicPath, summarizeFiles } from "@/server/services/drops";
import { queryOne } from "@/server/db";
import { enforceIpLimit } from "@/server/ratelimit";

export const dynamic = "force-dynamic";

/** Public view of a published drop: metadata + blurred preview URLs only. Never original keys/URLs. */
export const GET = api<{ params: Promise<{ linkId: string }> }>(async (req, { params }) => {
  await enforceIpLimit("PUBLIC_LINK", req);
  const drop = await getDropByPublicLink((await params).linkId);
  if (!drop || drop.status !== "published") throw new HttpError(404, "Not found");
  const seller = await queryOne<{ display_name: string; avatar: string | null }>(
    "SELECT display_name, avatar FROM sellers WHERE id = $1",
    [drop.seller_id],
  );
  const files = await listFiles(drop.id);
  return NextResponse.json({
    drop: {
      publicLinkId: drop.public_link_id,
      url: publicPath(drop.public_link_id),
      title: drop.title,
      description: drop.description,
      priceCents: drop.price_cents,
    },
    seller: seller && { displayName: seller.display_name, display_name: seller.display_name, avatar: seller.avatar },
    summary: summarizeFiles(files),
    previews: files.map((f) => ({ id: f.id, url: `/api/files/${f.id}/preview`, kind: f.mime.startsWith("video/") ? "video" : "image" })),
  });
});
