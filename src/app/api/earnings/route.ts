import { NextResponse } from "next/server";
import { api, requireSeller } from "@/server/http";
import { getEarningsSummary } from "@/server/payments/earnings";

export const dynamic = "force-dynamic";

/** Read-only earnings summary for the signed-in seller (balance pending/available, lifetime totals, recent sales). */
export const GET = api(async () => {
  const seller = await requireSeller();
  return NextResponse.json(await getEarningsSummary(seller.id));
});
