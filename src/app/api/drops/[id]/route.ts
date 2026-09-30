import { NextResponse } from "next/server";
import { api, requireSeller } from "@/server/http";
import { getOwnedDrop, listFiles } from "@/server/services/drops";

export const dynamic = "force-dynamic";

export const GET = api<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const seller = await requireSeller();
  const drop = await getOwnedDrop(seller.id, (await params).id);
  return NextResponse.json({ drop, files: await listFiles(drop.id) });
});
