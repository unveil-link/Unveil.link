import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { enforceIpLimit } from "@/server/ratelimit";
import { requireCronAuth } from "@/server/auth/cron";
import { runPaymentsJanitor } from "@/server/payments/janitor";

export const dynamic = "force-dynamic";

/**
 * Scheduled payments cleanup (expire pending sessions, retry void refunds, flag stale parked events). Authorised ONLY by
 * `Authorization: Bearer $CRON_SECRET` (constant-time compare); 503 when CRON_SECRET is unset; per-IP rate limited before the
 * check. GET is accepted because Vercel Cron issues GET requests; POST works for any other scheduler. Safe to call concurrently:
 * overlapping runs return {skipped:true}.
 */
const handler = api(async (req) => {
  await enforceIpLimit("CRON", req);
  requireCronAuth(req);
  const out = await runPaymentsJanitor();
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
});
export const GET = handler;
export const POST = handler;
