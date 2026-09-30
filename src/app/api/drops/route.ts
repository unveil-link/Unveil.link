import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody, requireSeller } from "@/server/http";
import { createDrop, listDropsForSeller } from "@/server/services/drops";

export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  priceCents: z.number().int(),
});

export const GET = api(async () => {
  const seller = await requireSeller();
  return NextResponse.json({ drops: await listDropsForSeller(seller.id) });
});

export const POST = api(async (req) => {
  const seller = await requireSeller();
  const body = schema.parse(await jsonBody(req));
  return NextResponse.json({ drop: await createDrop(seller.id, body) }, { status: 201 });
});
