import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { requireAdmin } from "@/server/admin/auth";
import { clearSellerFlag } from "@/server/admin/queries";

export const dynamic = "force-dynamic";
const schema = z.object({ note: z.string().min(1).max(1000) });

/** Mark a flagged seller as reviewed (clears the flag; audit_log row with admin id written atomically). Admin only; same-origin guarded. */
export const POST = api<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const body = schema.parse(await jsonBody(req));
  return NextResponse.json(await clearSellerFlag(admin.id, id, body.note), { headers: { "Cache-Control": "no-store" } });
});
