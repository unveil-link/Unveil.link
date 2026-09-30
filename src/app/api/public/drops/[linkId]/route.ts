import { NextResponse } from "next/server";
import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
import { getDropByPublicLink, listFiles } from "@/server/services/drops";
import { queryOne } from "@/server/db";

export const dynamic = "force-dynamic";

/** Public view of a published drop: metadata + blurred preview URLs only. Never original keys/URLs. */
export const GET = api<{ params: Promise<{ linkId: string }> }>(async (_req, { params }) => {
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
      title: drop.title,
      description: drop.description,
      priceCents: drop.price_cents,
    },
    seller,
    previews: files.map((f) => ({ id: f.id, url: `/api/files/${f.id}/preview` })),
  });
});
