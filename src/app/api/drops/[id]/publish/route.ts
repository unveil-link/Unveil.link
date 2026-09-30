import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody, requireSeller } from "@/server/http";
import { publishDrop } from "@/server/services/drops";

const schema = z.object({
  attestation: z.object({
    over18: z.boolean(),
    ownsRights: z.boolean(),
    consentOfSubjects: z.boolean(),
  }),
});

export const POST = api<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const seller = await requireSeller();
  const { attestation } = schema.parse(await jsonBody(req));
  const drop = await publishDrop(seller.id, (await params).id, attestation);
  return NextResponse.json({ drop, url: `/d/${drop.public_link_id}` });
});
