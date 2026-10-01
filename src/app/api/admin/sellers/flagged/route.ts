import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { requireAdmin } from "@/server/admin/auth";
import { listFlaggedSellers } from "@/server/admin/queries";

export const dynamic = "force-dynamic";
/** Sellers whose account is flagged for review (repeat chargebacks). Admin only. */
export const GET = api(async () => {
  await requireAdmin();
  return NextResponse.json({ sellers: await listFlaggedSellers() }, { headers: { "Cache-Control": "no-store" } });
});
