import { NextResponse } from "next/server";
import { api, jsonBody, requireSeller } from "@/server/http";
import { deleteDrop, dropPatchSchema, getOwnedDrop, listFiles, updateDrop } from "@/server/services/drops";

export const dynamic = "force-dynamic";

export const GET = api<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const seller = await requireSeller();
  const drop = await getOwnedDrop(seller.id, (await params).id);
  return NextResponse.json({ drop, files: await listFiles(drop.id) });
});

export const PATCH = api<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const seller = await requireSeller();
  const id = (await params).id;
  const body = dropPatchSchema.parse(await jsonBody(req));
  const drop = await updateDrop(seller.id, id, {
    title: body.title,
    description: body.description,
    priceCents: body.priceCents ?? body.price_cents,
  });
  return NextResponse.json({ drop });
});

export const DELETE = api<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const seller = await requireSeller();
  const out = await deleteDrop(seller.id, (await params).id);
  return NextResponse.json({ deleted: true, ...out });
});
