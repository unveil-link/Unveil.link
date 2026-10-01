import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { enforceIpLimit } from "@/server/ratelimit";

export const dynamic = "force-dynamic";

/** Placeholder: payments are not built yet. The rate limiter is already in place (429 + Retry-After). */
export const POST = api(async (req) => {
  await enforceIpLimit("CHECKOUT", req);
  return NextResponse.json({ error: "Checkout is not implemented yet", code: "not_implemented" }, { status: 501 });
});
