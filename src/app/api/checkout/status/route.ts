import { NextResponse } from "next/server";
import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
import { enforceIpLimit } from "@/server/ratelimit";
import { getCheckoutStatus } from "@/server/payments/checkout";

export const dynamic = "force-dynamic";

/** GET /api/checkout/status?id=<transactionId>: buyer-facing status poll (pending|succeeded|failed|refunded|charged_back); failures carry a buyer-friendly `message`, never a raw code. */
export const GET = api(async (req) => {
  await enforceIpLimit("PUBLIC_LINK", req);
  const s = await getCheckoutStatus(new URL(req.url).searchParams.get("id") ?? "");
  if (!s) throw new HttpError(404, "Not found");
  return NextResponse.json({ transactionId: s.id, status: s.status, amountCents: s.amount_cents, retryable: s.retryable, message: s.message });
});
