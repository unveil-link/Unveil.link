import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { requireAdmin } from "@/server/admin/auth";
import { listReviewTransactions } from "@/server/admin/queries";

export const dynamic = "force-dynamic";
/** Transactions needing review (voided charges, with their refund state). Admin only. */
export const GET = api(async () => {
  await requireAdmin();
  return NextResponse.json({ transactions: await listReviewTransactions() }, { headers: { "Cache-Control": "no-store" } });
});
