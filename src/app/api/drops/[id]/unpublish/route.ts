import { NextResponse } from "next/server";
import { api, requireSeller } from "@/server/http";
import { unpublishDrop } from "@/server/services/drops";

export const POST = api<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const seller = await requireSeller();
  return NextResponse.json({ drop: await unpublishDrop(seller.id, (await params).id) });
});
